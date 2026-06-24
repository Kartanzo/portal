from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import asyncio
import logging

from core.config import ALLOWED_ORIGINS, UPLOAD_DIR
from core.scheduler import daily_alert_scheduler
from modulo import category_controller
from modulo import rh_colaboradores
from modulo import rh_recrutamento
from modulo import rh_documentos
from modulo import rh_jornada
from modulo import rh_movimentacoes
from modulo import rh_config
from modulo import rh_dev_seed
from modulo import rh_equipamentos
from modulo import rh_audit
from modulo import maquinas
from modulo import programacao
from modulo import otimizador_faturamento
from modulo import marketing_ficha_tecnica
from modulo import tickets, users, action_plans, implementation, inter_sector, sectors, dashboard, financeiro, importation, importation_v2, dre2025, sac, metas_faturamento, sop_dashboard, plano_producao, whatsapp_config, simulador_importacao, eventos, catalogo, comissao, analise_credito

logger = logging.getLogger(__name__)


async def _startup_db():
    from db_utils import get_db_connection
    import os
    db_schema = os.environ.get("DB_SCHEMA", "portal_chamado")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Initial Schema Setup
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {db_schema}")

        # Tickets Table (If not exists - simplified check)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tickets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                status VARCHAR(50) NOT NULL,
                priority VARCHAR(50) NOT NULL,
                category VARCHAR(100),
                requester_id UUID NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                delivery_forecast TIMESTAMP
            )
        """)

        # Users Schema Updates
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND table_name='users' AND column_name='last_login'", (db_schema,))
        if not cur.fetchone():
             cur.execute("ALTER TABLE users ADD COLUMN last_login TIMESTAMP")

        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND table_name='users' AND column_name='managed_sectors'", (db_schema,))
        if not cur.fetchone():
             cur.execute("ALTER TABLE users ADD COLUMN managed_sectors TEXT")

        # Migration: PCP -> Fabrica
        cur.execute("UPDATE users SET sector = 'Fabrica' WHERE sector = 'PCP'")
        cur.execute("UPDATE action_plans SET sector = 'Fabrica' WHERE sector = 'PCP'")
        conn.commit()

        # Password Resets
        cur.execute("""
            CREATE TABLE IF NOT EXISTS password_resets (
                token VARCHAR(255) PRIMARY KEY,
                user_id UUID NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.commit()

        # Action Plan Attachments
        cur.execute("""
            CREATE TABLE IF NOT EXISTS action_plan_attachments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                action_plan_item_id UUID NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                file_path TEXT NOT NULL,
                file_size BIGINT,
                uploaded_by UUID,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.commit()

        # Implementation Schedule Tables
        cur.execute("""
            CREATE TABLE IF NOT EXISTS implementation_schedules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                sector VARCHAR(100) NOT NULL,
                objective TEXT NOT NULL,
                macro_theme VARCHAR(100),
                created_by UUID,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS implementation_schedule_items (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                implementation_schedule_id UUID REFERENCES implementation_schedules(id) ON DELETE CASCADE,
                actions TEXT NOT NULL,
                expected_result TEXT,
                projects TEXT,
                responsible TEXT[],
                status VARCHAR(50) DEFAULT 'Não Iniciado',
                schedule_start TIMESTAMP WITH TIME ZONE,
                schedule_end TIMESTAMP WITH TIME ZONE,
                observation TEXT,
                budget_planned NUMERIC(12,2) DEFAULT 0,
                budget_actual NUMERIC(12,2) DEFAULT 0,
                hours_planned INTEGER DEFAULT 0,
                hours_actual INTEGER DEFAULT 0,
                roi_percentage NUMERIC(5,2) DEFAULT 0,
                stakeholder_satisfaction INTEGER DEFAULT 0,
                blocked_by_user_id UUID,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_by UUID
            )
        """)

        conn.commit()

        # Role Permissions
        cur.execute("""
            CREATE TABLE IF NOT EXISTS role_permissions (
                role VARCHAR(50) PRIMARY KEY,
                permissions JSONB DEFAULT '{}'
            )
        """)

        conn.commit()

        # Auto-Migrate from JSON if table is empty
        cur.execute("SELECT COUNT(*) FROM role_permissions")
        if cur.fetchone()[0] == 0:
            import os, json
            if os.path.exists('role_permissions.json'):
                with open('role_permissions.json') as f:
                    raw_perms = json.load(f)
                for role_name, perms in raw_perms.items():
                    cur.execute(
                        "INSERT INTO role_permissions (role, permissions) VALUES (%s, %s) ON CONFLICT (role) DO NOTHING",
                        (role_name, json.dumps(perms))
                    )
                conn.commit()

        # Garante que módulo sac existe em todos os roles (migration para roles existentes)
        cur.execute("""
            UPDATE role_permissions
            SET permissions = jsonb_set(permissions, '{sac}', '{"can_view": false, "can_edit": false}', true)
            WHERE NOT (permissions ? 'sac')
        """)
        cur.execute("""
            UPDATE role_permissions
            SET permissions = jsonb_set(permissions, '{sac_dashboard}', '{"can_view": false}', true)
            WHERE NOT (permissions ? 'sac_dashboard')
        """)
        # Garante módulo simulador_importacao em todos os roles
        cur.execute("""
            UPDATE role_permissions
            SET permissions = jsonb_set(permissions, '{simulador_importacao}', '{"can_view": false}', true)
            WHERE NOT (permissions ? 'simulador_importacao')
        """)
        # Concede acesso automático a super_user, ceo e admin
        cur.execute("""
            UPDATE role_permissions
            SET permissions = jsonb_set(permissions, '{simulador_importacao}', '{"can_view": true}', true)
            WHERE role IN ('super_user', 'ceo', 'admin')
        """)
        conn.commit()

        # Ensure externo role always exists (not covered by JSON seed if table wasn't empty)
        cur.execute(
            "INSERT INTO role_permissions (role, permissions) VALUES (%s, %s) ON CONFLICT (role) DO NOTHING",
            ('externo', '{"sac": {"can_view": true, "can_edit": false}}')
        )
        conn.commit()
        print("Database schema initialized/verified.")

        # Ensure sectors table and seed defaults
        from modulo.sectors import ensure_sectors_table
        ensure_sectors_table()

        from modulo.plano_producao import ensure_plano_producao_table
        ensure_plano_producao_table()

        from modulo.whatsapp_config import ensure_whatsapp_tables
        ensure_whatsapp_tables()

        from modulo.importation_v2 import ensure_importacao_v2_modelos_table
        ensure_importacao_v2_modelos_table()

        from modulo.simulador_importacao import ensure_simulador_cambio_table
        ensure_simulador_cambio_table()

        from modulo.catalogo import ensure_catalogo_tables
        ensure_catalogo_tables()

        from modulo.comissao import ensure_comissao_tables
        ensure_comissao_tables()

        from modulo.analise_credito import ensure_analise_credito_tables
        ensure_analise_credito_tables()

        from modulo.marketing_ficha_tecnica import ensure_ficha_tecnica_tables
        ensure_ficha_tecnica_tables()

    except Exception as e:
        conn.rollback()
        print(f"Startup DB Error: {e}")
    finally:
        cur.close()
        conn.close()

    # ticket_updates: garante colunas de anexo (ausentes em schemas antigos de homolog)
    try:
        conn2 = get_db_connection()
        cur2 = conn2.cursor()
        cur2.execute("ALTER TABLE ticket_updates ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255)")
        cur2.execute("ALTER TABLE ticket_updates ADD COLUMN IF NOT EXISTS attachment_path TEXT")
        cur2.execute("ALTER TABLE ticket_updates ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE")
        conn2.commit()
        cur2.close()
        conn2.close()
        print("ticket_updates attachment cols OK.")
    except Exception as e:
        print(f"ticket_updates migration error: {e}")

    # SAC Tables — conexão separada para não ser afetada por erros anteriores
    _ensure_sac_tables()

    # Tabela de sessoes (cookie HttpOnly)
    try:
        from auth_utils import ensure_session_table
        ensure_session_table()
    except Exception as e:
        print(f"Session table setup error: {e}")


def _ensure_sac_tables():
    from db_utils import get_db_connection
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sac_tickets (
                id SERIAL PRIMARY KEY,
                protocolo VARCHAR(20) UNIQUE NOT NULL,
                canal VARCHAR(50) NOT NULL DEFAULT 'Portal',
                cnpj_cpf VARCHAR(20),
                razao_social VARCHAR(200),
                email_contato VARCHAR(200),
                tipo_problema VARCHAR(100) NOT NULL,
                numero_nf VARCHAR(50),
                codigo_produto VARCHAR(50),
                descricao_produto TEXT,
                detalhamento TEXT,
                prioridade VARCHAR(20) NOT NULL DEFAULT 'Média',
                status VARCHAR(50) NOT NULL DEFAULT 'Aberto',
                setor_destino VARCHAR(50) NOT NULL DEFAULT 'SAC',
                aberto_por UUID REFERENCES users(id),
                criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sac_comentarios (
                id SERIAL PRIMARY KEY,
                ticket_id INTEGER NOT NULL REFERENCES sac_tickets(id) ON DELETE CASCADE,
                autor_id UUID REFERENCES users(id),
                texto TEXT NOT NULL,
                visivel_externo BOOLEAN NOT NULL DEFAULT TRUE,
                is_system BOOLEAN NOT NULL DEFAULT FALSE,
                criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sac_anexos (
                id SERIAL PRIMARY KEY,
                ticket_id INTEGER NOT NULL REFERENCES sac_tickets(id) ON DELETE CASCADE,
                nome_arquivo VARCHAR(255) NOT NULL,
                caminho VARCHAR(500) NOT NULL,
                mime_type VARCHAR(100),
                tamanho_bytes INTEGER,
                enviado_por UUID REFERENCES users(id),
                criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        conn.commit()
        # Tabela de tipos de problema SAC (gerenciada pelo comercial)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sac_tipos_problema (
                id SERIAL PRIMARY KEY,
                nome VARCHAR(150) NOT NULL UNIQUE,
                ativo BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        # Adiciona coluna categoria se não existir
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sac_tipos_problema' AND column_name='categoria'")
        if not cur.fetchone():
            cur.execute("ALTER TABLE sac_tipos_problema ADD COLUMN categoria VARCHAR(50) DEFAULT 'tipo_problema'")
        # Adiciona coluna setor (usada por status interno por setor) se não existir
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sac_tipos_problema' AND column_name='setor'")
        if not cur.fetchone():
            cur.execute("ALTER TABLE sac_tipos_problema ADD COLUMN setor VARCHAR(50)")
        # Remove restrição UNIQUE só de nome (status interno pode repetir nome entre setores)
        cur.execute("ALTER TABLE sac_tipos_problema DROP CONSTRAINT IF EXISTS sac_tipos_problema_nome_key")
        # Unicidade por (categoria, setor, nome) — permite mesmo nome em setores diferentes
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_sac_tipos_cat_setor_nome ON sac_tipos_problema (categoria, COALESCE(setor,''), nome)")
        # Seeds de tipos de problema (guardado por NOT EXISTS, sem depender de UNIQUE(nome))
        for nome in ["Entrega", "Produto", "NF", "Financeiro", "Outros"]:
            cur.execute("INSERT INTO sac_tipos_problema (nome, categoria) SELECT %s,'tipo_problema' WHERE NOT EXISTS (SELECT 1 FROM sac_tipos_problema WHERE categoria='tipo_problema' AND nome=%s)", (nome, nome))
        # Seeds de canais de compra
        for nome in ["Site", "Representante", "Telefone", "WhatsApp", "E-mail", "Loja Física"]:
            cur.execute("INSERT INTO sac_tipos_problema (nome, categoria) SELECT %s,'canal_compra' WHERE NOT EXISTS (SELECT 1 FROM sac_tipos_problema WHERE categoria='canal_compra' AND nome=%s)", (nome, nome))
        conn.commit()

        # Novos campos sac_tickets (logística)
        for col, typedef in [
            ("origem_dados", "VARCHAR(50)"),
            ("canal_compra", "VARCHAR(100)"),
            ("pedido", "VARCHAR(100)"),
            ("emissao", "TIMESTAMPTZ"),
            ("entrega", "TIMESTAMPTZ"),
            ("nota_fiscal_emissao", "TIMESTAMPTZ"),
            ("desc_tipodocumento", "VARCHAR(100)"),
            ("descricao_segmento", "VARCHAR(100)"),
            ("valor_frete", "NUMERIC(12,2)"),
            ("publico", "VARCHAR(20) DEFAULT 'cliente'"),
        ]:
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sac_tickets' AND column_name=%s", (col,))
            if not cur.fetchone():
                cur.execute(f"ALTER TABLE sac_tickets ADD COLUMN {col} {typedef}")

        # Tabela de produtos por ticket
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sac_ticket_produtos (
                id SERIAL PRIMARY KEY,
                ticket_id INTEGER NOT NULL REFERENCES sac_tickets(id) ON DELETE CASCADE,
                codigo_produto VARCHAR(50),
                descricao_produto TEXT,
                quantidade INTEGER DEFAULT 1,
                tipo_problema VARCHAR(150)
            )
        """)
        # Adiciona tipo_problema se não existir
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sac_ticket_produtos' AND column_name='tipo_problema'")
        if not cur.fetchone():
            cur.execute("ALTER TABLE sac_ticket_produtos ADD COLUMN tipo_problema VARCHAR(150)")
        # Adiciona quantidade_defeito (qtd de peças com defeito informada pelo usuário) se não existir
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sac_ticket_produtos' AND column_name='quantidade_defeito'")
        if not cur.fetchone():
            cur.execute("ALTER TABLE sac_ticket_produtos ADD COLUMN quantidade_defeito INTEGER")
        # Adiciona produto_idx em sac_anexos se não existir
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sac_anexos' AND column_name='produto_idx'")
        if not cur.fetchone():
            cur.execute("ALTER TABLE sac_anexos ADD COLUMN produto_idx INTEGER")
        # Status interno por setor envolvido no ticket (SAC + setor destino)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sac_status_interno (
                id SERIAL PRIMARY KEY,
                ticket_id INTEGER NOT NULL REFERENCES sac_tickets(id) ON DELETE CASCADE,
                setor VARCHAR(50) NOT NULL,
                status VARCHAR(150),
                atualizado_por UUID REFERENCES users(id),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(ticket_id, setor)
            )
        """)
        conn.commit()
        print("SAC tables OK.")
    except Exception as e:
        conn.rollback()
        print(f"SAC table setup error: {e}")

    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ticket_participants (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                added_by UUID REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ticket_id, user_id)
            )
        """)
        conn.commit()
        print("ticket_participants table OK.")
    except Exception as e:
        conn.rollback()
        print(f"ticket_participants table error: {e}")

    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inter_sector_ticket_participants (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                ticket_id UUID NOT NULL REFERENCES inter_sector_tickets(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                added_by UUID REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ticket_id, user_id)
            )
        """)
        conn.commit()
        print("inter_sector_ticket_participants table OK.")
    except Exception as e:
        conn.rollback()
        print(f"inter_sector_ticket_participants table error: {e}")

    # Eventos — álbum de fotos "Seleção EMPRESA" (storage base64/BYTEA)
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS eventos_album_fotos (
                id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                foto       BYTEA NOT NULL,
                mime_type  VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
                ordem      INTEGER NOT NULL,
                criado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                criado_por UUID
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_eventos_album_fotos_ordem ON eventos_album_fotos (ordem)")
        conn.commit()
        print("eventos_album_fotos table OK.")

        # AUTO-SEED: se a tabela está vazia, carrega fotos de backend/seed_data/eventos/
        cur.execute("SELECT COUNT(*) FROM eventos_album_fotos")
        if (cur.fetchone()[0] or 0) == 0:
            import mimetypes as _mt
            from pathlib import Path as _Path
            seed_dir = _Path(__file__).resolve().parent / "seed_data" / "eventos"
            if seed_dir.is_dir():
                exts = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
                arquivos = sorted([p for p in seed_dir.iterdir() if p.is_file() and p.suffix.lower() in exts])
                ok_count = 0
                for ordem, path in enumerate(arquivos, start=1):
                    try:
                        mime = _mt.guess_type(str(path))[0] or "image/jpeg"
                        with open(path, "rb") as f:
                            data = f.read()
                        cur.execute(
                            "INSERT INTO eventos_album_fotos (foto, mime_type, ordem) VALUES (%s, %s, %s)",
                            (data, mime, ordem),
                        )
                        conn.commit()
                        ok_count += 1
                    except Exception as ee:
                        conn.rollback()
                        print(f"  ✗ falha em {path.name}: {ee}")
                print(f"eventos_album_fotos auto-seed: {ok_count}/{len(arquivos)} fotos carregadas.")
    except Exception as e:
        conn.rollback()
        print(f"eventos_album_fotos table error: {e}")
    finally:
        cur.close()
        conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from core.config import UPLOAD_DIR as _UDIR
    import os as _os
    try:
        _os.makedirs(_UDIR, exist_ok=True)
        _test = _os.path.join(_UDIR, "_write_test.tmp")
        with open(_test, "w") as f: f.write("ok")
        _os.remove(_test)
        print(f"✅ UPLOAD_DIR OK e gravavel: {_UDIR}")
    except Exception as e:
        print(f"❌ UPLOAD_DIR ERRO: {_UDIR} | {e}")
    await _startup_db()
    # Seed idempotente de peças/hora padrão das máquinas (insere só o que falta; não sobrescreve).
    try:
        maquinas.seed_tempos_padrao()
    except Exception as _e:
        print(f"seed_tempos_padrao erro: {_e}")
    asyncio.create_task(daily_alert_scheduler())
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
# Mount adicional sob /api/uploads para funcionar atras de reverse proxy que so roteia /api/*
app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads_api")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"Validation Error: {exc.errors()}")
    # NOTE: Nao tentar ler request.body() aqui — o stream ja foi consumido
    # pelo form parser em multipart/form-data, e isso causa RuntimeError.
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )


app.include_router(category_controller.router)
app.include_router(marketing_ficha_tecnica.router)
app.include_router(tickets.router)
app.include_router(users.router)
app.include_router(action_plans.router)
app.include_router(implementation.router)
app.include_router(inter_sector.router)
app.include_router(sectors.router)
app.include_router(dashboard.router)
app.include_router(financeiro.router)
app.include_router(importation.router)
app.include_router(importation_v2.router)
app.include_router(simulador_importacao.router)
app.include_router(dre2025.router)
app.include_router(sac.router)
app.include_router(metas_faturamento.router)
app.include_router(sop_dashboard.router)
app.include_router(plano_producao.router)
app.include_router(rh_colaboradores.router)
app.include_router(rh_recrutamento.router)
app.include_router(rh_documentos.router)
app.include_router(rh_jornada.router)
app.include_router(rh_movimentacoes.router)
app.include_router(rh_config.router)
app.include_router(rh_dev_seed.router)
app.include_router(rh_equipamentos.router)
app.include_router(rh_audit.router)
app.include_router(maquinas.router)
app.include_router(programacao.router)
app.include_router(otimizador_faturamento.router)
app.include_router(whatsapp_config.router)
app.include_router(eventos.router)
app.include_router(catalogo.router)
app.include_router(comissao.router)
app.include_router(analise_credito.router)
