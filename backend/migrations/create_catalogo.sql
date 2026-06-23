-- Migration: estrutura do módulo Catálogo (Marketing)
-- Aplica-se ao schema corrente (portal_chamado ou portal_chamado_homolog)
-- Também é criada/convergida automaticamente no startup via modulo.catalogo.ensure_catalogo_tables()

-- Armazém de imagens (capas e fotos de produto) — padronizadas no cliente antes do upload
CREATE TABLE IF NOT EXISTS catalogo_imagem (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    imagem     BYTEA NOT NULL,
    mime_type  VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
    criado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criado_por UUID
);

-- Biblioteca reutilizável de produtos (foto + código + descrição cadastrados uma única vez)
CREATE TABLE IF NOT EXISTS catalogo_biblioteca (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_produto VARCHAR(40) NOT NULL UNIQUE,
    descricao      VARCHAR(200),
    imagem_id      UUID REFERENCES catalogo_imagem(id) ON DELETE SET NULL,
    criado_em      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criado_por     UUID
);

-- Modelos/versões de catálogo
CREATE TABLE IF NOT EXISTS catalogo_modelo (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome            VARCHAR(120) NOT NULL,
    titulo_pagina   VARCHAR(160) NOT NULL DEFAULT 'Catálogo 3LACKD 2026',
    subtitulo       TEXT,
    ano             INTEGER NOT NULL DEFAULT 2026,
    oficial         BOOLEAN NOT NULL DEFAULT FALSE,
    colunas_ficha   JSONB NOT NULL DEFAULT '[]'::jsonb,
    capa_inicial_id UUID REFERENCES catalogo_imagem(id) ON DELETE SET NULL,
    capa_indice_id  UUID REFERENCES catalogo_imagem(id) ON DELETE SET NULL,
    capa_final_id   UUID REFERENCES catalogo_imagem(id) ON DELETE SET NULL,
    usar_capa_padrao BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criado_por      UUID,
    atualizado_em   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogo_oficial
    ON catalogo_modelo (oficial) WHERE oficial = TRUE;

-- Itens de um modelo = produtos da biblioteca FLAGADOS para aquele catálogo
CREATE TABLE IF NOT EXISTS catalogo_produto (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    modelo_id     UUID NOT NULL REFERENCES catalogo_modelo(id) ON DELETE CASCADE,
    biblioteca_id UUID REFERENCES catalogo_biblioteca(id) ON DELETE CASCADE,
    ordem         INTEGER NOT NULL DEFAULT 0,
    criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Convergência de instalações criadas antes da biblioteca
ALTER TABLE catalogo_produto ADD COLUMN IF NOT EXISTS biblioteca_id UUID REFERENCES catalogo_biblioteca(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'catalogo_produto'
               AND column_name = 'codigo_produto') THEN
    ALTER TABLE catalogo_produto ALTER COLUMN codigo_produto DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_catalogo_produto_modelo ON catalogo_produto (modelo_id, ordem);
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogo_produto_item ON catalogo_produto (modelo_id, biblioteca_id);

-- Cache/import da base (Google Sheets)
CREATE TABLE IF NOT EXISTS catalogo_base_produtos (
    codigo_produto  VARCHAR(40) PRIMARY KEY,
    descricao       VARCHAR(200),
    dados           JSONB NOT NULL,
    sincronizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalogo_base_meta (
    chave         VARCHAR(40) PRIMARY KEY,
    valor         JSONB NOT NULL,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
