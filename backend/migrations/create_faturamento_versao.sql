-- Versões de faturamento (snapshots congelados) — Otimizador de Faturamento.
-- Cada versão guarda o resultado completo (pedidos + sem-data + totais) gerado sobre
-- uma versão oficial da Programação. Base para comparação entre versões e para detectar
-- "a programação mudou" (programacao_versao_id != oficial atual).
--
-- Aplicar em homolog (portal_chamado_homolog) antes de producao (portal_chamado).
-- A aplicacao tambem cria esta tabela sob demanda em _ensure_fat_versao() (idempotente).

CREATE TABLE IF NOT EXISTS faturamento_versao (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programacao_versao_id TEXT NOT NULL,           -- base (Programação oficial)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by            TEXT,
    created_by_name       TEXT,
    resultado             JSONB NOT NULL,          -- pedidos + sem_data_programacao + totais (congelados)
    oficial               BOOLEAN DEFAULT FALSE,   -- única oficial por vez
    oficial_em            TIMESTAMPTZ,
    oficial_por           TEXT,
    oficial_por_nome      TEXT
);

CREATE INDEX IF NOT EXISTS idx_fat_versao_created ON faturamento_versao(created_at DESC);
