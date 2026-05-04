-- 002: expande tabela videos com colunas da nova visão (workbench do usuário).
-- FK videos.published_asset_id é adicionada na migration 004 (depois que assets existir).

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS published_asset_id UUID,
  ADD COLUMN IF NOT EXISTS source_aparencia_id UUID,
  ADD COLUMN IF NOT EXISTS source_enquadramento_id UUID,
  ADD COLUMN IF NOT EXISTS source_enquadramento_kind TEXT,
  ADD COLUMN IF NOT EXISTS source_motion_prompt TEXT,
  ADD COLUMN IF NOT EXISTS source_model_key TEXT;

ALTER TABLE videos
  ADD CONSTRAINT videos_origin_check
  CHECK (origin IN ('uploaded', 'url', 'generated-generic', 'generated-from-character'));

ALTER TABLE videos
  ADD CONSTRAINT videos_source_enquadramento_kind_check
  CHECK (source_enquadramento_kind IS NULL OR source_enquadramento_kind IN ('personagem', 'avulso'));

CREATE INDEX IF NOT EXISTS videos_published_asset_id_idx ON videos (published_asset_id);
CREATE INDEX IF NOT EXISTS videos_origin_idx ON videos (owner_sub, origin);
