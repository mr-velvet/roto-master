-- 004: assets (entregáveis publicados, vivem dentro de projetos).
-- Relação 1:1 com videos via UNIQUE(video_id).
-- Adiciona FK em videos.published_asset_id agora que a tabela existe.

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
  owner_sub TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  gcs_path TEXT NOT NULL DEFAULT '',
  gcs_url TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (video_id)
);

ALTER TABLE assets
  ADD CONSTRAINT assets_status_check
  CHECK (status IN ('pending', 'done'));

CREATE INDEX IF NOT EXISTS assets_project_id_idx ON assets (project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS assets_status_idx ON assets (project_id, status);

ALTER TABLE videos
  ADD CONSTRAINT videos_published_asset_id_fkey
  FOREIGN KEY (published_asset_id) REFERENCES assets(id) ON DELETE SET NULL;
