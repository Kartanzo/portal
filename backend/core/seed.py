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
                sector VARCHAR(255),
                name VARCHAR(150) NOT NULL UNIQUE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # tickets.py/category_controller leem tc.sector — garante a coluna em tabelas antigas
        try:
            cur.execute("ALTER TABLE ticket_categories ADD COLUMN IF NOT EXISTS sector VARCHAR(255)")
        except Exception as e:
            logger.warning(f"ALTER ticket_categories sector: {e}")
            conn.rollback()

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

    # Tabelas "assumidas" (referenciadas no código mas nunca criadas por nenhum CREATE TABLE).
    # Roda SEMPRE no startup, depois das tabelas-base, para o app subir em schema vazio.
    ensure_assumed_tables()


# --------------------------------------------------------------------------- #
# Tabelas "assumidas" — referenciadas pelo código mas nunca criadas (roda SEMPRE)
# --------------------------------------------------------------------------- #
# DDLs reconstruídas a partir do uso real (SELECT/INSERT/UPDATE/WHERE/ORDER BY) no código.
# FKs para users(id) são UUID; FKs para tabelas SERIAL (ticket_categories) são INTEGER.
_ASSUMED_TABLES = [
    # notifications — users.py get_notifications: SELECT id,user_id,title,message,link,is_read,
    # created_at; tickets.py/email.py INSERT (user_id,title,message,link); UPDATE is_read.
    ("notifications", """
        CREATE TABLE IF NOT EXISTS notifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(255),
            message TEXT,
            link TEXT,
            is_read BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """),
    # ticket_updates — tickets.py: histórico/mensagens de chamados (distinta de
    # inter_sector_ticket_updates). INSERT (ticket_id,user_id,message,attachment_name,
    # attachment_path,is_system,created_at); SELECT join users; ORDER BY created_at.
    ("ticket_updates", """
        CREATE TABLE IF NOT EXISTS ticket_updates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
            user_id UUID REFERENCES users(id),
            message TEXT,
            attachment_name TEXT,
            attachment_path TEXT,
            is_system BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """),
    # ticket_participants — tickets.py: participantes de um chamado (distinta de
    # inter_sector_ticket_participants). INSERT (ticket_id,user_id,added_by); SELECT user_id;
    # DELETE por (ticket_id,user_id).
    ("ticket_participants", """
        CREATE TABLE IF NOT EXISTS ticket_participants (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            added_by UUID REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ticket_id, user_id)
        )
    """),
    # action_plan_items — action_plans.py: itens de um plano de ação. INSERT com action_plan_id,
    # actions, expected_result, projects, responsible (array), status, schedule_start/end,
    # observation, budget_planned/actual, hours_planned/actual, roi_percentage,
    # stakeholder_satisfaction, blocked_by_user_id, waiting_for_return (array), created_by,
    # is_active, updated_at; SELECT join action_plans/users.
    ("action_plan_items", """
        CREATE TABLE IF NOT EXISTS action_plan_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            action_plan_id UUID REFERENCES action_plans(id) ON DELETE CASCADE,
            actions TEXT,
            expected_result TEXT,
            projects TEXT,
            responsible TEXT[],
            status VARCHAR(50),
            schedule_start DATE,
            schedule_end DATE,
            observation TEXT,
            budget_planned NUMERIC,
            budget_actual NUMERIC,
            hours_planned NUMERIC,
            hours_actual NUMERIC,
            roi_percentage NUMERIC,
            stakeholder_satisfaction NUMERIC,
            blocked_by_user_id UUID REFERENCES users(id),
            waiting_for_return TEXT[],
            created_by UUID REFERENCES users(id),
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """),
    # action_plan_history — action_plans.py: histórico de alterações de um item.
    # INSERT (item_id,user_id,change_summary); SELECT join users; ORDER BY created_at.
    ("action_plan_history", """
        CREATE TABLE IF NOT EXISTS action_plan_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            item_id UUID REFERENCES action_plan_items(id) ON DELETE CASCADE,
            user_id UUID REFERENCES users(id),
            change_summary TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """),
    # dre2025_bases — dre2025.py: bases salvas do DRE 2025. INSERT (name,dre_data,sheets_data,
    # created_by); SELECT id,name,created_at, join users; UPDATE is_active/observations.
    ("dre2025_bases", """
        CREATE TABLE IF NOT EXISTS dre2025_bases (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255),
            dre_data JSONB,
            sheets_data JSONB,
            observations TEXT,
            created_by UUID REFERENCES users(id),
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """),
    # importation_history — importation.py: histórico de importações. INSERT (filename,
    # uploaded_by,items_data); SELECT id,filename,upload_date, join users, items_data;
    # UPDATE is_active.
    ("importation_history", """
        CREATE TABLE IF NOT EXISTS importation_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            filename TEXT,
            uploaded_by UUID REFERENCES users(id),
            items_data JSONB,
            upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE
        )
    """),
    # implementation_schedule_attachments — implementation.py: anexos de um item de cronograma.
    # INSERT (implementation_schedule_item_id,file_name,file_path,file_size,uploaded_by);
    # SELECT id,file_name,file_path,file_size,created_at, join users.
    ("implementation_schedule_attachments", """
        CREATE TABLE IF NOT EXISTS implementation_schedule_attachments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            implementation_schedule_item_id UUID REFERENCES implementation_schedule_items(id) ON DELETE CASCADE,
            file_name TEXT,
            file_path TEXT,
            file_size BIGINT,
            uploaded_by UUID REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """),
    # implementation_schedule_history — implementation.py: histórico de um item de cronograma.
    # SELECT user_id,change_summary,created_at WHERE implementation_schedule_item_id.
    ("implementation_schedule_history", """
        CREATE TABLE IF NOT EXISTS implementation_schedule_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            implementation_schedule_item_id UUID REFERENCES implementation_schedule_items(id) ON DELETE CASCADE,
            user_id UUID REFERENCES users(id),
            change_summary TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """),
    # sector_ticket_categories — sectors.py: categorias de chamado por setor. INSERT (sector,
    # name,created_by,min_chars); SELECT id,sector,name,created_at,min_chars; id usado como
    # str() -> UUID; UPDATE name/min_chars/is_active.
    ("sector_ticket_categories", """
        CREATE TABLE IF NOT EXISTS sector_ticket_categories (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            sector VARCHAR(255),
            name VARCHAR(255),
            min_chars INTEGER DEFAULT 0,
            created_by UUID REFERENCES users(id),
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """),
    # sector_ticket_subcategories — sectors.py: subcategorias por categoria de setor. INSERT
    # (category_id,name,min_chars,require_attachment); category_id usado como str() -> UUID
    # (FK para sector_ticket_categories); SELECT join, UPDATE is_active.
    ("sector_ticket_subcategories", """
        CREATE TABLE IF NOT EXISTS sector_ticket_subcategories (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            category_id UUID REFERENCES sector_ticket_categories(id) ON DELETE CASCADE,
            name VARCHAR(255),
            min_chars INTEGER DEFAULT 0,
            require_attachment BOOLEAN DEFAULT FALSE,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """),
    # ticket_subcategories — category_controller.py: subcategorias da categoria legada
    # (ticket_categories é SERIAL -> category_id INTEGER; id usado sem str() -> SERIAL).
    # SELECT id,category_id,name,created_at; INSERT (category_id,name); DELETE por id.
    ("ticket_subcategories", """
        CREATE TABLE IF NOT EXISTS ticket_subcategories (
            id SERIAL PRIMARY KEY,
            category_id INTEGER REFERENCES ticket_categories(id) ON DELETE CASCADE,
            name VARCHAR(150) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """),
    # financeiro_data_orcado — financeiro.py: linhas de dados orçados (normalmente carregadas
    # via pandas to_sql; num schema vazio os SELECTs rodam antes do 1º upload). Colunas usadas:
    # base_id, grupo, conta_contabil, descricao_conta, competencia, departamento, valor.
    ("financeiro_data_orcado", """
        CREATE TABLE IF NOT EXISTS financeiro_data_orcado (
            id SERIAL PRIMARY KEY,
            base_id UUID REFERENCES financeiro_bases(id) ON DELETE CASCADE,
            grupo TEXT,
            conta_contabil TEXT,
            descricao_conta TEXT,
            competencia TEXT,
            departamento TEXT,
            valor NUMERIC
        )
    """),
    # financeiro_data_realizado — financeiro.py: linhas de dados realizados (mesmas colunas
    # de financeiro_data_orcado; SELECT grupo,conta_contabil,descricao_conta,competencia,valor
    # WHERE base_id).
    ("financeiro_data_realizado", """
        CREATE TABLE IF NOT EXISTS financeiro_data_realizado (
            id SERIAL PRIMARY KEY,
            base_id UUID REFERENCES financeiro_bases(id) ON DELETE CASCADE,
            grupo TEXT,
            conta_contabil TEXT,
            descricao_conta TEXT,
            competencia TEXT,
            departamento TEXT,
            valor NUMERIC
        )
    """),
]


