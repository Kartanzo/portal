from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header, BackgroundTasks, Depends
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, validator
from datetime import datetime
import os
import re
import shutil
import copy
from typing import Dict, Any, cast

from db_utils import get_db_connection
from permission_utils import check_module_permission, load_role_permissions
from core.config import UPLOAD_DIR, FRONTEND_URL
from core.email import send_action_plan_email
from schemas.action_plan import ActionPlanCreate, ActionPlanUpdate, ActionPlanItemCreate
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

@router.get("/action-plans")
def get_action_plans(sector: Optional[str] = None, user_id: Optional[str] = None):
    if not check_module_permission(user_id or '', 'action_plans'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # AUTO-UPDATE DELAYED STATUS
        # Mark as 'Atrasado' if schedule_end < Today AND status not in (Concluído, Suspenso, Atrasado)
        try:
            cur.execute("""
                UPDATE action_plan_items
                SET status = 'Atrasado', updated_at = NOW()
                WHERE is_active = TRUE 
                AND status NOT IN ('Concluído', 'Suspenso', 'Atrasado')
                AND schedule_end < CURRENT_DATE
            """)
            conn.commit()
        except Exception as e:
            print(f"Auto-update delay error: {e}")
            conn.rollback()

        # 1. Access Control Logic for Sectors
        # Resolve which sectors the user is allowed to see
        allowed_sectors_filter = None
        is_restricted = False
        
        if user_id:
            context = get_user_context(user_id, conn)
            if context and not context['is_super_user']:
                perms = context['permissions'].get('action_plans', {})
                if not perms.get('view_all_sectors', False):
                    is_restricted = True
                    # Usa os setores permitidos pela role; fallback nos setores pessoais do usuário
                    role_allowed = perms.get('allowed_sectors', [])
                    allowed_sectors_filter = [s.lower() for s in role_allowed] if role_allowed else context['allowed_sectors']

        # Fetch Plans (Themes) - Use ILIKE for multi-sector support
        # Added macro_theme and created_by to select
        query_plans = """
            SELECT ap.id, ap.sector, ap.objective, ap.macro_theme, u.name as created_by_name
            FROM action_plans ap
            LEFT JOIN users u ON ap.created_by = u.id
            WHERE ap.is_active = TRUE
        """
        params_plans = []
        if sector:
            query_plans += " AND ap.sector ILIKE %s"
            params_plans.append(f"%{sector}%")
        
        # Security Filter
        if is_restricted:
            if allowed_sectors_filter:
                # Handle multi-sector plans: The plan's sector column must contain at least one of the allowed sectors
                query_plans += " AND (" + " OR ".join(["ap.sector ILIKE %s" for _ in allowed_sectors_filter]) + ")"
                for s in allowed_sectors_filter:
                    params_plans.append(f"%{s}%")
            else:
                # Restricted but no sectors? See nothing.
                query_plans += " AND 1=2" 

        cur.execute(query_plans, tuple(params_plans))
        plans = cur.fetchall()
        
        result = []
        
        # PT-BR Month Map
        month_map_rev = {
            1: 'Jan', 2: 'Fev', 3: 'Mar', 4: 'Abr', 5: 'Mai', 6: 'Jun', 
            7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Out', 11: 'Nov', 12: 'Dez'
        }

        for p in plans:
            plan_id = p[0]
            
            plan_obj = {
                "id": str(plan_id),
                "sector": p[1],
                "objective": p[2],
                "responsible": [],
                "macro_theme": p[3] if len(p) > 3 else None,
                "createdByName": p[4] if len(p) > 4 else None,
                "subItems": []
            }
            
            # Fetch Items for this plan with audit info
            cur.execute("""
                SELECT 
                    api.id, api.actions, api.expected_result, api.projects, api.responsible, api.status, 
                    api.schedule_start, api.schedule_end, api.observation, 
                    api.budget_planned, api.budget_actual, api.hours_planned, api.hours_actual, 
                    api.roi_percentage, api.stakeholder_satisfaction, NULL as risk_level, api.blocked_by_user_id, api.waiting_for_return,
                    api.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo', 
                    api.updated_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo',
                    u_created.name as created_by_name,
                    u_updated.name as updated_by_name
                FROM action_plan_items api
                LEFT JOIN users u_created ON api.created_by = u_created.id
                LEFT JOIN users u_updated ON api.updated_by = u_updated.id
                WHERE api.action_plan_id = %s AND api.is_active = TRUE
                ORDER BY api.schedule_start ASC
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
                    "responsible": i[4], # Array
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
                    "riskLevel": "Baixo", # Deprecated/Removed from UI, defaulting to Baixo if needed by frontend types temporarily
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
        import traceback
        error_detail = f"Erro ao buscar planos de ação: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Erro ao buscar planos de ação: {str(e)}")
    finally:
        cur.close()
        conn.close()

@router.post("/action-plans")
def create_action_plan(plan: ActionPlanCreate, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'action_plans'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    # Validation
    if not plan.objective or not plan.objective.strip():
        raise HTTPException(status_code=400, detail="O objetivo é obrigatório.")
    if not plan.macro_theme or not plan.macro_theme.strip():
        raise HTTPException(status_code=400, detail="O macro tema é obrigatório.")
    if not plan.sector or not plan.sector.strip():
        raise HTTPException(status_code=400, detail="O setor é obrigatório.")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Anti-duplicidade: nome do objetivo é único independente da classificação (macro_theme) ou setor.
        # Comparação case-insensitive, ignorando espaços extras.
        cur.execute(
            """
            SELECT macro_theme FROM action_plans
            WHERE is_active = TRUE
              AND LOWER(BTRIM(objective)) = LOWER(BTRIM(%s))
            LIMIT 1
            """,
            (plan.objective,)
        )
        existing = cur.fetchone()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Já existe um objetivo com este nome na classificação {existing[0] or 'outra'}."
            )

        # Sector can be comma separated
        cur.execute(
            "INSERT INTO action_plans (sector, objective, created_by, macro_theme, is_active) VALUES (%s, %s, %s, %s, TRUE) RETURNING id",
            (plan.sector, plan.objective, str(plan.created_by) if plan.created_by else None, plan.macro_theme)
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        return {"id": str(new_id), "sector": plan.sector, "objective": plan.objective, "macro_theme": plan.macro_theme, "subItems": []}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        import traceback
        error_detail = f"Erro ao criar plano de ação: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Erro ao criar plano de ação: {str(e)}")
    finally:
        cur.close()
        conn.close()

class ActionPlanItemCreate(BaseModel):
    actions: str
    expected_result: str
    projects: str
    responsible: List[str] = []
    status: str = 'Não Iniciado'
    schedule_start: str
    schedule_end: str
    observation: Optional[str] = ''
    budget_planned: Optional[float] = 0.0
    budget_actual: Optional[float] = 0.0
    hours_planned: Optional[int] = 0
    hours_actual: Optional[int] = 0
    roi_percentage: Optional[float] = 0.0
    stakeholder_satisfaction: Optional[int] = 0
    blocked_by_user_id: Optional[UUID] = None
    waiting_for_return: Optional[List[str]] = []
    created_by: Optional[UUID] = None

    @validator('blocked_by_user_id', 'created_by', pre=True)
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v

class ActionPlanItemUpdate(BaseModel):
    actions: Optional[str] = None
    expected_result: Optional[str] = None
    projects: Optional[str] = None
    responsible: Optional[List[str]] = None
    status: Optional[str] = None
    schedule_start: Optional[str] = None
    schedule_end: Optional[str] = None
    observation: Optional[str] = None
    budget_planned: Optional[float] = None
    budget_actual: Optional[float] = None
    hours_planned: Optional[int] = None
    hours_actual: Optional[int] = None
    roi_percentage: Optional[float] = None
    stakeholder_satisfaction: Optional[int] = None
    blocked_by_user_id: Optional[UUID] = None
    waiting_for_return: Optional[List[str]] = None
    updated_by: Optional[UUID] = None # Capture who made the change

    @validator('blocked_by_user_id', 'updated_by', pre=True)
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v

class ActionPlanAttachment(BaseModel):
    id: UUID
    action_plan_item_id: UUID
    file_name: str
    file_path: str
    file_size: Optional[int] = None
    uploaded_by: Optional[UUID] = None
    created_at: Optional[datetime] = None

class ImplementationScheduleCreate(BaseModel):
    sector: str
    objective: str
    macro_theme: str
    created_by: Optional[UUID] = None

class ImplementationScheduleItemCreate(BaseModel):
    actions: str
    expected_result: str
    projects: str
    responsible: List[str] = []
    status: str = 'Não Iniciado'
    schedule_start: str
    schedule_end: str
    observation: Optional[str] = ''
    budget_planned: Optional[float] = 0.0
    budget_actual: Optional[float] = 0.0
    hours_planned: Optional[int] = 0
    hours_actual: Optional[int] = 0
    roi_percentage: Optional[float] = 0.0
    stakeholder_satisfaction: Optional[int] = 0
    blocked_by_user_id: Optional[UUID] = None
    waiting_for_return: Optional[List[str]] = []
    created_by: Optional[UUID] = None

    @validator('blocked_by_user_id', 'created_by', pre=True)
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v

class ImplementationScheduleItemUpdate(BaseModel):
    actions: Optional[str] = None
    expected_result: Optional[str] = None
    projects: Optional[str] = None
    responsible: Optional[List[str]] = None
    status: Optional[str] = None
    schedule_start: Optional[str] = None
    schedule_end: Optional[str] = None
    observation: Optional[str] = None
    budget_planned: Optional[float] = None
    budget_actual: Optional[float] = None
    hours_planned: Optional[int] = None
    hours_actual: Optional[int] = None
    roi_percentage: Optional[float] = None
    stakeholder_satisfaction: Optional[int] = None
    blocked_by_user_id: Optional[UUID] = None
    waiting_for_return: Optional[List[str]] = None
    updated_by: Optional[UUID] = None

    @validator('blocked_by_user_id', 'updated_by', pre=True)
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v

class ImplementationScheduleAttachment(BaseModel):
    id: UUID
    implementation_schedule_item_id: UUID
    file_name: str
    file_path: str
    file_size: Optional[int] = None
    uploaded_by: Optional[UUID] = None
    created_at: Optional[datetime] = None

@router.put("/action-plan-items/{item_id}")
def update_action_plan_item(item_id: UUID, updates: ActionPlanItemUpdate, background_tasks: BackgroundTasks = None, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'action_plans'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Fetch OLD item for Diff and Notification Context
        cur.execute("""
            SELECT i.actions, i.status, i.schedule_end, i.responsible, i.waiting_for_return, 
                   p.sector, p.macro_theme, p.objective, i.observation
            FROM action_plan_items i
            JOIN action_plans p ON i.action_plan_id = p.id
            WHERE i.id = %s
        """, (str(item_id),))
        old_row = cur.fetchone()
        
        update_data = updates.dict(exclude_unset=True)
        
        if not update_data:
             return {"message": "No fields"}

        fields = []
        values = []
        
        # Auto-update updated_at and capture updated_by
        if 'updated_by' in update_data:
            fields.append("updated_at = NOW()")
        
        for k, v in update_data.items():
            fields.append(f"{k} = %s")
            # If v is a list, psycopg2 will handle it as a Postgres array, but we must not str() it.
            if isinstance(v, list):
                values.append(v)
            else:
                values.append(str(v) if isinstance(v, UUID) else v)
            
        values.append(str(item_id))
        query = f"UPDATE action_plan_items SET {', '.join(fields)} WHERE id = %s"
        
        cur.execute(query, tuple(values))
        conn.commit()
        
        # --- NOTIFICATION LOGIC & HISTORY ---
        if old_row:
            old_actions, old_status, old_end, old_resp, old_waiting, plan_sector, plan_macro, plan_obj, old_obs = old_row
            
            # Calculate Diff
            def _fmt(v):
                if isinstance(v, (list, tuple)):
                    return ", ".join(str(x) for x in v) if v else "—"
                return str(v) if v not in (None, "") else "—"
            changes = []
            if 'actions' in update_data and update_data['actions'] != old_actions:
                changes.append(("Ação", f"DE: {old_actions}<br>PARA: {update_data['actions']}"))
            if 'status' in update_data and update_data['status'] != old_status:
                changes.append(("Status", f"{old_status} -> {update_data['status']}"))
            if 'observation' in update_data and update_data['observation'] != old_obs:
                 changes.append(("Observação", "Atualizada"))
            if 'waiting_for_return' in update_data and update_data['waiting_for_return'] != old_waiting:
                 changes.append(("Aguardando", f"{_fmt(old_waiting)} → {_fmt(update_data['waiting_for_return'])}"))
                 
            # --- RECORD HISTORY ---
            if changes:
                summary_parts = []
                for field, desc in changes:
                    summary_parts.append(f"{field}: {desc.replace('<br>', ' ')}")
                
                summary_text = " | ".join(summary_parts)
                
                cur.execute("""
                    INSERT INTO action_plan_history (item_id, user_id, change_summary)
                    VALUES (%s, %s, %s)
                """, (str(item_id), str(updates.updated_by) if updates.updated_by else None, summary_text))
                conn.commit()

            # If significant changes, send email
            if changes and background_tasks:
                 # Find Admins + Super Users
                 admin_super_ids = []
                 if plan_sector:
                     cur.execute("""
                         SELECT id FROM users 
                         WHERE (role = 'super_user') 
                            OR (role = 'admin' AND (sector = %s OR managed_sectors LIKE %s))
                     """, (plan_sector, f"%{plan_sector}%"))
                     for ar in cur.fetchall():
                         admin_super_ids.append(str(ar[0]))
                 
                 # Add Updater if known (updated_by)? Maybe not needed if they did it.
                 # Add Responsibility owners? User didn't ask explicitly but it's good practice. 
                 # User said: "send to admin do setor" and "copy super user".
                 
                 recipients_users_ids = list(set(admin_super_ids))
                 
                 email_title = f"Atualização no Plano: {plan_macro} > {plan_obj}"
                 intro = f"O item de ação foi atualizado. Veja as mudanças abaixo:"
                 
                 send_action_plan_email(
                     background_tasks,
                     f"Atualização em Ação: {old_actions[:30]}...",
                     intro,
                     changes,
                     recipients_users_ids=recipients_users_ids
                 )

        return {"message": "Item Updated"}
    except Exception as e:
        conn.rollback()
        import traceback
        error_detail = f"Erro ao atualizar item: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)  # Log completo no console
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar item: {str(e)}")
    finally:
        cur.close()
        conn.close()


@router.get("/action-plan-items/{item_id}/history")
def get_action_plan_history(item_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'action_plans'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT u.name as user_name, h.change_summary, h.created_at
            FROM action_plan_history h
            LEFT JOIN users u ON h.user_id = u.id
            WHERE h.item_id = %s
            ORDER BY h.created_at DESC
        """, (str(item_id),))
        rows = cur.fetchall()

        results = []
        for r in rows:
            results.append({
                "user_name": r[0] if r[0] else "Sistema",
                "change_summary": r[1],
                "created_at": r[2].strftime('%Y-%m-%d %H:%M:%S') if r[2] else ''
            })
        return results
    except Exception as e:
        import traceback
        error_detail = f"Erro ao buscar histórico: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)  # Log completo no console
        raise HTTPException(status_code=500, detail=f"Erro ao buscar histórico: {str(e)}")
    finally:
        cur.close()
        conn.close()

@router.post("/action-plans/{plan_id}/items")
def create_action_plan_item(plan_id: UUID, item: ActionPlanItemCreate, background_tasks: BackgroundTasks = None, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'action_plans'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    # Validation
    if not item.actions or not item.actions.strip():
        raise HTTPException(status_code=400, detail="A ação tática é obrigatória.")
    if not item.schedule_start or not item.schedule_end:
        raise HTTPException(status_code=400, detail="As datas de início e término são obrigatórias.")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Date Parsing Logic
        start_date = item.schedule_start
        end_date = item.schedule_end
        
        # blocked_by_user_id
        blocked_uuid = str(item.blocked_by_user_id) if hasattr(item, 'blocked_by_user_id') and item.blocked_by_user_id else None
        
        # responsible as ARRAY (Postgres handles lists as arrays)
        responsible_list = item.responsible if item.responsible else []

        cur.execute(
            """
            INSERT INTO action_plan_items 
            (action_plan_id, actions, expected_result, projects, responsible, status, schedule_start, schedule_end, observation,
             budget_planned, budget_actual, hours_planned, hours_actual, roi_percentage, stakeholder_satisfaction, blocked_by_user_id, waiting_for_return, created_by, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
            RETURNING id
            """,
            (str(plan_id), item.actions, item.expected_result, item.projects, responsible_list, item.status, start_date, end_date, item.observation,
             item.budget_planned, item.budget_actual, item.hours_planned, item.hours_actual, item.roi_percentage, item.stakeholder_satisfaction, blocked_uuid,
             item.waiting_for_return if hasattr(item, 'waiting_for_return') and item.waiting_for_return else [],
             str(item.created_by) if hasattr(item, 'created_by') and item.created_by else None)
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        
        # Email Notification (Create)
        if background_tasks:
             recipients_ids = []
             if item.created_by: recipients_ids.append(str(item.created_by))
             if item.waiting_for_return: recipients_ids.extend(item.waiting_for_return) # Assuming these are Names? Wait, type def says string. Usually names in this legacy app. If IDs, code adapts.
             
             # Check if waiting_for_return are UUIDs or Names. In types.ts it says string[].
             # If they are names, 'recipients_names' handles it. If UUID strings, 'recipients_users_ids' handles it.
             # Let's pass to both lists conservatively? 
             # Actually, creating a helper to distinguish might be overkill.
             # The 'send_action_plan_email' tries ID lookup first, then Name lookup. 
             # So we can pass everything to 'recipients_names' if we are unsure, but names won't match UUID format.
             # In ActionPlanItemCreate, 'responsible' is List[str] (Names usually).
             # 'waiting_for_return' is Optional[List[str]].
             
             recipients_names = item.responsible if item.responsible else []
             # waiting_for_return could be IDs or Names.
             
             # --- NEW NOTIFICATION LOGIC ---
             # 1. Fetch Plan Sector to find Admins
             cur.execute("SELECT sector, macro_theme, objective FROM action_plans WHERE id = %s", (str(plan_id),))
             plan_row = cur.fetchone()
             plan_sector = plan_row[0] if plan_row else None
             plan_macro = plan_row[1] if plan_row else ""
             plan_objective = plan_row[2] if plan_row else ""

             # 2. Find Admins of this Sector + Super Users
             admin_super_ids = []
             if plan_sector:
                 # Find Admins of this sector (using ILIKE for flexibility or array check if 'allowed_sectors' used)
                 # Assuming 'sector' column in users is the primary sector, or checking 'allowed_sectors'. 
                 # For simplicity and robustness based on 'admin do setor', we check if user.sector == plan_sector OR 'super_user'
                 # But 'super_user' is role. 'admin' is role.
                 cur.execute("""
                     SELECT id FROM users 
                     WHERE (role = 'super_user') 
                        OR (role = 'admin' AND (sector = %s OR managed_sectors LIKE %s))
                 """, (plan_sector, f"%{plan_sector}%"))
                 admin_rows = cur.fetchall()
                 for ar in admin_rows:
                     admin_super_ids.append(str(ar[0]))
            
             # Combine lists
             final_recipient_ids = list(set(recipients_ids + admin_super_ids))

             lines = [
                 ("Macro", plan_macro),
                 ("Objetivo", plan_objective),
                 ("Ação", item.actions),
                 ("Status", item.status),
                 ("Início", item.schedule_start),
                 ("Fim", item.schedule_end),
                 ("Responsável", ", ".join(item.responsible) if item.responsible else "-")
             ]
             
             # For waiting_for_return, if they are names:
             recipients_names.extend(item.waiting_for_return if item.waiting_for_return else [])

             send_action_plan_email(
                 background_tasks,
                 f"Nova Ação Criada: {item.actions[:30]}...",
                 f"Uma nova ação foi criada no setor {plan_sector}.",
                 lines,
                 recipients_users_ids=final_recipient_ids,
                 recipients_names=recipients_names
             )

        return {"id": str(new_id), "status": "created"}
    except Exception as e:
        conn.rollback()
        import traceback
        error_detail = f"Erro ao criar item do plano: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Erro ao criar item do plano: {str(e)}")
    finally:
        cur.close()
        conn.close()

# Users Endpoints (Existing)
@router.delete("/action-plans/{plan_id}")
def delete_action_plan(plan_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'action_plans'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE action_plans SET is_active = FALSE WHERE id = %s", (str(plan_id),))
        conn.commit()
        return {"message": "Action Plan deleted"}
    except Exception as e:
        conn.rollback()
        import traceback
        error_detail = f"Erro ao deletar plano: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Erro ao deletar plano: {str(e)}")
    finally:
        cur.close()
        conn.close()

@router.delete("/action-plan-items/{item_id}")
def delete_action_plan_item(item_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'action_plans'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE action_plan_items SET is_active = FALSE WHERE id = %s", (str(item_id),))
        conn.commit()
        return {"message": "Action Plan Item deleted"}
    except Exception as e:
        conn.rollback()
        import traceback
        error_detail = f"Erro ao deletar item: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Erro ao deletar item: {str(e)}")
    finally:
        cur.close()
        conn.close()

# --- Action Plan Attachments Endpoints ---

@router.post("/action-plans/{item_id}/attachments")
def upload_action_plan_attachment(item_id: UUID, file: UploadFile = File(...), user_id: Optional[UUID] = Form(None), auth_user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(auth_user_id or (str(user_id) if user_id else ''), 'action_plans'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Verify Item Exists
        cur.execute("SELECT id FROM action_plan_items WHERE id = %s", (str(item_id),))
        if not cur.fetchone():
             raise HTTPException(status_code=404, detail="Action Plan Item not found")

        # Save File
        action_plans_dir = os.path.join(UPLOAD_DIR, "action_plans")
        os.makedirs(action_plans_dir, exist_ok=True)
        
        # Unique Filename
        file_ext = os.path.splitext(file.filename)[1]
        unique_name = f"{uuid.uuid4()}{file_ext}"
        abs_file_path = os.path.join(action_plans_dir, unique_name)
        
        with open(abs_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # DB Path (relative to project root for URL construction)
        db_file_path = f"uploads/action_plans/{unique_name}"
        
        # Insert DB
        file_size = os.path.getsize(abs_file_path)
        cur.execute("""
            INSERT INTO action_plan_attachments (action_plan_item_id, file_name, file_path, file_size, uploaded_by)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, created_at
        """, (str(item_id), file.filename, db_file_path, file_size, str(user_id) if user_id else None))
        
        row = cur.fetchone()
        new_id = row[0]
        created_at = row[1]
        
        conn.commit()
        
        return {
            "id": str(new_id),
            "file_name": file.filename,
            "file_path": db_file_path,
            "created_at": created_at
        }
    except Exception as e:
        conn.rollback()
        import traceback
        error_detail = f"Erro ao fazer upload: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Erro ao fazer upload: {str(e)}")
    finally:
        cur.close()
        conn.close()

@router.get("/action-plans/{item_id}/attachments")
def get_action_plan_attachments(item_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'action_plans'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT a.id, a.file_name, a.file_path, a.file_size, a.created_at, u.name 
            FROM action_plan_attachments a
            LEFT JOIN users u ON a.uploaded_by = u.id
            WHERE a.action_plan_item_id = %s
            ORDER BY a.created_at DESC
        """, (str(item_id),))
        
        rows = cur.fetchall()
        results = []
        for r in rows:
            # Construct public URL. Assuming 'uploads' is mounted as static.
            # If mounted at /uploads, then url is /uploads/action_plans/filename
            # But file_path is uploads/action_plans/filename.
            # We need to ensure path separator is correct for web.
            relative_path = r[2].replace(os.path.sep, '/')
            url = f"{API_URL}/{relative_path}" 
            
            results.append({
                "id": str(r[0]),
                "file_name": r[1],
                "file_path": r[2],
                "url": url,
                "file_size": r[3],
                "created_at": r[4],
                "uploaded_by_name": r[5]
            })
            
        return results
    except Exception as e:
        import traceback
        error_detail = f"Erro ao buscar anexos: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Erro ao buscar anexos: {str(e)}")
    finally:
        cur.close()
        conn.close()

@router.delete("/action-plans/attachments/{attachment_id}")
def delete_action_plan_attachment(attachment_id: UUID, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'action_plans'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Get path to delete file
        cur.execute("SELECT file_path FROM action_plan_attachments WHERE id = %s", (str(attachment_id),))
        row = cur.fetchone()
        if row:
            try:
                if os.path.exists(row[0]):
                    os.remove(row[0])
            except:
                pass # Continue to delete from DB even if file missing
        
        cur.execute("DELETE FROM action_plan_attachments WHERE id = %s", (str(attachment_id),))
        conn.commit()
        return {"message": "Attachment deleted"}
    except Exception as e:
        conn.rollback()
        import traceback
        error_detail = f"Erro ao deletar anexo: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Erro ao deletar anexo: {str(e)}")
    finally:
        cur.close()
        conn.close()

@router.put("/action-plans/{plan_id}")
def update_action_plan(plan_id: UUID, data: dict, user_id: Optional[str] = Depends(get_user_id_from_session)):
    if not check_module_permission(user_id or '', 'action_plans'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        print(f"[DEBUG PUT] Received data: {data}")

        # Anti-duplicidade: nome do objetivo é único independente da classificação/setor.
        if data.get('objective'):
            cur.execute(
                """
                SELECT macro_theme FROM action_plans
                WHERE is_active = TRUE
                  AND id <> %s
                  AND LOWER(BTRIM(objective)) = LOWER(BTRIM(%s))
                LIMIT 1
                """,
                (str(plan_id), data['objective'])
            )
            existing = cur.fetchone()
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail=f"Já existe um objetivo com este nome na classificação {existing[0] or 'outra'}."
                )

        updates = ["objective = %s"]
        params = [data['objective']]
        
        if 'macro_theme' in data:
            updates.append("macro_theme = %s")
            params.append(data['macro_theme'])
        
        if 'sector' in data and data['sector']:
            updates.append("sector = %s")
            params.append(data['sector'])
        
        params.append(str(plan_id))
        sql = f"UPDATE action_plans SET {', '.join(updates)} WHERE id = %s"
        print(f"[DEBUG PUT] SQL: {sql}, params: {params}")
        cur.execute(sql, tuple(params))
        conn.commit()
        return {"message": "Action Plan updated"}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        import traceback
        error_detail = f"Erro ao atualizar plano: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar plano: {str(e)}")
    finally:
        cur.close()
        conn.close()




# --- Implementation Schedules ---

