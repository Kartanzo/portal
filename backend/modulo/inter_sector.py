from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header, BackgroundTasks, Body, Depends
from fastapi.responses import FileResponse
from typing import Optional, List
from uuid import UUID
from datetime import datetime
import os
import re
import shutil
import json
import logging

from db_utils import get_db_connection
from permission_utils import check_module_permission
from core.config import UPLOAD_DIR, FRONTEND_URL
from core.email import notify_user, notify_admins
from schemas.inter_sector import InterSectorTicketCreate, InterSectorTicketUpdate
from modulo.sectors import notify_inter_sector_users
from auth_utils import get_user_id_from_session

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/inter-sector-tickets")
def list_inter_sector_tickets(user_id: Optional[str] = Depends(get_user_id_from_session)):
    uid = user_id or ''
    has_perm = any(check_module_permission(uid, m) for m in [
        'inter_sector_tickets', 'inter_sector_kanban', 'inter_sector_schedule'
    ])
    if not has_perm:
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT role, sector, managed_sectors FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(status_code=403, detail="Usuário não encontrado.")
        role, u_sector, u_managed = u
        managed = [s.strip() for s in (u_managed or '').split(';') if s.strip()]
        allowed_sectors = list(set([u_sector] + managed)) if u_sector else managed

        if role in ('super_user', 'ceo'):
            cur.execute("""
                SELECT t.id, t.title, t.description, t.category, t.priority, t.status,
                       t.requester_id, u.name as requester_name, t.requester_sector,
                       t.target_sector, t.delivery_forecast, t.created_at, t.updated_at,
                       t.involved_sectors
                FROM inter_sector_tickets t
                LEFT JOIN users u ON t.requester_id = u.id
                WHERE t.is_active = TRUE
                ORDER BY t.created_at DESC
            """)
        else:
            # Get sector restrictions from role_permissions table (same source as frontend filter)
            perm_sectors = []
            perm_mode = 'include'
            for rname in ['user', 'admin']:
                cur2 = conn.cursor()
                cur2.execute("SELECT permissions FROM role_permissions WHERE role = %s", (rname,))
                rrow = cur2.fetchone()
                cur2.close()
                if rrow:
                    rperms = rrow[0] if isinstance(rrow[0], dict) else {}
                    for m_id in ['inter_sector_tickets', 'inter_sector_kanban', 'inter_sector_schedule']:
                        mp = rperms.get(m_id)
                        if mp and isinstance(mp, dict) and mp.get('allowed_sectors'):
                            perm_sectors = mp['allowed_sectors']
                            perm_mode = mp.get('sector_mode', 'include')
                            break
                if perm_sectors:
                    break

            sectors_arr = allowed_sectors if allowed_sectors else []
            # Normaliza para comparacao case-insensitive
            sectors_arr_lower = [s.lower() for s in sectors_arr if s]

            # Admin/usuario com managed_sectors: ve tambem chamados criados POR seu setor (origem)
            is_admin_view = (role == 'admin') or bool(managed)
            print(f"[INTER-SECTOR LIST] user={user_id} role={role} sector={u_sector} managed={managed} is_admin_view={is_admin_view} sectors_arr={sectors_arr}")

            base_params = [user_id, sectors_arr, sectors_arr]
            requester_clause = ""
            if is_admin_view and sectors_arr_lower:
                requester_clause = " OR LOWER(t.requester_sector) = ANY(%s)"
                base_params.append(sectors_arr_lower)

            perm_clause = ""
            if perm_sectors:
                if perm_mode == 'include':
                    perm_clause = " AND (t.requester_id = %s OR t.target_sector = ANY(%s))"
                    base_params += [user_id, perm_sectors]
                else:
                    perm_clause = " AND (t.requester_id = %s OR t.target_sector != ALL(%s))"
                    base_params += [user_id, perm_sectors]

            query = f"""
                SELECT t.id, t.title, t.description, t.category, t.priority, t.status,
                       t.requester_id, u.name as requester_name, t.requester_sector,
                       t.target_sector, t.delivery_forecast, t.created_at, t.updated_at,
                       t.involved_sectors
                FROM inter_sector_tickets t
                LEFT JOIN users u ON t.requester_id = u.id
                WHERE t.is_active = TRUE
                  AND (
                      t.requester_id = %s
                      OR t.target_sector = ANY(%s)
                      OR t.involved_sectors && %s::text[]
                      {requester_clause}
                  )
                {perm_clause}
                ORDER BY t.created_at DESC
            """
            cur.execute(query, base_params)

        rows = cur.fetchall()
        result = []
        for r in rows:
            result.append({
                "id": str(r[0]), "title": r[1], "description": r[2],
                "category": r[3], "priority": r[4], "status": r[5],
                "requester_id": str(r[6]) if r[6] else None,
                "requester_name": r[7], "requester_sector": r[8],
                "target_sector": r[9],
                "delivery_forecast": r[10].isoformat() if r[10] else None,
                "created_at": r[11].isoformat() if r[11] else None,
                "updated_at": r[12].isoformat() if r[12] else None,
                "involved_sectors": list(r[13]) if r[13] else [],
            })
        return result
    finally:
        cur.close()
        conn.close()


