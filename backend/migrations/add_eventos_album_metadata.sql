-- Migration: metadados das figurinhas (estilo Panini) no álbum "Seleção EMPRESA"
-- Aplica-se ao schema corrente (portal_chamado ou portal_chamado_homolog)
-- Defensivo: ADD COLUMN IF NOT EXISTS

ALTER TABLE eventos_album_fotos ADD COLUMN IF NOT EXISTS nome         VARCHAR(80);
ALTER TABLE eventos_album_fotos ADD COLUMN IF NOT EXISTS posicao      VARCHAR(60);
ALTER TABLE eventos_album_fotos ADD COLUMN IF NOT EXISTS numero       VARCHAR(10);
ALTER TABLE eventos_album_fotos ADD COLUMN IF NOT EXISTS craque       BOOLEAN DEFAULT FALSE;
ALTER TABLE eventos_album_fotos ADD COLUMN IF NOT EXISTS obj_position VARCHAR(30) DEFAULT 'center 30%';