def ensure_assumed_tables() -> None:
    """Cria todas as tabelas que o código referencia mas nunca cria via CREATE TABLE.

    Permite o app subir num schema 100% vazio (ex.: portal_demo). Cada CREATE roda em
    transação própria (commit/rollback isolado): se uma falhar (ex.: tabela-pai ausente),
    loga e segue para as demais — nunca derruba o startup.
    """
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        try:
            cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
            conn.commit()
        except Exception as e:
            logger.warning(f"pgcrypto nao instalado ({e}); assumindo gen_random_uuid nativo")
            conn.rollback()

        criadas = 0
        for nome, ddl in _ASSUMED_TABLES:
            try:
                cur.execute(ddl)
                conn.commit()
                criadas += 1
            except Exception as e:
                conn.rollback()
                logger.warning(f"ensure_assumed_tables: {nome} falhou: {e}")
        logger.info(f"ensure_assumed_tables OK: {criadas}/{len(_ASSUMED_TABLES)} tabelas garantidas.")
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
            "INSERT INTO ticket_categories (sector, name) VALUES (%s, %s) ON CONFLICT (name) DO NOTHING",
            ("T.I", nome),
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
    ("estrategico", "modulo.action_plans", "seed_dummy_estrategico"),
    ("moq", "modulo.importation_v2", "seed_dummy_moq"),
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
    "action_plan_items", "importacao_v2_moq",
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
        conn.commit()
        # action_plans é semeado pelo dominio 'estrategico' (com perspectivas PDCA).
        logger.info(
            f"Seed nucleo 2026 OK: admin={ADMIN_EMAIL}, tickets+={n_tickets}"
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
