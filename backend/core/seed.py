"""
core/seed.py — Bootstrap de tabelas que faltam + seed de dados dummy (jan–dez/2026).

Por que existe:
  - O app cria a maioria das tabelas via `CREATE TABLE IF NOT EXISTS`, mas algumas
    (users, action_plans, ticket_categories) o código ASSUME que já existem e nunca cria.
    Num banco vazio o startup quebraria. `ensure_bootstrap_tables()` cria essas tabelas
    (e a `tickets` COMPLETA, com colunas que o startup simplificado não inclui) — roda SEMPRE.
  - `run_dummy_seed()` popula dados de demonstração de 2026 (todos os meses). Roda só quando
    a env `SEED_DUMMY` está ligada (1/true). É idempotente: não duplica se já houver dados.

ATENÇÃO: o schema completo original não está no repo — as DDLs abaixo foram reconstruídas a
partir do uso no código. Validar no primeiro deploy (EasyPanel) contra Postgres real.
"""
from __future__ import annotations
import os
import json
import logging

from db_utils import get_db_connection
from core.config import get_password_hash
from core import dummy

logger = logging.getLogger(__name__)

ADMIN_EMAIL = "admin"            # login é por e-mail; usar "admin" permite logar como "admin"
ADMIN_PASSWORD = "Senha123!"
ADMIN_NAME = "Administrador"

TICKET_STATUS = ["Aberto", "Em Atendimento", "Concluído"]
TICKET_PRIORITY = ["Baixa", "Média", "Alta", "Urgente"]
TICKET_CATEGORIES = ["Infraestrutura", "Sistemas", "StarSoft", "Manutenção",
                     "Acessos", "Financeiro", "Recursos Humanos", "Comercial"]


def seed_enabled() -> bool:
    return os.environ.get("SEED_DUMMY", "").strip().lower() in ("1", "true", "yes", "on")


