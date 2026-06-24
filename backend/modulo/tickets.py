from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request, Header, BackgroundTasks, Depends
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from typing import Optional, List
from uuid import UUID
from datetime import datetime
import os
import re
import shutil
import textwrap
import copy
from typing import Dict, Any, cast

from db_utils import get_db_connection
from permission_utils import check_module_permission, load_role_permissions
from core.config import UPLOAD_DIR, FRONTEND_URL, API_URL
from core.email import send_email, generate_email_html, notify_user, notify_admins
from schemas.ticket import Ticket, TicketUpdateResponse, TicketCreate
from auth_utils import get_user_id_from_session

router = APIRouter()


def get_user_context(user_id: str, conn=None):
    should_close = False
    if conn is None:
        conn = get_db_connection()
        should_close = True
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT role, sector, managed_sectors, permissions FROM users
            WHERE id = %s AND is_active = TRUE
        """, (user_id,))
        row = cur.fetchone()
        if not row:
            return None
        role, sector, managed_sectors, user_overrides_raw = row
        user_overrides = cast(Dict[str, Any], user_overrides_raw if isinstance(user_overrides_raw, dict) else {})
        role_perms_list = load_role_permissions()
        role_defaults_fetched = next((r['permissions'] for r in role_perms_list if r['role'] == role), {})
        role_defaults = cast(Dict[str, Any], role_defaults_fetched if isinstance(role_defaults_fetched, dict) else {})
        final_perms = copy.deepcopy(role_defaults)
        for module, perms in user_overrides.items():
            if not isinstance(perms, dict): continue
            m = str(module)
            if m not in final_perms or not isinstance(final_perms[m], dict):
                final_perms[m] = {}
            final_perms[m].update(perms)
        managed = []
        if managed_sectors:
            managed = [s.strip().lower() for s in managed_sectors.split(';') if s.strip()]
        allowed_sectors = [sector.lower()] if sector else []
        allowed_sectors.extend(managed)
        allowed_sectors = list(set(allowed_sectors))
        return {
            "role": role,
            "sector": sector,
            "managed_sectors_list": managed,
            "allowed_sectors": allowed_sectors,
            "permissions": final_perms,
            "is_super_user": role == 'super_user',
            "is_ceo": role == 'ceo'
        }
    finally:
        if should_close:
            cur.close()
            conn.close()

@router.get("/tickets/{ticket_id}/updates", response_model=List[TicketUpdateResponse])
def get_ticket_updates(ticket_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        query = """
            SELECT tu.id, tu.ticket_id, tu.user_id, COALESCE(u.name, 'Sistema'), COALESCE(u.role, 'system'), tu.message, tu.created_at, tu.attachment_name, tu.attachment_path
            FROM ticket_updates tu
            LEFT JOIN users u ON tu.user_id = u.id
            WHERE tu.ticket_id = %s
            ORDER BY tu.created_at ASC
        """
        cur.execute(query, (str(ticket_id),))
        rows = cur.fetchall()
        updates = []
        for idx, row in enumerate(rows):
            try:
                updates.append(TicketUpdateResponse(
                    id=str(row[0]),
                    ticket_id=str(row[1]),
                    user_id=str(row[2]) if row[2] else None,
                    user_name=row[3] or 'Sistema',
                    user_role=row[4] or 'system',
                    message=row[5] or '',
                    attachment_name=row[7],
                    attachment_path=row[8],
                    created_at=row[6]
                ))
            except Exception as row_error:
                # Log detalhado para identificar o campo problemático
                print(f"ERRO ao processar update #{idx} do ticket {ticket_id}:")
                print(f"  Erro: {row_error}")
                print(f"  id={row[0]}, ticket_id={row[1]}, user_id={row[2]}")
                print(f"  user_name={row[3]}, user_role={row[4]}")
                print(f"  message={row[5][:50] if row[5] else None}...")
                print(f"  created_at={row[6]}, type={type(row[6])}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Dados corrompidos no update #{idx}. ID: {row[0]}. Erro: {str(row_error)}"
                )
        return updates
    except Exception as e:
        print(f"get_ticket_updates error for ticket {ticket_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao buscar atualizações: {str(e)}")
    finally:
        cur.close()
        conn.close()

@router.post("/tickets/{ticket_id}/updates")
def create_ticket_update(
    ticket_id: UUID,
    user_id: UUID = Form(...),
    message: str = Form(None),
    file: UploadFile = File(None),
    background_tasks: BackgroundTasks = None
):
    if not check_module_permission(str(user_id), 'tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        file_path = None
        file_name = None
        
        if file:
            file_name = file.filename
            # Generate safe filename
            clean_filename = re.sub(r'[^\w\-.]', '_', file.filename)
            safe_name = f"ticket_{ticket_id}_{int(datetime.now().timestamp())}_{clean_filename}"
            file_path = os.path.join(UPLOAD_DIR, safe_name)
            
            try:
                with open(file_path, "wb") as buffer:
                    shutil.copyfileobj(file.file, buffer)
                # URL path (relative to domain)
                file_path = f"/uploads/{safe_name}"
            except Exception as fe:
                print(f"ERROR saving file {safe_name}: {fe}")
                file_path = None

        # Permission Check: If Ticket is Closed/Cancelled, only super_user can comment
        cur.execute("SELECT status FROM tickets WHERE id = %s", (str(ticket_id),))
        t_status_row = cur.fetchone()
        if t_status_row:
            t_status = t_status_row[0]
            if t_status in ['Concluído', 'Cancelado']:
                cur.execute("SELECT role FROM users WHERE id = %s", (str(user_id),))
                u_role_row = cur.fetchone()
                if not u_role_row or (u_role_row[0] != 'super_user' and u_role_row[0] != 'ceo'):
                    raise HTTPException(status_code=403, detail="Chamado concluído ou cancelado. Apenas Super Admin ou CEO pode enviar mensagens.")

        cur.execute("""
            INSERT INTO ticket_updates (ticket_id, user_id, message, attachment_name, attachment_path)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        """, (str(ticket_id), str(user_id), message, file_name, file_path))
        
        updated_id = cur.fetchone()[0]
        
        # Always refresh updated_at on the ticket when a new update is added
        cur.execute("UPDATE tickets SET updated_at = NOW() WHERE id = %s", (str(ticket_id),))

        # Logic: If Ticket is 'Em Validação' and User is Requester -> Move to 'Aguardando Suporte'
        # Check if user is requester
        cur.execute("SELECT requester_id, status FROM tickets WHERE id = %s", (str(ticket_id),))
        row = cur.fetchone()
        if row:
            req_id, t_status = row
            if t_status == 'Em Validação' and str(req_id) == str(user_id):
                cur.execute("UPDATE tickets SET status = 'Aguardando Suporte' WHERE id = %s", (str(ticket_id),))
        
        conn.commit()
        
        # Notify Logic (New Comment)
        # Notify Logic (New Comment) via Background Tasks
        if background_tasks:
             try:
                 # Fetch Ticket Details
                 cur.execute("""
                    SELECT t.title, t.status, t.category, t.requester_id, t.assigned_to, u.name, u.sector, t.created_at 
                    FROM tickets t
                    LEFT JOIN users u ON t.requester_id = u.id
                    WHERE t.id = %s
                 """, (str(ticket_id),))
                 t_row = cur.fetchone()
                 if t_row:
                     t_title, t_status, t_cat, req_id, assign_id, req_name, req_sector, t_created = t_row
                     
                     friendly_id = f"CH-{str(ticket_id).split('-')[0].upper()}"
                     
                     sender_id_str = str(user_id)
                     req_id_str = str(req_id)
                     assign_id_str = str(assign_id) if assign_id else None
                     
                     msg_preview = message if message else "Novo anexo enviado."
                     short_summary = f"Nova mensagem em {friendly_id}"
                     
                     # Generate HTML
                     email_html = generate_email_html(
                        "Nova Mensagem", "{recipient_name}", friendly_id, t_title, 
                        t_status, t_cat, req_name if req_name else "N/A", t_created, msg_preview, f"/tickets/{ticket_id}", datetime.now()
                     )

                     # Notify Requester if sender is not requester
                     if sender_id_str != req_id_str:
                         background_tasks.add_task(notify_user, req_id, "Nova Mensagem", short_summary, f"/tickets/{ticket_id}", None, email_html)
                     
                     # Notify Assigned Agent if sender is not assignee
                     if assign_id_str and sender_id_str != assign_id_str:
                         background_tasks.add_task(notify_user, assign_id, "Nova Mensagem", short_summary, f"/tickets/{ticket_id}", None, email_html)

                     # Notify Participants
                     try:
                         cur.execute("SELECT user_id FROM ticket_participants WHERE ticket_id = %s", (str(ticket_id),))
                         for (p_id,) in cur.fetchall():
                             p_id_str = str(p_id)
                             if p_id_str != sender_id_str and p_id_str != req_id_str and p_id_str != assign_id_str:
                                 background_tasks.add_task(notify_user, p_id, "Nova Mensagem", short_summary, f"/tickets/{ticket_id}", None, email_html)
                     except Exception as pe:
                         print(f"Participant notify error: {pe}")

                     # Notify Admins (Super + Sector) - ALWAYS, except maybe if sender is super admin? User said "changes must be sent to admin".
                     # We pass req_sector to filter.
                     background_tasks.add_task(notify_admins, "Nova Mensagem", short_summary, f"/tickets/{ticket_id}", None, email_html, req_sector, sender_id_str)
             except Exception as ne:
                 print(f"Notif Update Error: {ne}")

        return {"id": updated_id, "message": "Update created"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.get("/tickets", response_model=List[Ticket])
def get_tickets(user_id: Optional[str] = None):
    if not check_module_permission(user_id or '', 'tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Base query
        query = """
            SELECT t.id, t.title, t.description, t.status, t.priority, t.category, t.requester_id, t.assigned_to, 
                   u.name as requester_name, u.sector as requester_sector, t.delivery_forecast,
                   au.name as assigned_name, t.created_at, 
                   COALESCE(
                       (SELECT MAX(tu.created_at) FROM ticket_updates tu WHERE tu.ticket_id = t.id), 
                       t.created_at
                   ) as updated_at,
                   tc.sector as current_sector,
                   t.category_id, t.subcategory_id, t.subcategory
            FROM tickets t
            LEFT JOIN users u ON t.requester_id = u.id
            LEFT JOIN users au ON t.assigned_to = au.id
            LEFT JOIN ticket_categories tc ON t.category_id = tc.id
            WHERE t.is_active = TRUE
        """
        params = []
        
        # Access Control Logic
        if user_id:
            context = get_user_context(user_id, conn)
            if context and not context['is_super_user'] and not context['is_ceo']:
                # REGRA DE VISIBILIDADE:
                #  - admin: vê TODOS os chamados do(s) setor(es) que administra (+ os proprios/atribuidos);
                #  - user (e demais nao-admin): vê SOMENTE os chamados que abriu (ou atribuidos a ele),
                #    NUNCA os de outros (inclusive os dos administradores) — independe de managed_sectors
                #    ou de qualquer view_all_sectors.
                if context['role'] == 'admin':
                    perms = context['permissions'].get('tickets', {})
                    if not perms.get('view_all_sectors', False):
                        # Setores que o admin enxerga: setor proprio + managed (allowed_sectors do contexto),
                        # mais qualquer allowed_sectors definido na permissao especifica de tickets.
                        allowed = [s.strip().upper() for s in context.get('allowed_sectors', []) if s.strip()]
                        for s in perms.get('allowed_sectors', []) or []:
                            su = str(s).strip().upper()
                            if su and su not in allowed:
                                allowed.append(su)
                        if allowed:
                            conditions = ["UPPER(tc.sector) = %s" for _ in allowed]
                            conditions += ["UPPER(u.sector) = %s" for _ in allowed]
                            sector_conditions = " OR ".join(conditions)
                            query += f" AND ({sector_conditions} OR t.requester_id = %s OR t.assigned_to = %s)"
                            for s in allowed:
                                params.append(s)
                            for s in allowed:
                                params.append(s)
                            params.extend([user_id, user_id])
                        # allowed vazio: sem filtro de setor — admin sem setor vê todos
                else:
                    query += " AND (t.requester_id = %s OR t.assigned_to = %s)"
                    params.extend([user_id, user_id])
        
        query += " ORDER BY t.created_at DESC"
        
        cur.execute(query, params)
        rows = cur.fetchall()
        tickets = []
        for row in rows:
            tickets.append(Ticket(
                id=row[0], title=row[1], description=row[2], status=row[3], 
                priority=row[4], category=row[5], requester_id=row[6], assigned_to=row[7],
                requester_name=row[8], requester_sector=row[9], delivery_forecast=row[10],
                assigned_name=row[11], created_at=row[12], updated_at=row[13],
                current_sector=row[14], category_id=row[15], subcategory_id=row[16], subcategory=row[17]
            ))
        return tickets

    finally:
        cur.close()
        conn.close()

@router.post("/tickets")
def create_ticket(
    title: str = Form(...),
    description: str = Form(...),
    status: str = Form(...),
    priority: str = Form(...),
    category: str = Form(...),
    requester_id: UUID = Form(...),
    authenticated_user_id: Optional[str] = Form(None),
    delivery_forecast: Optional[str] = Form(None),
    files: List[UploadFile] = File(None),
    background_tasks: BackgroundTasks = None,
    auth_user_id: Optional[str] = Depends(get_user_id_from_session),
    category_id: Optional[UUID] = Form(None),
    subcategory_id: Optional[UUID] = Form(None)
):
    if not check_module_permission(auth_user_id or authenticated_user_id or '', 'tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Validate description length (minimum 200 meaningful characters)
        if not description or len(str(description).strip()) < 200:
            raise HTTPException(status_code=400, detail="A descrição deve conter pelo menos 200 caracteres de texto real.")
        
        # New: Validate formatting (No multiples of space, dots, 3+ blank lines, or 3+ identical consecutive letters)
        if re.search(r'[^\S\n]{3,}', str(description)) or \
           re.search(r'\.{3,}', str(description)) or \
           re.search(r'(\r?\n\s*){4,}', str(description)) or \
           re.search(r'([a-zA-ZÀ-ÿ])\1{2,}', str(description)):
            raise HTTPException(status_code=400, detail="Chamado fora do padrão. Por favor, evite múltiplos espaços, pontos, quebras de linha ou letras repetidas seguidas.")

        # Validate super user permission if requester_id != authenticated_user_id
        if authenticated_user_id and str(requester_id) != authenticated_user_id:
            cur.execute("SELECT role FROM users WHERE id = %s", (authenticated_user_id,))
            auth_user = cur.fetchone()
            if not auth_user or auth_user[0] != 'super_user':
                raise HTTPException(status_code=403, detail="Only super users can create tickets for other users")
        
        # If category_id is provided, resolve name for legacy field
        resolved_category = category
        resolved_subcategory = None
        if category_id:
            cur.execute("SELECT name FROM ticket_categories WHERE id = %s", (str(category_id),))
            row = cur.fetchone()
            if row:
                resolved_category = row[0]
        
        if subcategory_id:
            cur.execute("SELECT name FROM ticket_subcategories WHERE id = %s", (str(subcategory_id),))
            row = cur.fetchone()
            if row:
                resolved_subcategory = row[0]

        query = """
            INSERT INTO tickets 
            (title, description, status, priority, category, subcategory, requester_id, delivery_forecast, category_id, subcategory_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """
        df = None
        if delivery_forecast:
             try:
                 df = datetime.strptime(delivery_forecast, "%Y-%m-%d")
             except:
                 pass

        cur.execute(query, (title, description, status, priority, resolved_category, resolved_subcategory, str(requester_id), df, 
                          str(category_id) if category_id else None, 
                          str(subcategory_id) if subcategory_id else None))
        new_id = cur.fetchone()[0]
        conn.commit()
        
        # Handle Multiple File Uploads if present
        print(f"DEBUG: create_ticket received {len(files) if files else 0} files")
        if files:
            for file in files:
                 attachment_name = file.filename
                 print(f"DEBUG: Processing file {attachment_name}")
                 clean_filename = re.sub(r'[^\w\-.]', '_', file.filename)
                 safe_name = f"ticket_{new_id}_{int(datetime.now().timestamp())}_{clean_filename}"
                 file_path = os.path.join(UPLOAD_DIR, safe_name)
                 
                 try:
                     with open(file_path, "wb") as buffer:
                         shutil.copyfileobj(file.file, buffer)
                     attachment_path = f"/uploads/{safe_name}"
                 except Exception as fe:
                     print(f"ERROR saving file {safe_name}: {fe}")
                     attachment_path = None

                 cur.execute("""
                    INSERT INTO ticket_updates (ticket_id, user_id, message, attachment_name, attachment_path, is_system)
                    VALUES (%s, %s, %s, %s, %s, TRUE)
                 """, (str(new_id), str(requester_id), f"Anexo enviado na abertura: {attachment_name}", attachment_name, attachment_path))
            
            conn.commit()


        # Notification Logic (Create Ticket) via Background Tasks
        if background_tasks:
             # Fetch Requester Name AND Sector for Admin Email
             cur.execute("SELECT name, sector FROM users WHERE id = %s", (str(requester_id),))
             u_row = cur.fetchone()
             req_name = "Unknown"
             req_sector = None
             if u_row:
                 req_name = u_row[0]
                 req_sector = u_row[1]
             
             # Friendly ID
             friendly_id = f"CH-{str(new_id).split('-')[0].upper()}"

             # Process description to force breaks on very long words (limit 60 chars/line)
             # This ensures that even strings without spaces (like "dasdasdas...") are broken
             processed_description = ""
             if description:
                 wrapped_lines: List[str] = []
                 for line in str(description).splitlines():
                     if line.strip():
                         # break_long_words=True handles the "no spaces" case
                         wrapped_lines.append(textwrap.fill(line, width=60, break_long_words=True))
                     else:
                         wrapped_lines.append("") # Preserve empty lines
                 processed_description = "\n".join(wrapped_lines)


             # Rich Email Body
             email_body = f"""
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; color: #333333; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #dc2626; padding: 20px; text-align: center;">
                        <h2 style="color: #ffffff; margin: 0;">Novo Chamado: {friendly_id}</h2>
                    </div>
                    <div style="padding: 24px;">
                        <p style="font-size: 16px; margin-bottom: 24px;">Olá, <strong>{{recipient_name}}</strong>,</p>
                        
                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                            <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Título:</strong></td>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">{title}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Solicitante:</strong></td>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">{req_name}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Categoria:</strong></td>
                                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">{category}</td>
                            </tr>
                        </table>
                        
                        <div style="margin-bottom: 24px;">
                            <p style="font-weight: bold; margin-bottom: 8px;">Descrição / Observação:</p>
                            <div style="background-color: #f8f9fa; padding: 16px; border-radius: 4px; border-left: 4px solid #dc2626; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; font-family: monospace, sans-serif;">
                                {processed_description}
                            </div>
                        </div>
                        
                        <div style="text-align: center; margin-top: 32px;">
                            <a href="{FRONTEND_URL.rstrip('/')}/tickets/{new_id}" style="background-color: #dc2626; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Ver Detalhes do Chamado</a>
                        </div>
                    </div>
                    <div style="background-color: #f8f8f8; padding: 16px; text-align: center; font-size: 12px; color: #888888; border-top: 1px solid #e0e0e0;">
                        <p style="margin: 0;">Sistema de Chamados EMPRESA</p>
                    </div>
                </div>
             """
        
             # Determine Target Sector for Admin Notifications
             target_admin_sector = req_sector
             if category and str(category).upper() in ['STARSOFT', 'INFRAESTRUTURA']:
                 target_admin_sector = 'T.I'

             # Notify Admins
             background_tasks.add_task(notify_admins, "Novo Chamado", f"Novo chamado {friendly_id} aberto: {title}", f"/tickets/{new_id}", None, email_body, target_admin_sector, str(requester_id))
             # Notify Requester
             background_tasks.add_task(notify_user, requester_id, "Chamado Aberto", f"Recebemos seu chamado '{title}'. Número: {friendly_id}", f"/tickets/{new_id}", None, email_body)

        return {"id": str(new_id), "message": "Ticket created"}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"Error creating ticket: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

# ... (omitted routes)

@router.get("/tickets/{ticket_id}", response_model=Ticket)
def get_ticket(ticket_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Fetch ticket details including requester name and sector AND assigned user name
        query = """
            SELECT t.id, t.title, t.description, t.status, t.priority, t.category, t.requester_id, t.assigned_to, 
                   u.name as requester_name, u.sector as requester_sector, t.delivery_forecast,
                   au.name as assigned_name, t.created_at, 
                   COALESCE(
                       (SELECT MAX(tu.created_at) FROM ticket_updates tu WHERE tu.ticket_id = t.id), 
                       t.created_at
                   ) as updated_at,
                   tc.sector as current_sector,
                   t.category_id, t.subcategory_id, t.subcategory
            FROM tickets t
            LEFT JOIN users u ON t.requester_id = u.id
            LEFT JOIN users au ON t.assigned_to = au.id
            LEFT JOIN ticket_categories tc ON t.category_id = tc.id
            WHERE t.id = %s AND t.is_active = TRUE
        """
        cur.execute(query, (str(ticket_id),))
        row = cur.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Ticket not found")

        # Controle de visibilidade (mesma regra da listagem): dono/atribuido sempre; admin so
        # do(s) setor(es) que administra; super_user/ceo tudo; demais nao-admin so os proprios.
        ctx = get_user_context(user_id, conn) if user_id else None
        if ctx and not ctx['is_super_user'] and not ctx['is_ceo']:
            req_id = str(row[6]) if row[6] else None
            asg_id = str(row[7]) if row[7] else None
            pode = user_id in (req_id, asg_id)
            if not pode and ctx['role'] == 'admin':
                perms = ctx['permissions'].get('tickets', {})
                if perms.get('view_all_sectors', False):
                    pode = True
                else:
                    allowed = set(x.strip().upper() for x in ctx.get('allowed_sectors', []) if x.strip())
                    for x in (perms.get('allowed_sectors') or []):
                        if str(x).strip():
                            allowed.add(str(x).strip().upper())
                    tsec = str(row[14]).upper() if row[14] else ''
                    rsec = str(row[9]).upper() if row[9] else ''
                    if (not allowed) or (tsec and tsec in allowed) or (rsec and rsec in allowed):
                        pode = True
            if not pode:
                raise HTTPException(status_code=403, detail="Sem permissão para ver este chamado.")

        return Ticket(
            id=row[0], title=row[1], description=row[2], status=row[3], 
            priority=row[4], category=row[5], requester_id=row[6], assigned_to=row[7],
            requester_name=row[8], requester_sector=row[9], delivery_forecast=row[10],
            assigned_name=row[11], created_at=row[12], updated_at=row[13],
            current_sector=row[14], category_id=row[15], subcategory_id=row[16], subcategory=row[17]
        )
    finally:
        cur.close()
        conn.close()

@router.put("/tickets/{ticket_id}")
def update_ticket(ticket_id: UUID, updates: dict, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Pop notification flag before building SQL fields
        skip_notification = updates.pop('skip_notification', False)

        # Fetch old category before update (for reclassification history)
        old_category = None
        if 'category' in updates:
            cur.execute("SELECT category FROM tickets WHERE id = %s", (str(ticket_id),))
            old_cat_row = cur.fetchone()
            if old_cat_row:
                old_category = old_cat_row[0]

        # Build dynamic update query based on provided fields
        update_fields = []
        values = []
        
        if 'status' in updates:
            update_fields.append("status = %s")
            values.append(updates['status'])
        
        if 'assigned_to' in updates:
            update_fields.append("assigned_to = %s")
            values.append(str(updates['assigned_to']) if updates['assigned_to'] else None)
        
        if 'priority' in updates:
            update_fields.append("priority = %s")
            values.append(updates['priority'])
        
        if 'delivery_forecast' in updates:
            df = None
            if updates['delivery_forecast']:
                try:
                    df = datetime.strptime(updates['delivery_forecast'], "%Y-%m-%d")
                except:
                    pass
            update_fields.append("delivery_forecast = %s")
            values.append(df)
        
        if 'title' in updates:
            update_fields.append("title = %s")
            values.append(updates['title'])
        
        if 'description' in updates:
            update_fields.append("description = %s")
            values.append(updates['description'])
        
        if 'category' in updates:
            update_fields.append("category = %s")
            values.append(updates['category'])

        if 'category_id' in updates:
            update_fields.append("category_id = %s")
            values.append(str(updates['category_id']) if updates['category_id'] else None)
            # Auto-update legacy category name
            if updates['category_id']:
                cur.execute("SELECT name FROM ticket_categories WHERE id = %s", (str(updates['category_id']),))
                row = cur.fetchone()
                if row:
                    update_fields.append("category = %s")
                    values.append(row[0])

        if 'subcategory_id' in updates:
            update_fields.append("subcategory_id = %s")
            values.append(str(updates['subcategory_id']) if updates['subcategory_id'] else None)
            # Auto-update legacy subcategory name
            if updates['subcategory_id']:
                cur.execute("SELECT name FROM ticket_subcategories WHERE id = %s", (str(updates['subcategory_id']),))
                row = cur.fetchone()
                if row:
                    update_fields.append("subcategory = %s")
                    values.append(row[0])
        
        if not update_fields:
            return {"message": "No fields to update"}
        
        update_fields.append("updated_at = NOW()")
        
        values.append(str(ticket_id))
        query = f"UPDATE tickets SET {', '.join(update_fields)} WHERE id = %s"
        
        cur.execute(query, tuple(values))
        conn.commit()

        # Record category reclassification in ticket history
        if old_category is not None and 'category' in updates and old_category != updates['category']:
            system_msg = f"Categoria reclassificada de '{old_category}' para '{updates['category']}'"
            cur.execute("""
                INSERT INTO ticket_updates (ticket_id, user_id, message, created_at, is_system)
                VALUES (%s, %s, %s, NOW(), TRUE)
            """, (str(ticket_id), user_id, system_msg))
            conn.commit()

        # Notify Logic (Status/Assign Change)
        if not skip_notification:
          try:
             # Fetch Ticket Details for Context
             cur.execute("""
                SELECT t.title, t.status, t.category, t.requester_id, t.assigned_to, u.name, u.sector, t.created_at 
                FROM tickets t
                LEFT JOIN users u ON t.requester_id = u.id
                WHERE t.id = %s
             """, (str(ticket_id),))
             t_row = cur.fetchone()
             
             if t_row:
                 t_title, t_status, t_cat, req_id, assign_id, req_name, req_sector, t_created = t_row
                 friendly_id = f"CH-{str(ticket_id).split('-')[0].upper()}"
                 
                 if 'status' in updates:
                     new_status = updates['status']
                     msg = f"O status do chamado foi alterado para: {new_status}"
                     short_summary = f"Status: {new_status} - {friendly_id}"
                     
                     email_html = generate_email_html(
                        "Status Atualizado", "{recipient_name}", friendly_id, t_title, 
                        new_status, t_cat, req_name if req_name else "N/A", t_created, msg, f"/tickets/{ticket_id}", datetime.now(), str(ticket_id)
                     )
                     notify_user(req_id, "Status Atualizado", short_summary, f"/tickets/{ticket_id}", conn, email_html)
                     
                     # Notify Assigned Agent too
                     if assign_id and str(assign_id) != str(req_id):
                          notify_user(assign_id, "Status Atualizado", short_summary, f"/tickets/{ticket_id}", conn, email_html)

                     target_admin_sector = req_sector
                     if t_cat and str(t_cat).upper() in ['STARSOFT', 'INFRAESTRUTURA']:
                         target_admin_sector = 'T.I'

                     notify_admins("Status Atualizado", short_summary, f"/tickets/{ticket_id}", conn, email_html, target_admin_sector, str(user_id))

                     # Notify Participants on status change
                     try:
                         cur.execute("SELECT user_id FROM ticket_participants WHERE ticket_id = %s", (str(ticket_id),))
                         for (p_id,) in cur.fetchall():
                             p_id_str = str(p_id)
                             if p_id_str != str(user_id) and p_id_str != req_id_str and p_id_str != assign_id_str:
                                 notify_user(p_id, "Status Atualizado", short_summary, f"/tickets/{ticket_id}", conn, email_html)
                     except Exception as pe:
                         print(f"Participant status notify error: {pe}")

                 if 'assigned_to' in updates and updates['assigned_to']:
                     # Check if assigned to someone
                     new_assignee_id = updates['assigned_to']
                     if new_assignee_id:
                         msg = f"Você foi atribuído ao chamado: {t_title}"
                         email_html = generate_email_html(
                            "Nova Atribuição", "{recipient_name}", friendly_id, t_title, 
                            t_status, t_cat, req_name if req_name else "N/A", t_created, msg, f"/tickets/{ticket_id}", datetime.now()
                         )
                         notify_user(new_assignee_id, "Nova Atribuição", msg, f"/tickets/{ticket_id}", conn, email_html)
          except Exception as ne:
              print(f"Notif Update Error: {ne}")
        
        return {"message": "Ticket updated successfully"}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"Error updating ticket: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.get("/public/tickets/{ticket_id}/approve", response_class=HTMLResponse)
def public_approve_ticket(ticket_id: UUID):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Fetch status AND requester name for logging
        cur.execute("""
            SELECT t.status, u.name 
            FROM tickets t
            LEFT JOIN users u ON t.requester_id = u.id
            WHERE t.id = %s
        """, (str(ticket_id),))
        row = cur.fetchone()
        
        if not row:
            return """
            <html><body style='font-family: sans-serif; text-align: center; padding: 50px;'>
                <h1 style='color: #dc2626;'>Chamado não encontrado</h1>
            </body></html>
            """
        
        current_status = row[0]
        requester_name = row[1] if row[1] else "Solicitante"

        if current_status != 'Em Validação':
             return f"""
            <html><body style='font-family: sans-serif; text-align: center; padding: 50px;'>
                <h1 style='color: #f59e0b;'>Atenção</h1>
                <p>Este chamado não está aguardando validação ou já foi processado.</p>
                <p>Status atual: <strong>{current_status}</strong></p>
            </body></html>
            """
        
        # Approve
        cur.execute("UPDATE tickets SET status = 'Concluído', updated_at = NOW() WHERE id = %s", (str(ticket_id),))
        
        # Log Update (System/Public) - Specific Message
        now_str = datetime.now().strftime("%d/%m/%Y às %H:%M")
        msg = f"✅ Aprovado pelo usuário {requester_name} em {now_str} (via Email)."
        
        cur.execute("""
            INSERT INTO ticket_updates (ticket_id, user_id, message, created_at, is_system) 
            VALUES (%s, NULL, %s, NOW(), TRUE)
        """, (str(ticket_id), msg))
        
        conn.commit()
        
        return """
        <html><body style='font-family: sans-serif; text-align: center; padding: 50px; background-color: #f0fdf4;'>
            <div style='background: white; padding: 40px; border-radius: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto;'>
                <h1 style='color: #16a34a; margin-bottom: 20px;'>Chamado Aprovado!</h1>
                <p style='color: #374151; font-size: 18px;'>O chamado foi concluído com sucesso. Obrigado!</p>
                <p style='margin-top: 30px; color: #6b7280;'>Você pode fechar esta janela.</p>
            </div>
        </body></html>
        """
    except Exception as e:
        conn.rollback()
        logger.error(f"Error in public_approve_ticket: {e}")
        return """
        <html><body style='font-family: sans-serif; text-align: center; padding: 50px;'>
            <h1 style='color: #dc2626;'>Erro ao processar</h1>
            <p>Ocorreu um erro interno. Tente novamente ou acesse o portal.</p>
        </body></html>
        """
    finally:
        cur.close()
        conn.close()

# --- Action Plans ---


@router.delete("/tickets/{ticket_id}")
def delete_ticket(ticket_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE tickets SET is_active = FALSE WHERE id = %s", (str(ticket_id),))
        
        # Clean up notifications for this ticket
        link_search = f"/tickets/{str(ticket_id)}"
        cur.execute("DELETE FROM notifications WHERE link = %s", (link_search,))
        
        conn.commit()
        return {"message": "Ticket deleted"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

@router.get("/tickets/{ticket_id}/participants")
def get_ticket_participants(ticket_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT tp.id, tp.user_id, u.name, u.email, u.sector, u.avatar, tp.created_at
            FROM ticket_participants tp
            JOIN users u ON tp.user_id = u.id
            WHERE tp.ticket_id = %s
            ORDER BY tp.created_at
        """, (str(ticket_id),))
        rows = cur.fetchall()
        return [{"id": str(r[0]), "user_id": str(r[1]), "name": r[2], "email": r[3], "sector": r[4], "avatar": r[5], "created_at": r[6].isoformat() if r[6] else None} for r in rows]
    finally:
        cur.close()
        conn.close()


