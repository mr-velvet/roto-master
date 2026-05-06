-- 015: lixeira global de assets via soft delete.
-- deleted_at NULL = ativo. NOT NULL = na lixeira.
-- Listagens normais filtram WHERE deleted_at IS NULL.
-- GET /api/assets/trash filtra WHERE deleted_at IS NOT NULL.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Index pra listar lixeira do user rápido (ordenado por descarte mais recente).
CREATE INDEX IF NOT EXISTS assets_deleted_at_idx ON assets (deleted_at DESC) WHERE deleted_at IS NOT NULL;

-- Drop do UNIQUE(video_id) — agora um vídeo pode ter um asset ativo + N na lixeira.
-- Substituído por unique parcial: só um asset ATIVO por vídeo.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_video_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS assets_video_id_active_uidx
  ON assets (video_id) WHERE deleted_at IS NULL;
