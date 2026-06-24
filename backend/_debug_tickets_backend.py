from db_utils import get_db_connection
from modulo.tickets import get_user_context

conn = get_db_connection()
cur = conn.cursor()

# Get Daniel's user context
cur.execute("SELECT id FROM users WHERE name = 'Usuário 7'")
daniel_id = str(cur.fetchone()[0])

context = get_user_context(daniel_id, conn)
print("Context for Daniel:", context)

# Replicate get_tickets logic
query = """
    SELECT t.id, t.title, t.description, t.status, t.priority, t.category, t.requester_id, t.assigned_to, 
           u.name as requester_name, u.sector as requester_sector
    FROM tickets t
    LEFT JOIN users u ON t.requester_id = u.id
    LEFT JOIN users au ON t.assigned_to = au.id
    LEFT JOIN ticket_categories tc ON t.category_id = tc.id
    WHERE t.is_active = TRUE
"""
params = []

if not context['is_super_user'] and not context['is_ceo']:
    perms = context['permissions'].get('tickets', {})
    print("Tickets perms:", perms)
    if not perms.get('view_all_sectors', False):
        if context['role'] != 'admin':
             query += " AND (t.requester_id = %s OR t.assigned_to = %s)"
             params.extend([daniel_id, daniel_id])
        else:
            perm_sectors = perms.get('allowed_sectors', [])
            print("Allowed sectors in perms:", perm_sectors)
            allowed = [s.strip().upper() for s in perm_sectors if s.strip()]
            if allowed:
                conditions = ["UPPER(tc.sector) = %s" for _ in allowed]
                conditions += ["UPPER(u.sector) = %s" for _ in allowed]
                sector_conditions = " OR ".join(conditions)
                query += f" AND ({sector_conditions} OR t.requester_id = %s OR t.assigned_to = %s)"
                for s in allowed: params.append(s)
                for s in allowed: params.append(s)
                params.extend([daniel_id, daniel_id])
            else:
                print("Admin with empty allowed_sectors -> No sector filter applied to SQL query")

cur.execute(query, params)
all_returned = cur.fetchall()

print(f"Total tickets returned: {len(all_returned)}")
found = False
for t in all_returned:
    if str(t[0]).startswith("646d51f4"):
        print("TICKET CH-646d51f4 FOUND:", {
            "title": t[1],
            "category": t[5],
            "requester_sector": t[9]
        })
        found = True
        
if not found:
    print("TICKET CH-646d51f4 NOT FOUND")

cur.close()
conn.close()
