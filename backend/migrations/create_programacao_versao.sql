-- Versões salvas (snapshots) da Programação (passo 2 do Otimizador de Faturamento).
-- Cada save explícito da operação congela o board atual (itens, lotes, componentes e
-- peças/hora) de uma versão do plano. É o que o Otimizador de Faturamento consome e a
-- base para detectar "a programação mudou" e comparar versões.
--
-- Aplicar em homolog (portal_chamado_homolog) antes de producao (portal_chamado).
-- A aplicacao tambem cria esta tabela sob demanda em _ensure_prog_versao() (idempotente).

CREATE TABLE IF NOT EXISTS programacao_versao (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plano_versao_id  TEXT NOT NULL,           -- versão oficial do plano (programacao_board.versao_id)
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by       TEXT,
    created_by_name  TEXT,
    snapshot         JSONB NOT NULL,          -- itens + lotes + componentes + peças/hora congelados
    hash             TEXT NOT NULL,           -- dedup: não cria nova versão se nada mudou
    oficial          BOOLEAN DEFAULT FALSE,   -- só uma oficial por plano_versao_id
    oficial_em       TIMESTAMPTZ,
    oficial_por      TEXT,
    oficial_por_nome TEXT
);

CREATE INDEX IF NOT EXISTS idx_prog_versao_plano ON programacao_versao(plano_versao_id, created_at DESC);
