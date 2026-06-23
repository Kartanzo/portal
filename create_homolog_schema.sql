-- ============================================================
-- Criação do Schema de HOMOLOGAÇÃO
-- Execute este script conectado ao banco de produção
-- como superuser ou owner do schema portal_chamado
-- ============================================================

-- 1. Cria o schema de homolog (se não existir)
CREATE SCHEMA IF NOT EXISTS portal_chamado_homolog;

-- 2. Copia a estrutura de todas as tabelas de produção para homolog
--    (sem dados — apenas estrutura + constraints + índices)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'portal_chamado'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS portal_chamado_homolog.%I
             (LIKE portal_chamado.%I INCLUDING ALL)',
            r.table_name, r.table_name
        );
        RAISE NOTICE 'Tabela copiada: %', r.table_name;
    END LOOP;
END;
$$;

-- 3. (Opcional) Copia os dados de produção para homolog
--    Descomente o bloco abaixo SE quiser iniciar com dados reais.
--    ATENÇÃO: pode demorar dependendo do volume de dados.
/*
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'portal_chamado'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    LOOP
        EXECUTE format(
            'INSERT INTO portal_chamado_homolog.%I
             SELECT * FROM portal_chamado.%I
             ON CONFLICT DO NOTHING',
            r.table_name, r.table_name
        );
        RAISE NOTICE 'Dados copiados: %', r.table_name;
    END LOOP;
END;
$$;
*/

-- 4. Confirma o que foi criado
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'portal_chamado_homolog'
ORDER BY table_name;
