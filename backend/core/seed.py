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


# Seeds por domínio definidos em cada módulo (assinatura: fn(admin_id) -> dict; idempotentes).
_DOMAIN_SEEDS = [
    ("financeiro", "modulo.financeiro", "seed_dummy_financeiro"),
    ("rh", "modulo.rh_dev_seed", "seed_dummy_rh"),
    ("eventos", "modulo.eventos", "seed_dummy_eventos"),
    ("inter_sector", "modulo.inter_sector", "seed_dummy_inter_sector"),
    ("sac", "modulo.sac", "seed_dummy_sac"),
    ("maquinas", "modulo.maquinas", "seed_dummy_maquinas"),
]


def _ensure_app_tables() -> None:
    """Garante as tabelas dos ensure_* do startup.

    O bloco ensure_* do _startup_db fica dentro de um try; se algo antes dele falhar, ele é
    pulado e tabelas como `sectors` não nascem. Aqui re-garantimos cada uma (isolado por
    try/except) para o seed e as páginas funcionarem mesmo nesse caso.
    """
    ensures = [
        ("modulo.sectors", "ensure_sectors_table"),
        ("modulo.plano_producao", "ensure_plano_producao_table"),
        ("modulo.whatsapp_config", "ensure_whatsapp_tables"),
        ("modulo.importation_v2", "ensure_importacao_v2_modelos_table"),
        ("modulo.simulador_importacao", "ensure_simulador_cambio_table"),
        ("modulo.catalogo", "ensure_catalogo_tables"),
        ("modulo.comissao", "ensure_comissao_tables"),
        ("modulo.analise_credito", "ensure_analise_credito_tables"),
        ("modulo.marketing_ficha_tecnica", "ensure_ficha_tecnica_tables"),
    ]
    import importlib
    for mod_name, fn_name in ensures:
        try:
            getattr(importlib.import_module(mod_name), fn_name)()
        except Exception as e:
            logger.warning(f"ensure {mod_name}.{fn_name} no seed: {e}")


def reset_enabled() -> bool:
    return os.environ.get("SEED_RESET", "").strip().lower() in ("1", "true", "yes", "on")


# Tabelas semeadas + caches. TRUNCATE CASCADE limpa também os dependentes (FKs).
_RESET_TABLES = [
    "tickets", "action_plans",
    "financeiro_justificativas", "financeiro_data_orcado",
    "financeiro_data_realizado", "financeiro_bases",
    "rh_movimentacoes", "rh_ferias", "rh_banco_horas", "rh_documentos",
    "rh_candidatos", "rh_vagas", "rh_equipamentos", "rh_colaboradores", "rh_sindicatos",
    "sac_comentarios", "sac_ticket_produtos", "sac_tickets",
    "inter_sector_ticket_participants", "inter_sector_ticket_updates", "inter_sector_tickets",
    "eventos_album_fotos",
    "maquina_log", "estrutura_item", "estrutura_versao", "maquinas",
    "sop_dashboard_cache", "otimizador_faturamento_cache",
]


def _reset_seed_data() -> None:
    """Apaga os dados semeados + caches (para repopular do zero). Cada tabela em
    transação própria — se uma não existir/falhar, as demais continuam.
    NÃO apaga `users` (mantém o admin)."""
    conn = get_db_connection()
    cur = conn.cursor()
    apagadas = 0
    for t in _RESET_TABLES:
        try:
            cur.execute(f"TRUNCATE TABLE {t} RESTART IDENTITY CASCADE")
            conn.commit()
            apagadas += 1
        except Exception as e:
            conn.rollback()
            logger.warning(f"reset {t}: {e}")
    cur.close()
    conn.close()
    logger.info(f"SEED_RESET: {apagadas} tabelas limpas (dados antigos removidos).")


def run_dummy_seed() -> None:
    """Popula dados de demonstração de 2026. Só roda com SEED_DUMMY ligado. Idempotente."""
    if not seed_enabled():
        logger.info("SEED_DUMMY desligado — pulando seed de dados dummy.")
        return

    # 0) Garante tabelas que o startup pode não ter criado (bloco ensure_* abortado).
    _ensure_app_tables()

    # 0.1) SEED_RESET=1 -> apaga tudo que foi semeado antes (e os caches) e repopula.
    if reset_enabled():
        _reset_seed_data()

    # 1) Núcleo: admin + setores + categorias + chamados + planos de ação.
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
            f"Seed nucleo 2026 OK: admin={ADMIN_EMAIL}, tickets+={n_tickets}, action_plans+={n_plans}"
        )
    except Exception as e:
        conn.rollback()
        logger.error(f"run_dummy_seed (nucleo) falhou: {e}")
        cur.close()
        conn.close()
        return
    finally:
        cur.close()
        conn.close()

    # 2) Seeds por domínio (cada um com conexão própria e idempotente; isolados — se um
    #    falhar, os demais seguem).
    import importlib
    resultados = {}
    for nome, mod_name, fn_name in _DOMAIN_SEEDS:
        try:
            fn = getattr(importlib.import_module(mod_name), fn_name)
            resultados[nome] = fn(admin_id)
        except Exception as e:
            resultados[nome] = {"error": str(e)}
            logger.error(f"seed dominio '{nome}' falhou: {e}")
    logger.info(f"Seeds por dominio 2026: {resultados}")
