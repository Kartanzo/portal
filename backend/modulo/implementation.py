from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header, BackgroundTasks, Depends
from typing import Optional, List, Dict, Any, cast
from uuid import UUID
from datetime import datetime
import os
import re
import shutil
import copy

from db_utils import get_db_connection
from permission_utils import check_module_permission, load_role_permissions
from core.config import UPLOAD_DIR, FRONTEND_URL
from core.email import send_implementation_schedule_email
from schemas.implementation import ImplementationScheduleCreate, ImplementationScheduleUpdate, ImplementationScheduleItemCreate, ImplementationScheduleItemUpdate
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



# --- Implementation Schedules ---

@router.get("/implementation-schedules")
def get_implementation_schedules(sector: Optional[str] = None, user_id: Optional[str] = None):
    if not check_module_permission(user_id or '', 'impl_action_plan'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # AUTO-UPDATE DELAYED STATUS
        try:
            cur.execute("""
                UPDATE implementation_schedule_items
                SET status = 'Atrasado', updated_at = NOW()
                WHERE is_active = TRUE 
                AND status NOT IN ('Concluído', 'Suspenso', 'Atrasado')
                AND schedule_end < CURRENT_DATE
            """)
            conn.commit()
        except Exception as e:
            print(f"Auto-update delay error (impl): {e}")
            conn.rollback()

        # Access Control
        allowed_sectors_filter = None
        is_restricted = False
        if user_id:
            context = get_user_context(user_id, conn)
            if context and not context['is_super_user'] and not context['is_ceo']:
                perms = context['permissions'].get('impl_action_plan', {})
                if not perms.get('view_all_sectors', False):
                    is_restricted = True
                    role_allowed = perms.get('allowed_sectors', [])
                    allowed_sectors_filter = [s.lower() for s in role_allowed] if role_allowed else context['allowed_sectors']

        query_plans = "SELECT id, sector, objective, macro_theme FROM implementation_schedules WHERE is_active = TRUE"
        params_plans = []
        if sector:
            query_plans += " AND sector ILIKE %s"
            params_plans.append(f"%{sector}%")

        if is_restricted:
            if allowed_sectors_filter:
                query_plans += " AND (" + " OR ".join(["sector ILIKE %s" for _ in allowed_sectors_filter]) + ")"
                for s in allowed_sectors_filter:
                    params_plans.append(f"%{s}%")
            # Se allowed_sectors_filter vazio para admin com managed_sectors, não aplica filtro AND 1=2

        cur.execute(query_plans, tuple(params_plans))
        plans = cur.fetchall()
        
        result = []
        for p in plans:
            plan_id = p[0]
            plan_obj = {
                "id": str(plan_id),
                "sector": p[1],
                "objective": p[2],
                "responsible": [],
                "macro_theme": p[3] if len(p) > 3 else None,
                "subItems": []
            }
            
            cur.execute("""
                SELECT 
                    isi.id, isi.actions, isi.expected_result, isi.projects, isi.responsible, isi.status, 
                    isi.schedule_start, isi.schedule_end, isi.observation, 
                    isi.budget_planned, isi.budget_actual, isi.hours_planned, isi.hours_actual, 
                    isi.roi_percentage, isi.stakeholder_satisfaction, NULL as risk_level, isi.blocked_by_user_id, isi.waiting_for_return,
                    isi.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo', 
                    isi.updated_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo',
                    u_created.name as created_by_name,
                    u_updated.name as updated_by_name
                FROM implementation_schedule_items isi
                LEFT JOIN users u_created ON isi.created_by = u_created.id
                LEFT JOIN users u_updated ON isi.updated_by = u_updated.id
                WHERE isi.implementation_schedule_id = %s AND isi.is_active = TRUE
                ORDER BY isi.schedule_start ASC
            """, (str(plan_id),))
            
            items = cur.fetchall()
            for i in items:
                start_str = i[6].strftime('%Y-%m-%d') if i[6] else ''
                end_str = i[7].strftime('%Y-%m-%d') if i[7] else ''
                created_at_str = i[18].strftime('%Y-%m-%d %H:%M:%S') if i[18] else ''
                updated_at_str = i[19].strftime('%Y-%m-%d %H:%M:%S') if i[19] else ''
                
                plan_obj["subItems"].append({
                    "id": str(i[0]),
                    "actions": i[1],
                    "expectedResult": i[2],
                    "projects": i[3],
                    "responsible": i[4],
                    "status": i[5],
                    "scheduleStart": start_str,
                    "scheduleEnd": end_str,
                    "observation": i[8],
                    "budgetPlanned": float(i[9]) if i[9] is not None else 0.0,
                    "budgetActual": float(i[10]) if i[10] is not None else 0.0,
                    "hoursPlanned": int(i[11]) if i[11] is not None else 0,
                    "hoursActual": int(i[12]) if i[12] is not None else 0,
                    "roiPercentage": float(i[13]) if i[13] is not None else 0.0,
                    "stakeholderSatisfaction": int(i[14]) if i[14] is not None else 0,
                    "riskLevel": "Baixo",
                    "blockedByUserId": str(i[16]) if i[16] else None,
                    "waitingForReturn": i[17] if i[17] else [],
                    "createdAt": created_at_str,
                    "updatedAt": updated_at_str,
                    "createdByName": i[20] if i[20] else "Sistema",
                    "updatedByName": i[21] if i[21] else None
                })
            result.append(plan_obj)
        return result
    except Exception as e:
        print(f"Error getting implementation schedules: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

@router.post("/implementation-schedules")
def create_implementation_schedule(plan: ImplementationScheduleCreate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'impl_action_plan'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    if not plan.objective or not plan.objective.strip():
        raise HTTPException(status_code=400, detail="O objetivo é obrigatório.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO implementation_schedules (sector, objective, created_by, macro_theme, is_active) VALUES (%s, %s, %s, %s, TRUE) RETURNING id",
            (plan.sector, plan.objective, user_id, plan.macro_theme)
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        return {"id": str(new_id), "sector": plan.sector, "objective": plan.objective, "macro_theme": plan.macro_theme, "subItems": []}
    except Exception as e:
        conn.rollback()
        print(f"create_implementation_schedule error: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao criar cronograma: {str(e)}")
    finally:
        cur.close()
        conn.close()

@router.put("/implementation-schedules/{plan_id}")
def update_implementation_schedule(plan_id: UUID, data: dict, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'impl_action_plan'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        updates = ["objective = %s"]
        params = [data['objective']]
        if 'macro_theme' in data:
            updates.append("macro_theme = %s")
            params.append(data['macro_theme'])
        if 'sector' in data and data['sector']:
            updates.append("sector = %s")
            params.append(data['sector'])
        params.append(str(plan_id))
        cur.execute(f"UPDATE implementation_schedules SET {', '.join(updates)} WHERE id = %s", tuple(params))
        conn.commit()
        return {"message": "Implementation Schedule updated"}
    except Exception as e:
        conn.rollback()
        print(f"update_implementation_schedule error: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar cronograma: {str(e)}")
    finally:
        cur.close()
        conn.close()

@router.delete("/implementation-schedules/{plan_id}")
def delete_implementation_schedule(plan_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'impl_action_plan'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE implementation_schedules SET is_active = FALSE WHERE id = %s", (str(plan_id),))
        conn.commit()
        return {"message": "Implementation Schedule deleted"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

@router.post("/implementation-schedules/{plan_id}/items")
def create_implementation_schedule_item(plan_id: UUID, item: ImplementationScheduleItemCreate, background_tasks: BackgroundTasks = None, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'impl_action_plan'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    if not item.actions or not item.actions.strip():
        raise HTTPException(status_code=400, detail="A ação tática é obrigatória.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO implementation_schedule_items 
            (implementation_schedule_id, actions, expected_result, projects, responsible, status, schedule_start, schedule_end, observation,
             budget_planned, budget_actual, hours_planned, hours_actual, roi_percentage, stakeholder_satisfaction, blocked_by_user_id, waiting_for_return, created_by, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
            RETURNING id
            """,
            (str(plan_id), item.actions, item.expected_result, item.projects, item.responsible, item.status, item.schedule_start, item.schedule_end, item.observation,
             item.budget_planned, item.budget_actual, item.hours_planned, item.hours_actual, item.roi_percentage, item.stakeholder_satisfaction,
             None,  # blocked_by_user_id - não disponível no create
             [],  # waiting_for_return - não disponível no create
             user_id)
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        
        if background_tasks:
            cur.execute("SELECT sector, macro_theme, objective FROM implementation_schedules WHERE id = %s", (str(plan_id),))
            plan_row = cur.fetchone()
            plan_sector = plan_row[0] if plan_row else None
            plan_macro = plan_row[1] if plan_row else ""
            plan_objective = plan_row[2] if plan_row else ""

            admin_super_ids = []
            if plan_sector:
                cur.execute("""
                    SELECT id FROM users 
                    WHERE (role = 'super_user') 
                       OR (role = 'admin' AND (sector = %s OR managed_sectors LIKE %s))
                """, (plan_sector, f"%{plan_sector}%"))
                for ar in cur.fetchall():
                    admin_super_ids.append(str(ar[0]))
            
            final_recipient_ids = list(set([user_id] + admin_super_ids)) if user_id else admin_super_ids
            recipients_names = item.responsible or []

            lines = [
                ("Macro", plan_macro),
                ("Objetivo", plan_objective),
                ("Ação", item.actions),
                ("Status", item.status),
                ("Início", item.schedule_start),
                ("Fim", item.schedule_end),
                ("Responsável", ", ".join(item.responsible) if item.responsible else "-")
            ]
            
            send_implementation_schedule_email(
                background_tasks,
                f"Nova Ação de Implementação: {item.actions[:30]}...",
                f"Uma nova ação foi criada no Cronograma de Implementação ({plan_sector}).",
                lines,
                recipients_users_ids=final_recipient_ids,
                recipients_names=recipients_names
            )

        return {"id": str(new_id), "status": "created"}
    except Exception as e:
        conn.rollback()
        print(f"create_implementation_schedule_item error: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao criar item: {str(e)}")
    finally:
        cur.close()
        conn.close()

@router.put("/implementation-schedule-items/{item_id}")
def update_implementation_schedule_item(item_id: UUID, updates: ImplementationScheduleItemUpdate, background_tasks: BackgroundTasks = None, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'impl_action_plan'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT i.actions, i.status, i.schedule_end, i.responsible,
                   p.sector, p.macro_theme, p.objective, i.observation
            FROM implementation_schedule_items i
            JOIN implementation_schedules p ON i.implementation_schedule_id = p.id
            WHERE i.id = %s
        """, (str(item_id),))
        old_row = cur.fetchone()
        
        update_data = updates.dict(exclude_unset=True)
        if not update_data: return {"message": "No fields"}

        fields = []
        values = []
        if 'updated_by' in update_data:
            fields.append("updated_at = NOW()")
        
        for k, v in update_data.items():
            fields.append(f"{k} = %s")
            values.append(str(v) if isinstance(v, UUID) else v)
            
        values.append(str(item_id))
        query = f"UPDATE implementation_schedule_items SET {', '.join(fields)} WHERE id = %s"
        print(f"UPDATE query: {query}")
        print(f"Values: {values}")
        cur.execute(query, tuple(values))
        conn.commit()
        
        if background_tasks and old_row:
            old_actions, old_status, old_end, old_resp, plan_sector, plan_macro, plan_obj, old_obs = old_row
            changes = []
            if 'actions' in update_data and update_data['actions'] != old_actions:
                changes.append(("Ação", f"DE: {old_actions}<br>PARA: {update_data['actions']}"))
            if 'status' in update_data and update_data['status'] != old_status:
                changes.append(("Status", f"{old_status} -> {update_data['status']}"))
                 
            if changes:
                 admin_super_ids = []
                 if plan_sector:
                     cur.execute("""
                         SELECT id FROM users 
                         WHERE (role = 'super_user') 
                            OR (role = 'admin' AND (sector = %s OR managed_sectors LIKE %s))
                     """, (plan_sector, f"%{plan_sector}%"))
                     for ar in cur.fetchall():
                         admin_super_ids.append(str(ar[0]))
                 
                 recipients_users_ids = list(set(admin_super_ids))
                 send_implementation_schedule_email(
                     background_tasks,
                     f"Atualização em Implementação: {old_actions[:30]}...",
                     f"Um item do Cronograma de Implementação foi atualizado ({plan_macro} > {plan_obj}).",
                     changes,
                     recipients_users_ids=recipients_users_ids
                 )

        return {"message": "Item Updated"}
    except Exception as e:
        conn.rollback()
        print(f"update_implementation_schedule_item error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar item: {str(e)}")
    finally:
        cur.close()
        conn.close()

@router.delete("/implementation-schedule-items/{item_id}")
def delete_implementation_schedule_item(item_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'impl_action_plan'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE implementation_schedule_items SET is_active = FALSE WHERE id = %s", (str(item_id),))
        conn.commit()
        return {"message": "Item deleted"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

@router.post("/implementation-schedules/{item_id}/attachments")
def upload_implementation_schedule_attachment(item_id: UUID, file: UploadFile = File(...), user_id: Optional[UUID] = Form(None), auth_user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(auth_user_id or (str(user_id) if user_id else ''), 'impl_action_plan'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM implementation_schedule_items WHERE id = %s", (str(item_id),))
        if not cur.fetchone():
             raise HTTPException(status_code=404, detail="Item not found")

        schedule_dir = os.path.join(UPLOAD_DIR, "implementation_schedules")
        os.makedirs(schedule_dir, exist_ok=True)
        unique_name = f"{uuid.uuid4()}{os.path.splitext(file.filename)[1]}"
        abs_file_path = os.path.join(schedule_dir, unique_name)
        
        with open(abs_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        db_file_path = f"uploads/implementation_schedules/{unique_name}"
        file_size = os.path.getsize(abs_file_path)
        cur.execute("""
            INSERT INTO implementation_schedule_attachments (implementation_schedule_item_id, file_name, file_path, file_size, uploaded_by)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, created_at
        """, (str(item_id), file.filename, db_file_path, file_size, str(user_id) if user_id else None))
        row = cur.fetchone()
        conn.commit()
        return {"id": str(row[0]), "file_name": file.filename, "file_path": db_file_path, "created_at": row[1]}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

@router.get("/implementation-schedules/{item_id}/attachments")
def get_implementation_schedule_attachments(item_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'impl_action_plan'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT a.id, a.file_name, a.file_path, a.file_size, a.created_at, u.name 
            FROM implementation_schedule_attachments a
            LEFT JOIN users u ON a.uploaded_by = u.id
            WHERE a.implementation_schedule_item_id = %s
            ORDER BY a.created_at DESC
        """, (str(item_id),))
        rows = cur.fetchall()
        results = []
        for r in rows:
            results.append({
                "id": str(r[0]),
                "file_name": r[1],
                "file_path": r[2],
                "url": f"{API_URL}/{r[2].replace(os.path.sep, '/')}",
                "file_size": r[3],
                "created_at": r[4],
                "uploaded_by_name": r[5]
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

@router.delete("/implementation-schedules/attachments/{attachment_id}")
def delete_implementation_schedule_attachment(attachment_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'impl_action_plan'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT file_path FROM implementation_schedule_attachments WHERE id = %s", (str(attachment_id),))
        row = cur.fetchone()
        if row and os.path.exists(row[0]):
            try: os.remove(row[0])
            except: pass
        cur.execute("DELETE FROM implementation_schedule_attachments WHERE id = %s", (str(attachment_id),))
        conn.commit()
        return {"message": "Attachment deleted"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()

def seed_dummy_implementation(admin_id: str) -> dict:
    """Popula dados dummy de Cronograma de Implementação (idempotente).

    Cria 2 cronogramas (implementation_schedules) e vários itens
    (implementation_schedule_items) com datas em 2026, status variados e
    responsible/created_by = admin_id. Idempotente: usa o macro_theme como
    marca de seed; se já existir um cronograma com esse macro_theme, não recria.
    """
    SEED_TAG = "SEED_DUMMY"
    conn = get_db_connection()
    cur = conn.cursor()
    created_plans = 0
    created_items = 0
    try:
        cur.execute(
            "SELECT COUNT(*) FROM implementation_schedules WHERE macro_theme = %s",
            (SEED_TAG,),
        )
        if cur.fetchone()[0] > 0:
            return {"status": "skipped", "reason": "seed já existe", "plans": 0, "items": 0}

        plans = [
            {
                "sector": "Comercial",
                "objective": "Implantar novo CRM e padronizar o funil de vendas",
                "items": [
                    ("Mapear processo atual de vendas", "Fluxo documentado", "CRM",
                     "Em Andamento", "2026-01-05", "2026-02-15"),
                    ("Configurar pipeline no CRM", "Pipeline ativo", "CRM",
                     "Não Iniciado", "2026-02-16", "2026-03-31"),
                    ("Treinar equipe comercial", "Equipe capacitada", "Treinamento",
                     "Não Iniciado", "2026-04-01", "2026-04-30"),
                    ("Go-live e acompanhamento", "CRM em produção", "CRM",
                     "Concluído", "2026-05-01", "2026-05-20"),
                ],
            },
            {
                "sector": "Operações",
                "objective": "Reduzir lead time de produção em 20%",
                "items": [
                    ("Analisar gargalos da linha", "Relatório de gargalos", "Lean",
                     "Em Andamento", "2026-01-10", "2026-02-28"),
                    ("Reorganizar layout de fábrica", "Layout otimizado", "Lean",
                     "Não Iniciado", "2026-03-01", "2026-04-15"),
                    ("Implantar indicadores OEE", "Dashboard OEE", "BI",
                     "Suspenso", "2026-04-16", "2026-06-30"),
                ],
            },
        ]

        for p in plans:
            cur.execute(
                """
                INSERT INTO implementation_schedules
                    (sector, objective, macro_theme, created_by, is_active)
                VALUES (%s, %s, %s, %s, TRUE)
                RETURNING id
                """,
                (p["sector"], p["objective"], SEED_TAG, admin_id),
            )
            plan_id = cur.fetchone()[0]
            created_plans += 1
            for actions, expected, projects, status, start, end in p["items"]:
                cur.execute(
                    """
                    INSERT INTO implementation_schedule_items
                        (implementation_schedule_id, actions, expected_result, projects,
                         responsible, status, schedule_start, schedule_end, observation,
                         budget_planned, budget_actual, hours_planned, hours_actual,
                         roi_percentage, stakeholder_satisfaction, blocked_by_user_id,
                         waiting_for_return, created_by, is_active)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                    """,
                    (
                        str(plan_id), actions, expected, projects,
                        [admin_id], status, start, end, "Item de exemplo (seed).",
                        10000, 0, 40, 0, 0, 0, None, [], admin_id,
                    ),
                )
                created_items += 1

        conn.commit()
        return {"status": "ok", "plans": created_plans, "items": created_items}
    except Exception as e:
        conn.rollback()
        print(f"seed_dummy_implementation error: {e}")
        return {"status": "error", "error": str(e)}
    finally:
        cur.close()
        conn.close()


def seed_role_permissions() -> dict:
    """Popula a tabela role_permissions a partir de backend/role_permissions.json.

    Idempotente: usa INSERT ... ON CONFLICT (role) DO NOTHING.
    Suporta o formato real do JSON, que é uma LISTA de objetos
    {"role": ..., "permissions": {...}} (o seed do startup falha porque
    chama .items() esperando um dict). Resolve o caminho do JSON relativo
    ao diretório backend/ (este arquivo está em backend/modulo/).
    """
    import json
    json_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "role_permissions.json")
    if not os.path.exists(json_path):
        return {"status": "error", "error": f"arquivo não encontrado: {json_path}"}
    try:
        with open(json_path, encoding="utf-8") as f:
            raw = json.load(f)
    except Exception as e:
        return {"status": "error", "error": f"falha ao ler JSON: {e}"}

    # Normaliza para uma lista de (role, permissions_dict)
    pairs = []
    if isinstance(raw, list):
        for entry in raw:
            if isinstance(entry, dict) and "role" in entry:
                pairs.append((entry["role"], entry.get("permissions", {})))
    elif isinstance(raw, dict):
        for role_name, perms in raw.items():
            pairs.append((role_name, perms))
    else:
        return {"status": "error", "error": "formato de JSON inesperado"}

    conn = get_db_connection()
    cur = conn.cursor()
    inserted = 0
    try:
        for role_name, perms in pairs:
            cur.execute(
                "INSERT INTO role_permissions (role, permissions) VALUES (%s, %s) ON CONFLICT (role) DO NOTHING",
                (role_name, json.dumps(perms)),
            )
            inserted += cur.rowcount
        conn.commit()
        return {"status": "ok", "roles_in_json": len(pairs), "inserted": inserted}
    except Exception as e:
        conn.rollback()
        print(f"seed_role_permissions error: {e}")
        return {"status": "error", "error": str(e)}
    finally:
        cur.close()
        conn.close()


@router.get("/implementation-schedule-items/{item_id}/history")
def get_implementation_schedule_history(item_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'impl_action_plan'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT user_id, change_summary, created_at 
            FROM implementation_schedule_history
            WHERE implementation_schedule_item_id = %s
            ORDER BY created_at DESC
        """, (str(item_id),))
        rows = cur.fetchall()
        return [{"user_id": r[0], "change_summary": r[1], "created_at": r[2]} for r in rows]
    finally:
        cur.close()
        conn.close()


