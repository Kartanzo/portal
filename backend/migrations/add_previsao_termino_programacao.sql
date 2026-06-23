-- Previsao de termino na Programacao (passo 1 do Otimizador de Faturamento).
-- Adiciona, por linha do board (produto x maquina x lote):
--   previsao_termino: data/hora (BR) em que a producao daquela linha termina.
--                     Preenchida MANUALMENTE OU calculada a partir da peças/hora
--                     do produto na maquina (recurso ja existente: maquinas/tempos,
--                     endpoint /programacao/tempos-maquina + PUT /maquinas/{id}/tempo).
--
-- Aplicar em homolog (portal_chamado_homolog) antes de producao (portal_chamado).
-- A aplicacao tambem cria esta coluna sob demanda em _ensure_board() (idempotente).

ALTER TABLE programacao_board ADD COLUMN IF NOT EXISTS previsao_termino TIMESTAMPTZ;