# --------------------------------------------------------------------------- #
# Bootstrap — cria tabelas que o código assume existir (roda SEMPRE)
# --------------------------------------------------------------------------- #
def ensure_bootstrap_tables() -> None:
    """Cria users / action_plans / ticket_categories / tickets(completa). Idempotente.

    Deve rodar ANTES do _startup_db tocar nessas tabelas (ALTER users / UPDATE action_plans).
    Não depende de SEED_DUMMY — é o que permite o app subir num banco vazio.
    """
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # gen_random_uuid(): nativo no PG13+; pgcrypto cobre versões antigas.
        try:
            cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        except Exception as e:
            logger.warning(f"pgcrypto nao instalado ({e}); assumindo gen_random_uuid nativo")
            conn.rollback()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                role VARCHAR(50) NOT NULL DEFAULT 'user',
                avatar TEXT,
                sector VARCHAR(255),
                password_hash TEXT NOT NULL,
                permissions JSONB DEFAULT '{}'::jsonb,
                managed_sectors TEXT,
                notification_preferences JSONB DEFAULT '{}'::jsonb,
                is_active BOOLEAN DEFAULT TRUE,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS action_plans (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                sector VARCHAR(255),
                objective TEXT,
                macro_theme TEXT,
                created_by UUID,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS ticket_categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(150) NOT NULL UNIQUE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # tickets COMPLETA (superset do DDL simplificado do _startup_db). Como o startup usa
        # CREATE TABLE IF NOT EXISTS, criar aqui primeiro faz a versão completa prevalecer.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tickets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                status VARCHAR(50) NOT NULL,
                priority VARCHAR(50) NOT NULL,
                category VARCHAR(100),
                category_id INTEGER,
                subcategory VARCHAR(100),
                subcategory_id INTEGER,
                requester_id UUID NOT NULL,
                assigned_to UUID,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                delivery_forecast TIMESTAMP
            )
        """)
        # Defensivo: se a tabela tickets já existia (simplificada), garante as colunas extras.
        for col, ddl in [
            ("category_id", "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category_id INTEGER"),
            ("subcategory", "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS subcategory VARCHAR(100)"),
            ("subcategory_id", "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS subcategory_id INTEGER"),
            ("assigned_to", "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_to UUID"),
        ]:
            try:
                cur.execute(ddl)
            except Exception as e:
                logger.warning(f"ALTER tickets {col}: {e}")
                conn.rollback()

        conn.commit()
        logger.info("Bootstrap de tabelas (users/action_plans/ticket_categories/tickets) OK.")
    except Exception as e:
        conn.rollback()
        logger.error(f"ensure_bootstrap_tables falhou: {e}")
        raise
    finally:
        cur.close()
        conn.close()


# --------------------------------------------------------------------------- #
# Seed de dados dummy (roda só com SEED_DUMMY ligado)
# --------------------------------------------------------------------------- #
def _ensure_admin(cur) -> str:
    """Cria o usuário admin se não existir e devolve o id (uuid str)."""
    cur.execute("SELECT id FROM users WHERE LOWER(email) = LOWER(%s)", (ADMIN_EMAIL,))
    row = cur.fetchone()
    if row:
        return str(row[0])
    cur.execute(
        """
        INSERT INTO users (name, email, role, sector, password_hash, permissions, is_active)
        VALUES (%s, %s, 'super_user', 'T.I', %s, '{}'::jsonb, TRUE)
        RETURNING id
        """,
        (ADMIN_NAME, ADMIN_EMAIL, get_password_hash(ADMIN_PASSWORD)),
    )
    return str(cur.fetchone()[0])


def _seed_sectors(cur) -> None:
    for nome in dummy.SETORES:
        cur.execute(
            "INSERT INTO sectors (name) VALUES (%s) ON CONFLICT (name) DO NOTHING", (nome,)
        )


def _seed_categories(cur) -> None:
    for nome in TICKET_CATEGORIES:
        cur.execute(
            "INSERT INTO ticket_categories (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
            (nome,),
        )


def _seed_tickets(cur, admin_id: str) -> int:
    cur.execute("SELECT COUNT(*) FROM tickets")
    if (cur.fetchone() or [0])[0] > 0:
        return 0  # já há chamados — não duplica
    r = dummy.rng("tickets-seed")
    # ~5 chamados por mês -> garante lançamentos em TODOS os meses de 2026
    datas = dummy.datas_no_ano(60, chave="tickets")
    n = 0
    for i, d in enumerate(datas):
        status = dummy.escolher(r, TICKET_STATUS)
        prio = dummy.escolher(r, TICKET_PRIORITY)
        cat = dummy.escolher(r, TICKET_CATEGORIES)
        ts = d.strftime("%Y-%m-%d") + " 09:00:00"
        cur.execute(
            """
            INSERT INTO tickets
                (title, description, status, priority, category, requester_id, created_at, updated_at, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE)
            """,
            (
                f"Chamado dummy #{i+1:03d} — {cat}",
                f"Registro de demonstração gerado automaticamente ({cat}, {d.strftime('%m/%Y')}).",
                status, prio, cat, admin_id, ts, ts,
            ),
        )
        n += 1
    return n


def _seed_action_plans(cur, admin_id: str) -> int:
    cur.execute("SELECT COUNT(*) FROM action_plans")
    if (cur.fetchone() or [0])[0] > 0:
        return 0
    r = dummy.rng("action-plans-seed")
    n = 0
    for d in dummy.meses():  # 1 por mês de 2026
        setor = dummy.escolher(r, dummy.SETORES)
        cur.execute(
            """
            INSERT INTO action_plans (sector, objective, macro_theme, created_by, is_active, created_at)
            VALUES (%s, %s, %s, %s, TRUE, %s)
            """,
            (
                setor,
                f"Objetivo dummy de {dummy.MESES_PT_LONGO[d.month-1]}/2026 ({setor}).",
                f"Tema macro {setor}",
                admin_id,
                d.strftime("%Y-%m-%d") + " 08:00:00",
            ),
        )
        n += 1
    return n


def run_dummy_seed() -> None:
    """Popula dados de demonstração de 2026. Só roda com SEED_DUMMY ligado. Idempotente."""
    if not seed_enabled():
        logger.info("SEED_DUMMY desligado — pulando seed de dados dummy.")
        return
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        admin_id = _ensure_admin(cur)
        _seed_sectors(cur)
        _seed_categories(cur)
        n_tickets = _seed_tickets(cur, admin_id)
        n_plans = _seed_action_plans(cur, admin_id)
        conn.commit()
        logger.info(
            f"Seed dummy 2026 OK: admin={ADMIN_EMAIL}, tickets+={n_tickets}, action_plans+={n_plans}"
        )
    except Exception as e:
        conn.rollback()
        logger.error(f"run_dummy_seed falhou: {e}")
    finally:
        cur.close()
        conn.close()
