-- ============================================================
-- Migration: Criar tabela plano_producao_versoes
-- Descrição: Snapshot versionado de cada execucao do otimizador
--            de plano de producao (PuLP). Retençao 30 dias.
-- Data: 2026-05-12
-- ============================================================

-- HOMOLOGAÇÃO
CREATE TABLE IF NOT EXISTS portal_chamado_homolog.plano_producao_versoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP DEFAULT NOW(),
    created_by UUID,
    created_by_name TEXT,
    hoje DATE NOT NULL,
    elapsed_seconds REAL,
    totais JSONB NOT NULL,
    plano JSONB NOT NULL,
    pedidos_completos JSONB NOT NULL,
    detalhe_alocacao JSONB NOT NULL,
    notes TEXT,
    CONSTRAINT fk_ppv_user_homolog FOREIGN KEY (created_by)
        REFERENCES portal_chamado_homolog.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ppv_created_at_homolog
    ON portal_chamado_homolog.plano_producao_versoes(created_at DESC);

-- PRODUÇÃO (executar somente após validar em homolog)
CREATE TABLE IF NOT EXISTS portal_chamado.plano_producao_versoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP DEFAULT NOW(),
    created_by UUID,
    created_by_name TEXT,
    hoje DATE NOT NULL,
    elapsed_seconds REAL,
    totais JSONB NOT NULL,
    plano JSONB NOT NULL,
    pedidos_completos JSONB NOT NULL,
    detalhe_alocacao JSONB NOT NULL,
    notes TEXT,
    CONSTRAINT fk_ppv_user_prod FOREIGN KEY (created_by)
        REFERENCES portal_chamado.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ppv_created_at_prod
    ON portal_chamado.plano_producao_versoes(created_at DESC);

-- Verificação
SELECT 'HOMOLOG' as ambiente, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'portal_chamado_homolog' AND table_name = 'plano_producao_versoes'
ORDER BY ordinal_position;

SELECT 'PRODUCAO' as ambiente, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'portal_chamado' AND table_name = 'plano_producao_versoes'
ORDER BY ordinal_position;
