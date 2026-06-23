-- Correcao de drift de schema em programacao_board.
-- O upsert do board (PUT /programacao/board) usa:
--   ON CONFLICT (versao_id, cod_item, sequencia)
-- Em ambientes antigos a tabela foi criada com unique apenas (versao_id, cod_item)
-- e a coluna `sequencia` entrou depois via ALTER, sem a constraint de 3 colunas.
-- Resultado: psycopg2.errors.InvalidColumnReference (no unique constraint matching
-- the ON CONFLICT specification) -> 500 ao salvar o board.
--
-- Esta correcao: remove a unique legada de 2 colunas (que tambem travaria duplicar o
-- mesmo produto em sequencias/maquinas diferentes) e cria o indice unico de 3 colunas.
-- Idempotente. Tambem roda sob demanda em _ensure_board().
-- Aplicar em homolog (portal_chamado_homolog) antes de producao (portal_chamado).

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'programacao_board'::regclass AND contype = 'u'
      AND array_length(conkey, 1) = 2
  LOOP
    EXECUTE format('ALTER TABLE programacao_board DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_programacao_board_vcs
    ON programacao_board (versao_id, cod_item, sequencia);