@router.post("/tickets/{ticket_id}/participants")
def add_ticket_participant(ticket_id: UUID, payload: dict, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'tickets', 'can_edit'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    participant_id = payload.get("user_id")
    if not participant_id:
        raise HTTPException(status_code=400, detail="user_id é obrigatório")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO ticket_participants (ticket_id, user_id, added_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (ticket_id, user_id) DO NOTHING
            RETURNING id
        """, (str(ticket_id), str(participant_id), str(user_id)))
        conn.commit()
        row = cur.fetchone()
        if not row:
            return {"message": "Usuário já é participante deste chamado"}
        cur.execute("SELECT name FROM users WHERE id = %s", (str(participant_id),))
        p_name = cur.fetchone()
        return {"message": f"{p_name[0] if p_name else 'Usuário'} adicionado como participante"}
    finally:
        cur.close()
        conn.close()


@router.delete("/tickets/{ticket_id}/participants/{participant_user_id}")
def remove_ticket_participant(ticket_id: UUID, participant_user_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'tickets', 'can_edit'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM ticket_participants WHERE ticket_id = %s AND user_id = %s", (str(ticket_id), str(participant_user_id)))
        conn.commit()
        return {"message": "Participante removido"}
    finally:
        cur.close()
        conn.close()


@router.post("/tickets/{ticket_id}/forward")
def forward_ticket(
    ticket_id: UUID, 
    payload: dict, # {category_id, subcategory_id, reason}
    user_id: Optional[str] = Depends(get_user_id_from_session)
):
    if not user_id:
        raise HTTPException(status_code=401, detail="User ID is required")
        
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Check if user is T.I or GI
        cur.execute("SELECT sector FROM users WHERE id = %s", (user_id,))
        user_row = cur.fetchone()
        if not user_row or (user_row[0] or "").upper() not in ['T.I', 'GESTÃO DE INFORMAÇÃO']:
             raise HTTPException(status_code=403, detail="Somente usuários de T.I ou Gestão de Informação podem reencaminhar chamados.")

        category_id = payload.get('category_id')
        subcategory_id = payload.get('subcategory_id')
        reason = payload.get('reason', 'Chamado reencaminhado.')

        if not category_id:
             raise HTTPException(status_code=400, detail="Category ID is required for forwarding.")

        # Resolve names
        cur.execute("SELECT name, sector FROM ticket_categories WHERE id = %s", (category_id,))
        cat_row = cur.fetchone()
        if not cat_row:
             raise HTTPException(status_code=404, detail="Category not found.")
        cat_name, cat_sector = cat_row

        sub_name = None
        if subcategory_id:
            cur.execute("SELECT name FROM ticket_subcategories WHERE id = %s", (subcategory_id,))
            sub_row = cur.fetchone()
            if sub_row:
                sub_name = sub_row[0]

        # Update ticket
        cur.execute("""
            UPDATE tickets 
            SET category_id = %s, subcategory_id = %s, category = %s, subcategory = %s, assigned_to = NULL, updated_at = NOW()
            WHERE id = %s
        """, (category_id, subcategory_id, cat_name, sub_name, str(ticket_id)))

        # Add history
        sub_info = f" › {sub_name}" if sub_name else ""
        history_msg = f"🔄 Chamado reclassificado/encaminhado.\nSetor: {cat_sector}\nCategoria: {cat_name}{sub_info}"
        if reason and reason != 'Chamado reencaminhado.':
            history_msg += f"\nMotivo: {reason}"
        cur.execute("""
            INSERT INTO ticket_updates (ticket_id, user_id, message, is_system)
            VALUES (%s, %s, %s, FALSE)
        """, (str(ticket_id), user_id, history_msg))

        conn.commit()
        return {"message": f"Chamado reencaminhado para {cat_sector} com sucesso."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.get("/ticket-updates/{update_id}/attachment")
def download_ticket_update_attachment(update_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT attachment_name, attachment_path FROM ticket_updates WHERE id = %s",
            (str(update_id),),
        )
        row = cur.fetchone()
        if not row or not row[1]:
            raise HTTPException(status_code=404, detail="Anexo não encontrado.")
        original_name, attachment_path = row[0], row[1]
        safe_name = os.path.basename(attachment_path)
        file_path = os.path.join(UPLOAD_DIR, safe_name)
        if not os.path.isfile(file_path):
            raise HTTPException(status_code=404, detail="Arquivo não encontrado no servidor.")
        download_name = original_name or safe_name
        return FileResponse(file_path, filename=download_name)
    finally:
        cur.close()
        conn.close()

