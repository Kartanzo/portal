from fastapi import APIRouter, HTTPException
from typing import Optional

from db_utils import get_db_connection
from permission_utils import check_module_permission

router = APIRouter()


def get_user_context(user_id: str, conn=None):
    import copy
    from typing import Dict, Any, cast
    from permission_utils import load_role_permissions
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


@router.get("/dashboard/metrics")
def get_dashboard_metrics(user_id: Optional[str] = None):
    if not check_module_permission(user_id or '', 'overview'):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Base Access Control Logic
        ticket_where = "t.is_active = TRUE"
        ticket_params = []

        if user_id:
            context = get_user_context(user_id, conn)
            if context and not context['is_super_user'] and not context['is_ceo']:
                perms = context['permissions'].get('tickets', {})
                if not perms.get('view_all_sectors', False):
                    # STRICT CHANGE: If NOT admin, force view of ONLY own tickets.
                    if context['role'] != 'admin':
                         ticket_where += " AND (t.requester_id = %s OR t.assigned_to = %s)"
                         ticket_params.extend([user_id, user_id])
                    else:
                        # Admins see sector tickets
                        allowed = [s.strip().upper() for s in context['allowed_sectors']]
                        print(f"DEBUG Dashboard metrics for user {user_id}: allowed_sectors (upper)={allowed}, role={context['role']}")
                        if allowed:
                            # 1. Sector match condition
                            conditions = ["UPPER(u.sector) = %s" for _ in allowed]
                            sector_conditions = " OR ".join(conditions)
                            # 2. Special categories condition (if user is in T.I)
                            special_cond = ""
                            if 'T.I' in allowed:
                                special_cond = " OR UPPER(t.category) IN ('STARSOFT', 'INFRAESTRUTURA')"
                            ticket_where += f" AND ({sector_conditions}{special_cond} OR t.requester_id = %s OR t.assigned_to = %s)"
                            for s in allowed:
                                ticket_params.append(s)
                            ticket_params.extend([user_id, user_id])
                        else:
                            ticket_where += " AND (t.requester_id = %s OR t.assigned_to = %s)"
                            ticket_params.extend([user_id, user_id])

        # 1. Ticket Counts
        cur.execute(f"""
            SELECT t.status, COUNT(*)
            FROM tickets t
            LEFT JOIN users u ON t.requester_id = u.id
            LEFT JOIN ticket_categories tc ON t.category_id = tc.id
            WHERE {ticket_where}
            GROUP BY t.status
        """, tuple(ticket_params))
        status_counts = dict(cur.fetchall())

        total = sum(status_counts.values())
        open_tickets = status_counts.get('Aberto', 0)
        in_progress = status_counts.get('Em Atendimento', 0)
        closed = status_counts.get('Concluído', 0)

        # 2. Tickets by Priority
        cur.execute(f"""
            SELECT t.priority, COUNT(*)
            FROM tickets t
            LEFT JOIN users u ON t.requester_id = u.id
            LEFT JOIN ticket_categories tc ON t.category_id = tc.id
            WHERE {ticket_where}
            GROUP BY t.priority
        """, tuple(ticket_params))
        priority_counts_raw = dict(cur.fetchall())
        priority_counts = [
            {"name": k, "value": v} for k, v in priority_counts_raw.items()
        ]

        # 3. Tickets by Category
        cur.execute(f"""
            SELECT COALESCE(tc.name, t.category), COUNT(*)
            FROM tickets t
            LEFT JOIN users u ON t.requester_id = u.id
            LEFT JOIN ticket_categories tc ON t.category_id = tc.id
            WHERE {ticket_where}
            GROUP BY COALESCE(tc.name, t.category)
        """, tuple(ticket_params))
        category_counts_raw = dict(cur.fetchall())
        category_counts = [
            {"name": k, "value": v} for k, v in category_counts_raw.items()
        ]

        # 4. Success Rate (Closed / Total)
        success_rate = (float(closed) / float(total) * 100.0) if total > 0 else 0.0

        return {
            "totalTickets": int(total),
            "openTickets": int(open_tickets),
            "inProgressTickets": int(in_progress),
            "closedTickets": int(closed),
            "successRate": round(float(success_rate), 1),
            "avgResponseTime": "2.5h", # Mock
            "ticketsByPriority": priority_counts,
            "ticketsByCategory": category_counts
        }
    except Exception as e:
        print(f"Error metrics: {e}")
        raise HTTPException(status_code=500, detail="Erro interno do servidor")
    finally:
        cur.close()
        conn.close()


@router.get('/ping')
async def ping():
    return {"message": "pong"}