@router.post("/inter-sector-tickets")
def create_inter_sector_ticket(
    title: str = Form(...),
    description: str = Form(...),
    category: str = Form(...),
    subcategory: Optional[str] = Form(''),
    priority: str = Form(...),
    target_sector: str = Form(...),
    requester_id: str = Form(...),
    files: List[UploadFile] = File(None),
    background_tasks: BackgroundTasks = None,
    user_id: Optional[str] = Depends(get_user_id_from_session)
):
    if not check_module_permission(user_id or '', 'inter_sector_tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Busca regras da subcategoria selecionada (min_chars, require_attachment)
        min_chars = 0
        require_attachment = False
        if subcategory:
            cur.execute("""
                SELECT COALESCE(s.min_chars, 0), COALESCE(s.require_attachment, FALSE)
                FROM sector_ticket_subcategories s
                JOIN sector_ticket_categories c ON s.category_id = c.id
                WHERE s.name = %s AND c.name = %s AND c.sector ILIKE %s
            """, (subcategory, category, target_sector))
            sub_row = cur.fetchone()
            if sub_row:
                min_chars = sub_row[0]
                require_attachment = sub_row[1]

        if min_chars > 0 and (not description or len(description.strip()) < min_chars):
            raise HTTPException(status_code=400, detail=f"A descrição deve ter pelo menos {min_chars} caracteres.")

        if require_attachment and (not files or all(not f.filename for f in files)):
            raise HTTPException(status_code=400, detail="Esta subcategoria exige pelo menos um anexo.")

        # Validacao anti-spam apenas: bloqueia letras repetidas 5+ vezes (ex: "aaaaa")
        # Permite formatacao livre: quebras de linha, multiplos espacos para alinhamento, "..." etc.
        if re.search(r'([a-zA-ZÀ-ÿ])\1{4,}', description):
            raise HTTPException(status_code=400, detail="Descrição inválida (excesso de caracteres repetidos).")

        cur.execute("SELECT name, sector FROM users WHERE id = %s", (requester_id,))
        u = cur.fetchone()
        req_name = u[0] if u else "Usuário"
        req_sector = u[1] if u else None

        cur.execute("""
            INSERT INTO inter_sector_tickets
              (title, description, category, subcategory, priority, status, requester_id, requester_sector, target_sector)
            VALUES (%s, %s, %s, %s, %s, 'Aberto', %s, %s, %s)
            RETURNING id
        """, (title, description, category, subcategory or '', priority, requester_id, req_sector, target_sector))
        new_id = cur.fetchone()[0]
        conn.commit()

        # Save attachments as system entries in the updates table
        if files:
            for file in files:
                if not file.filename:
                    continue
                clean = re.sub(r'[^\w\-.]', '_', file.filename)
                safe_name = f"ist_{new_id}_{int(datetime.now().timestamp())}_{clean}"
                os.makedirs(UPLOAD_DIR, exist_ok=True)
                fp = os.path.join(UPLOAD_DIR, safe_name)
                try:
                    with open(fp, "wb") as buf:
                        shutil.copyfileobj(file.file, buf)
                    att_path = f"/uploads/{safe_name}"
                    print(f"IST upload OK: {fp}")
                except Exception as fe:
                    print(f"IST upload ERROR: UPLOAD_DIR={UPLOAD_DIR} fp={fp} err={fe}")
                    att_path = None
                cur.execute("""
                    INSERT INTO inter_sector_ticket_updates
                      (ticket_id, user_id, message, attachment_name, attachment_path, is_system)
                    VALUES (%s, %s, %s, %s, %s, TRUE)
                """, (str(new_id), requester_id, f"Anexo enviado na abertura: {file.filename}", file.filename, att_path))
            conn.commit()

        friendly_id = f"CS-{str(new_id).split('-')[0].upper()}"

        if background_tasks:
            email_body = f"""
            <div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden;">
              <div style="background:#dc2626;padding:20px;text-align:center;">
                <h2 style="color:#fff;margin:0;">Novo Chamado Entre Setores: {friendly_id}</h2>
              </div>
              <div style="padding:28px;">
                <p>Olá, <strong>{{recipient_name}}</strong>,</p>
                <p>Um novo chamado foi aberto para o setor <strong>{target_sector}</strong>.</p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                  <tr><td style="padding:8px;border-bottom:1px solid #f0f0f0;font-weight:600;">Título</td><td style="padding:8px;border-bottom:1px solid #f0f0f0;">{title}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #f0f0f0;font-weight:600;">Solicitante</td><td style="padding:8px;border-bottom:1px solid #f0f0f0;">{req_name}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #f0f0f0;font-weight:600;">Setor Origem</td><td style="padding:8px;border-bottom:1px solid #f0f0f0;">{req_sector or '-'}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #f0f0f0;font-weight:600;">Categoria</td><td style="padding:8px;border-bottom:1px solid #f0f0f0;">{category}</td></tr>
                  <tr><td style="padding:8px;font-weight:600;">Prioridade</td><td style="padding:8px;">{priority}</td></tr>
                </table>
                <div style="text-align:center;margin-top:28px;">
                  <a href="{FRONTEND_URL.rstrip('/')}/#/inter-sector-tickets/{new_id}" style="background:#dc2626;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Ver Chamado</a>
                </div>
              </div>
              <div style="background:#f4f4f4;padding:16px;text-align:center;font-size:12px;color:#999;">Sistema de Chamados 3LACKD</div>
            </div>
            """
            # Notifica setor de destino
            background_tasks.add_task(
                notify_inter_sector_users,
                target_sector,
                f"Novo chamado entre setores: {friendly_id}",
                f"Chamado '{title}' aberto para {target_sector} por {req_name}",
                f"/#/inter-sector-tickets/{new_id}",
                email_body,
                str(requester_id)
            )
            # Notifica setor solicitante
            if req_sector and req_sector != target_sector:
                background_tasks.add_task(
                    notify_inter_sector_users,
                    req_sector,
                    f"Novo chamado entre setores: {friendly_id}",
                    f"Chamado '{title}' aberto para {target_sector} por {req_name}",
                    f"/#/inter-sector-tickets/{new_id}",
                    email_body,
                    str(requester_id)
                )

        return {"id": str(new_id), "message": "Chamado criado com sucesso."}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"create_inter_sector_ticket error: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.get("/inter-sector-tickets/{ticket_id}")
def get_inter_sector_ticket(ticket_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'inter_sector_tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT t.id, t.title, t.description, t.category, t.priority, t.status,
                   t.requester_id, u.name as requester_name, t.requester_sector,
                   t.target_sector, t.delivery_forecast, t.created_at, t.updated_at,
                   t.involved_sectors
            FROM inter_sector_tickets t
            LEFT JOIN users u ON t.requester_id = u.id
            WHERE t.id = %s AND t.is_active = TRUE
        """, (str(ticket_id),))
        r = cur.fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="Chamado não encontrado.")
        return {
            "id": str(r[0]), "title": r[1], "description": r[2],
            "category": r[3], "priority": r[4], "status": r[5],
            "requester_id": str(r[6]) if r[6] else None,
            "requester_name": r[7], "requester_sector": r[8],
            "target_sector": r[9],
            "delivery_forecast": r[10].isoformat() if r[10] else None,
            "created_at": r[11].isoformat() if r[11] else None,
            "updated_at": r[12].isoformat() if r[12] else None,
            "involved_sectors": list(r[13]) if r[13] else [],
        }
    finally:
        cur.close()
        conn.close()


@router.put("/inter-sector-tickets/{ticket_id}")
def update_inter_sector_ticket(
    ticket_id: UUID,
    data: InterSectorTicketUpdate,
    background_tasks: BackgroundTasks = None,
    user_id: Optional[str] = Depends(get_user_id_from_session)
):
    if not check_module_permission(user_id or '', 'inter_sector_tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT target_sector, title, status, involved_sectors FROM inter_sector_tickets WHERE id = %s AND is_active = TRUE", (str(ticket_id),))
        t = cur.fetchone()
        if not t:
            raise HTTPException(status_code=404, detail="Chamado não encontrado.")
        target_sector, ticket_title, old_status, involved_sectors = t
        involved_sectors_list = list(involved_sectors) if involved_sectors else []

        cur.execute("SELECT role, sector, managed_sectors FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(status_code=403, detail="Usuário não encontrado.")
        role, u_sector, u_managed = u
        managed = [s.strip() for s in (u_managed or '').split(';') if s.strip()]
        allowed_user_sectors = list(set([u_sector] + managed))

        # Setores que podem editar: target_sector + involved_sectors
        allowed_ticket_sectors = [target_sector] + involved_sectors_list

        # Verifica se usuário tem permissão (super_user OU está em algum setor permitido)
        has_permission = role == 'super_user' or any(sector in allowed_user_sectors for sector in allowed_ticket_sectors)

        if not has_permission:
            raise HTTPException(status_code=403, detail="Apenas os setores envolvidos podem editar este chamado.")

        fields, params = [], []
        if data.title is not None:
            fields.append("title = %s"); params.append(data.title)
        if data.description is not None:
            fields.append("description = %s"); params.append(data.description)
        if data.category is not None:
            fields.append("category = %s"); params.append(data.category)
        if data.priority is not None:
            fields.append("priority = %s"); params.append(data.priority)
        if data.status is not None:
            fields.append("status = %s"); params.append(data.status)
        if data.delivery_forecast is not None:
            try:
                df = datetime.strptime(data.delivery_forecast, "%Y-%m-%d")
                fields.append("delivery_forecast = %s"); params.append(df)
            except:
                pass
        fields.append("updated_at = NOW()")
        params.append(str(ticket_id))
        cur.execute(f"UPDATE inter_sector_tickets SET {', '.join(fields)} WHERE id = %s", params)
        conn.commit()

        # Notificar ambos setores sobre a alteração
        if background_tasks:
            cur2 = conn.cursor()
            cur2.execute("SELECT name FROM users WHERE id = %s", (user_id,))
            editor_row = cur2.fetchone()
            editor_name = editor_row[0] if editor_row else "Usuário"
            cur2.execute("SELECT requester_sector FROM inter_sector_tickets WHERE id = %s", (str(ticket_id),))
            t2 = cur2.fetchone()
            req_sector_val = t2[0] if t2 else None
            cur2.close()

            friendly_id = f"CS-{str(ticket_id).split('-')[0].upper()}"
            changes = []
            if data.status is not None and data.status != old_status:
                changes.append(f"Status: {old_status} → {data.status}")
            if data.priority is not None:
                changes.append(f"Prioridade atualizada")
            if data.delivery_forecast is not None:
                changes.append(f"Previsão de entrega atualizada")
            change_text = "; ".join(changes) if changes else "Chamado atualizado"

            email_body = f"""
            <div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden;">
              <div style="background:#dc2626;padding:20px;text-align:center;">
                <h2 style="color:#fff;margin:0;">Chamado Atualizado: {friendly_id}</h2>
              </div>
              <div style="padding:28px;">
                <p>Olá, <strong>{{{{recipient_name}}}}</strong>,</p>
                <p>O chamado <strong>{ticket_title}</strong> foi atualizado por <strong>{editor_name}</strong>.</p>
                <p style="background:#f9f9f9;padding:12px;border-radius:6px;"><strong>Alteração:</strong> {change_text}</p>
                <div style="text-align:center;margin-top:28px;">
                  <a href="{FRONTEND_URL.rstrip('/')}/#/inter-sector-tickets/{ticket_id}" style="background:#dc2626;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Ver Chamado</a>
                </div>
              </div>
              <div style="background:#f4f4f4;padding:16px;text-align:center;font-size:12px;color:#999;">Sistema de Chamados 3LACKD</div>
            </div>
            """
            # Notifica setor de destino
            background_tasks.add_task(
                notify_inter_sector_users, target_sector,
                f"Chamado atualizado: {friendly_id}",
                f"{change_text} - por {editor_name}",
                f"/#/inter-sector-tickets/{ticket_id}", email_body, str(user_id) if user_id else None
            )
            # Notifica setor solicitante
            if req_sector_val and req_sector_val != target_sector:
                background_tasks.add_task(
                    notify_inter_sector_users, req_sector_val,
                    f"Chamado atualizado: {friendly_id}",
                    f"{change_text} - por {editor_name}",
                    f"/#/inter-sector-tickets/{ticket_id}", email_body, str(user_id) if user_id else None
                )
            # Notifica setores envolvidos
            for inv_sector in involved_sectors_list:
                if inv_sector not in [target_sector, req_sector_val]:
                    background_tasks.add_task(
                        notify_inter_sector_users, inv_sector,
                        f"Chamado atualizado: {friendly_id}",
                        f"{change_text} - por {editor_name}",
                        f"/#/inter-sector-tickets/{ticket_id}", email_body, str(user_id) if user_id else None
                    )

        return {"message": "Chamado atualizado."}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"update_inter_sector_ticket error: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.delete("/inter-sector-tickets/{ticket_id}")
def delete_inter_sector_ticket(ticket_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'inter_sector_tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT role FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u or u[0] != 'super_user':
            raise HTTPException(status_code=403, detail="Apenas super_user pode excluir chamados.")
        cur.execute("UPDATE inter_sector_tickets SET is_active = FALSE WHERE id = %s RETURNING id", (str(ticket_id),))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Chamado não encontrado.")
        conn.commit()
        return {"message": "Chamado excluído."}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        import traceback
        print(f"IST add_update ERROR: {e} {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Erro interno: {str(e)}")
    finally:
        cur.close()
        conn.close()


@router.get("/inter-sector-tickets/{ticket_id}/updates")
def get_inter_sector_ticket_updates(ticket_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'inter_sector_tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT u.id, u.user_id, usr.name, u.message, u.attachment_name, u.attachment_path, u.is_system, u.created_at
            FROM inter_sector_ticket_updates u
            LEFT JOIN users usr ON u.user_id = usr.id
            WHERE u.ticket_id = %s
            ORDER BY u.created_at ASC
        """, (str(ticket_id),))
        rows = cur.fetchall()
        return [{
            "id": str(r[0]), "user_id": str(r[1]) if r[1] else None,
            "user_name": r[2] or "Sistema", "message": r[3],
            "attachment_name": r[4], "attachment_path": r[5],
            "is_system": r[6], "created_at": r[7].isoformat() if r[7] else None
        } for r in rows]
    finally:
        cur.close()
        conn.close()


@router.post("/inter-sector-tickets/{ticket_id}/updates")
def add_inter_sector_ticket_update(
    ticket_id: UUID,
    message: str = Form(...),
    user_id_form: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    files: Optional[List[UploadFile]] = File(None),
    background_tasks: BackgroundTasks = None,
    user_id: Optional[str] = Depends(get_user_id_from_session)
):
    author_id = user_id or user_id_form
    if not check_module_permission(author_id or '', 'inter_sector_tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, title, target_sector, requester_sector, involved_sectors FROM inter_sector_tickets WHERE id = %s AND is_active = TRUE", (str(ticket_id),))
        ticket_row = cur.fetchone()
        if not ticket_row:
            raise HTTPException(status_code=404, detail="Chamado não encontrado.")
        _, ticket_title, t_target, t_requester, t_involved = ticket_row

        # Normaliza para lista de arquivos (suporta singular 'file' legacy e plural 'files')
        all_files = []
        if files:
            all_files.extend([f for f in files if f and f.filename])
        if file and file.filename:
            all_files.append(file)

        new_id = None
        if all_files:
            for idx, f in enumerate(all_files):
                clean = re.sub(r'[^\w\-.]', '_', f.filename)
                safe_name = f"ist_{ticket_id}_{int(datetime.now().timestamp())}_{idx}_{clean}"
                os.makedirs(UPLOAD_DIR, exist_ok=True)
                fp = os.path.join(UPLOAD_DIR, safe_name)
                att_name, att_path = None, None
                try:
                    with open(fp, "wb") as buf:
                        shutil.copyfileobj(f.file, buf)
                    att_name = f.filename
                    att_path = f"/uploads/{safe_name}"
                    print(f"IST reply upload OK: {fp}")
                except Exception as fe:
                    print(f"IST reply upload ERROR: UPLOAD_DIR={UPLOAD_DIR} fp={fp} err={fe}")
                msg_for_row = message if idx == 0 else ''
                cur.execute("""
                    INSERT INTO inter_sector_ticket_updates
                      (ticket_id, user_id, message, attachment_name, attachment_path)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                """, (str(ticket_id), author_id, msg_for_row, att_name, att_path))
                new_id = cur.fetchone()[0]
        else:
            cur.execute("""
                INSERT INTO inter_sector_ticket_updates
                  (ticket_id, user_id, message, attachment_name, attachment_path)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            """, (str(ticket_id), author_id, message, None, None))
            new_id = cur.fetchone()[0]
        cur.execute("UPDATE inter_sector_tickets SET updated_at = NOW() WHERE id = %s", (str(ticket_id),))
        conn.commit()

        # Notificar ambos setores sobre o novo comentário
        if background_tasks:
            cur2 = conn.cursor()
            cur2.execute("SELECT name FROM users WHERE id = %s", (author_id,))
            author_row = cur2.fetchone()
            author_name = author_row[0] if author_row else "Usuário"
            cur2.close()

            friendly_id = f"CS-{str(ticket_id).split('-')[0].upper()}"
            preview = message[:100] + "..." if len(message) > 100 else message

            email_body = f"""
            <div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden;">
              <div style="background:#dc2626;padding:20px;text-align:center;">
                <h2 style="color:#fff;margin:0;">Novo Comentário: {friendly_id}</h2>
              </div>
              <div style="padding:28px;">
                <p>Olá, <strong>{{{{recipient_name}}}}</strong>,</p>
                <p><strong>{author_name}</strong> adicionou um comentário ao chamado <strong>{ticket_title}</strong>.</p>
                <div style="background:#f9f9f9;padding:12px;border-radius:6px;border-left:4px solid #dc2626;margin:16px 0;">
                  <p style="margin:0;color:#333;">{preview}</p>
                </div>
                <div style="text-align:center;margin-top:28px;">
                  <a href="{FRONTEND_URL.rstrip('/')}/#/inter-sector-tickets/{ticket_id}" style="background:#dc2626;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Ver Chamado</a>
                </div>
              </div>
              <div style="background:#f4f4f4;padding:16px;text-align:center;font-size:12px;color:#999;">Sistema de Chamados 3LACKD</div>
            </div>
            """
            # Notifica setor de destino
            background_tasks.add_task(
                notify_inter_sector_users, t_target,
                f"Novo comentário: {friendly_id}",
                f"{author_name} comentou no chamado '{ticket_title}'",
                f"/#/inter-sector-tickets/{ticket_id}", email_body, str(author_id) if author_id else None
            )
            # Notifica setor solicitante
            if t_requester and t_requester != t_target:
                background_tasks.add_task(
                    notify_inter_sector_users, t_requester,
                    f"Novo comentário: {friendly_id}",
                    f"{author_name} comentou no chamado '{ticket_title}'",
                    f"/#/inter-sector-tickets/{ticket_id}", email_body, str(author_id) if author_id else None
                )
            # Notifica setores envolvidos
            involved_list = list(t_involved) if t_involved else []
            for inv_sector in involved_list:
                if inv_sector not in [t_target, t_requester]:
                    background_tasks.add_task(
                        notify_inter_sector_users, inv_sector,
                        f"Novo comentário: {friendly_id}",
                        f"{author_name} comentou no chamado '{ticket_title}'",
                        f"/#/inter-sector-tickets/{ticket_id}", email_body, str(author_id) if author_id else None
                    )

        return {"id": str(new_id), "message": "Comentário adicionado."}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.post("/inter-sector-tickets/{ticket_id}/forward")
def forward_inter_sector_ticket(
    ticket_id: UUID,
    sector: str = Body(..., embed=True),
    background_tasks: BackgroundTasks = None,
    user_id: Optional[str] = Depends(get_user_id_from_session)
):
    if not check_module_permission(user_id or '', 'inter_sector_tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT target_sector, title, involved_sectors FROM inter_sector_tickets WHERE id = %s AND is_active = TRUE",
            (str(ticket_id),)
        )
        t = cur.fetchone()
        if not t:
            raise HTTPException(status_code=404, detail="Chamado não encontrado.")
        target_sector, ticket_title, involved_sectors = t
        involved_sectors = list(involved_sectors) if involved_sectors else []

        cur.execute("SELECT role, sector, managed_sectors, name FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(status_code=403, detail="Usuário não encontrado.")
        role, u_sector, u_managed, u_name = u
        managed = [s.strip() for s in (u_managed or '').split(';') if s.strip()]
        allowed = list(set([u_sector] + managed))

        if role != 'super_user' and target_sector not in allowed:
            raise HTTPException(status_code=403, detail="Apenas o setor de destino pode reencaminhar este chamado.")
        if sector == target_sector:
            raise HTTPException(status_code=400, detail="O setor informado já é o setor de destino do chamado.")
        # Obs.: reencaminhar para um setor que já participou (em involved_sectors) é permitido,
        # para suportar o vai-e-volta entre setores. Só não pode ser o destino atual.

        # Adiciona o setor atual (target_sector) aos involved_sectors antes de mudar
        if target_sector not in involved_sectors:
            involved_sectors.append(target_sector)
        # O novo destino deixa de ser apenas "envolvido" e passa a ser o destino atual
        involved_sectors = [s for s in involved_sectors if s != sector]

        # Atualiza o target_sector para o novo setor e involved_sectors
        cur.execute(
            "UPDATE inter_sector_tickets SET target_sector = %s, involved_sectors = %s, updated_at = NOW() WHERE id = %s",
            (sector, involved_sectors, str(ticket_id))
        )

        friendly_id = f"CS-{str(ticket_id).split('-')[0].upper()}"
        cur.execute("""
            INSERT INTO inter_sector_ticket_updates
              (ticket_id, user_id, message, is_system)
            VALUES (%s, %s, %s, TRUE)
        """, (str(ticket_id), user_id, f"Chamado transferido de '{target_sector}' para '{sector}' por {u_name}."))

        conn.commit()

        if background_tasks:
            email_body = f"""
            <div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden;">
              <div style="background:#dc2626;padding:20px;text-align:center;">
                <h2 style="color:#fff;margin:0;">Chamado Reencaminhado: {friendly_id}</h2>
              </div>
              <div style="padding:28px;">
                <p>Olá, <strong>{{recipient_name}}</strong>,</p>
                <p>O chamado <strong>{ticket_title}</strong> foi transferido para o seu setor <strong>{sector}</strong>.</p>
                <p>O setor anterior <strong>{target_sector}</strong> continua com acesso ao histórico.</p>
                <div style="text-align:center;margin-top:28px;">
                  <a href="{FRONTEND_URL.rstrip('/')}/#/inter-sector-tickets/{ticket_id}" style="background:#dc2626;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Ver Chamado</a>
                </div>
              </div>
              <div style="background:#f4f4f4;padding:16px;text-align:center;font-size:12px;color:#999;">Sistema de Chamados 3LACKD</div>
            </div>
            """
            background_tasks.add_task(
                notify_inter_sector_users,
                sector,
                f"Chamado reencaminhado: {friendly_id}",
                f"Seu setor foi adicionado ao chamado '{ticket_title}'",
                f"/#/inter-sector-tickets/{ticket_id}",
                email_body,
                str(user_id) if user_id else None
            )

        return {"message": f"Chamado transferido de '{target_sector}' para '{sector}'.", "target_sector": sector, "involved_sectors": involved_sectors}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"forward_inter_sector_ticket error: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.get("/inter-sector-ticket-updates/{update_id}/attachment")
def download_inter_sector_attachment(update_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'inter_sector_tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT attachment_name, attachment_path FROM inter_sector_ticket_updates WHERE id = %s",
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


# ─────────────────────────────────────────────
#  Participantes (igual aos chamados da TI)
# ─────────────────────────────────────────────

@router.get("/inter-sector-tickets/{ticket_id}/participants")
def get_inter_sector_participants(ticket_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'inter_sector_tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT tp.id, tp.user_id, u.name, u.email, u.sector, tp.created_at
            FROM inter_sector_ticket_participants tp
            JOIN users u ON tp.user_id = u.id
            WHERE tp.ticket_id = %s
            ORDER BY tp.created_at
        """, (str(ticket_id),))
        rows = cur.fetchall()
        return [{"id": str(r[0]), "user_id": str(r[1]), "name": r[2], "email": r[3], "sector": r[4], "created_at": r[5].isoformat() if r[5] else None} for r in rows]
    finally:
        cur.close()
        conn.close()


@router.post("/inter-sector-tickets/{ticket_id}/participants")
def add_inter_sector_participant(ticket_id: UUID, payload: dict, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'inter_sector_tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    participant_id = payload.get("user_id")
    if not participant_id:
        raise HTTPException(status_code=400, detail="user_id é obrigatório")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO inter_sector_ticket_participants (ticket_id, user_id, added_by)
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


@router.delete("/inter-sector-tickets/{ticket_id}/participants/{participant_user_id}")
def remove_inter_sector_participant(ticket_id: UUID, participant_user_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'inter_sector_tickets'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM inter_sector_ticket_participants WHERE ticket_id = %s AND user_id = %s", (str(ticket_id), str(participant_user_id)))
        conn.commit()
        return {"message": "Participante removido"}
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    import uvicorn
    # Use port 8002 to avoid conflicts
    uvicorn.run("backend_app:app", host="0.0.0.0", port=8002, reload=True)
