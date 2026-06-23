import psycopg2
from psycopg2 import sql as psql
import json
import os

def get_db_connection():
    # Try Environment Variables first (Docker/Production)
    db_host = os.environ.get("DB_HOST")
    db_name = os.environ.get("DB_NAME")
    db_user = os.environ.get("DB_USER")
    db_pass = os.environ.get("DB_PASSWORD")
    db_port = os.environ.get("DB_PORT")
    db_schema = os.environ.get("DB_SCHEMA", "portal_chamado")

    if db_host and db_name and db_user and db_pass:
        creds = {
            "host": db_host,
            "database": db_name,
            "user": db_user,
            "password": db_pass,
            "port": db_port or "5432"
        }
    else:
        # Fallback to local cred.json
        if os.path.exists('cred.json'):
            with open('cred.json', 'r') as f:
                creds = json.load(f)
        else:
            raise Exception("No database credentials found (Env Vars or cred.json)")

    conn = psycopg2.connect(
        host=creds['host'],
        database=creds['database'],
        user=creds['user'],
        password=creds['password'],
        port=creds['port'],
        connect_timeout=10
    )
    
    # Set the schema search path in autocommit mode so it survives rollbacks
    prev_autocommit = conn.autocommit
    conn.autocommit = True
    try:
        cur = conn.cursor()
        cur.execute(psql.SQL("SET search_path TO {}, public").format(psql.Identifier(db_schema)))
        cur.close()
    finally:
        conn.autocommit = prev_autocommit
    
    return conn
