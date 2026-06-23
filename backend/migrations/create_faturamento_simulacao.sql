-- Cenários "e se" salvos do Otimizador de Faturamento (simulador).
-- Cada cenário guarda um label, os filtros aplicados (dias / semana ISO / remover
-- produtos / remover clientes) e o resultado CONGELADO no momento do salvamento.
--
-- Aplicar em homolog (portal_chamado_homolog) antes de producao (portal_chamado).
-- A aplicacao tambem cria esta tabela sob demanda em _ensure_fat_simulacao() (idempotente).

CREATE TABLE IF NOT EXISTS faturamento_simulacao (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programacao_versao_id TEXT,
    label                 TEXT NOT NULL,
    filtros               JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {dias:[], semana_iso, remover_produtos:[], remover_clientes:[]}
    resultado             JSONB NOT NULL,                       -- pedidos + sem_data + totais (congelados)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by            TEXT,
    created_by_name       TEXT
);

CREATE INDEX IF NOT EXISTS idx_fat_sim_created ON faturamento_simulacao(created_at DESC);
