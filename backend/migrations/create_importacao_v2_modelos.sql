-- Migration: Importação v2 — tabela de modelos salvos por usuário
-- Schema: portal_chamado_homolog (homolog-first per CLAUDE.md §🚦)
-- Replicar em portal_chamado SOMENTE após validação do usuário.

CREATE TABLE IF NOT EXISTS importacao_v2_modelos (
  id              SERIAL       PRIMARY KEY,
  user_id         INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome            VARCHAR(120) NOT NULL,
  codigos         JSONB        NOT NULL,                                                 -- array de strings (SKUs)
  qtd_meses       SMALLINT     NOT NULL CHECK (qtd_meses BETWEEN 1 AND 36),
  modo            VARCHAR(10)  NOT NULL CHECK (modo IN ('corrido','vendas')),
  overrides       JSONB        NOT NULL DEFAULT '{}'::jsonb,                              -- {codigo: {lead_time, nivel_servico, pipeline}}
  threshold_sigma NUMERIC(4,2) NOT NULL DEFAULT 1.5,                                      -- threshold de pico/vale
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_importacao_v2_modelos_user ON importacao_v2_modelos(user_id);
