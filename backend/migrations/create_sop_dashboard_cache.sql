-- Cache compartilhado da Torre S&OP (substitui o arquivo local sop_dashboard_cache.json).
-- Motivacao: em deploy multi-replica, o cache em arquivo era por instancia (cada container
-- tinha seu proprio JSON), gerando dados divergentes entre replicas. Movido para o Postgres
-- para ser compartilhado e isolado por ambiente via search_path (DB_SCHEMA).
--
-- Aplicar em homolog (portal_chamado_homolog) antes de producao (portal_chamado).
-- A aplicacao tambem cria esta tabela sob demanda (CREATE TABLE IF NOT EXISTS), de modo
-- que rodar esta migration e opcional/idempotente.

CREATE TABLE IF NOT EXISTS sop_dashboard_cache (
    cache_key   TEXT PRIMARY KEY,
    payload     JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
