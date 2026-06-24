-- Migration: criação da tabela do álbum de fotos "Seleção EMPRESA"
-- Aplica-se ao schema corrente (portal_chamado ou portal_chamado_homolog)

CREATE TABLE IF NOT EXISTS eventos_album_fotos (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    foto       BYTEA NOT NULL,
    mime_type  VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
    ordem      INTEGER NOT NULL,
    criado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criado_por UUID
);

CREATE INDEX IF NOT EXISTS idx_eventos_album_fotos_ordem
    ON eventos_album_fotos (ordem);
