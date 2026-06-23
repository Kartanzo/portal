import codecs
from db_utils import get_db_connection

with codecs.open('users_out.txt', 'w', 'utf-8') as f:
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT id, name, role, sector, managed_sectors, permissions
        FROM users
        WHERE sector ILIKE '%T.I%' OR sector ILIKE '%Gestão de Informação%'
    """)
    for r in cur.fetchall():
        f.write(f"Name: {r[1]} | Role: {r[2]} | Sector: {r[3]} | Perms: {r[5]}\n")

    cur.close()
    conn.close()
