-- ============================================================
-- Migration: Criar tabela action_plan_history
-- Descrição: Tabela para armazenar histórico de alterações
--            nos itens do plano de ação estratégico
-- Data: 2026-04-01
-- ============================================================

-- HOMOLOGAÇÃO
CREATE TABLE IF NOT EXISTS portal_chamado_homolog.action_plan_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_plan_item_id UUID NOT NULL,
    user_id UUID,
    change_summary TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),

    -- Foreign keys
    CONSTRAINT fk_action_plan_item
        FOREIGN KEY (action_plan_item_id)
        REFERENCES portal_chamado_homolog.action_plan_items(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_user
        FOREIGN KEY (user_id)
        REFERENCES portal_chamado_homolog.users(id)
        ON DELETE SET NULL
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_aph_item_id_homolog
    ON portal_chamado_homolog.action_plan_history(action_plan_item_id);

CREATE INDEX IF NOT EXISTS idx_aph_created_at_homolog
    ON portal_chamado_homolog.action_plan_history(created_at DESC);

-- ============================================================
-- PRODUÇÃO (executar somente após validação em homolog)
-- ============================================================

CREATE TABLE IF NOT EXISTS portal_chamado.action_plan_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_plan_item_id UUID NOT NULL,
    user_id UUID,
    change_summary TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),

    -- Foreign keys
    CONSTRAINT fk_action_plan_item
        FOREIGN KEY (action_plan_item_id)
        REFERENCES portal_chamado.action_plan_items(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_user
        FOREIGN KEY (user_id)
        REFERENCES portal_chamado.users(id)
        ON DELETE SET NULL
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_aph_item_id_prod
    ON portal_chamado.action_plan_history(action_plan_item_id);

CREATE INDEX IF NOT EXISTS idx_aph_created_at_prod
    ON portal_chamado.action_plan_history(created_at DESC);

-- ============================================================
-- Verificação
-- ============================================================

-- Homolog
SELECT 'HOMOLOG' as ambiente, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'portal_chamado_homolog'
  AND table_name = 'action_plan_history'
ORDER BY ordinal_position;

-- Produção
SELECT 'PRODUCAO' as ambiente, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'portal_chamado'
  AND table_name = 'action_plan_history'
ORDER BY ordinal_position;
