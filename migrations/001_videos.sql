CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'sem nome',
  gcs_path TEXT NOT NULL,
  gcs_url TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  duration_s REAL,
  width INTEGER,
  height INTEGER,
  edit_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  share_id UUID UNIQUE DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS videos_owner_sub_idx ON videos (owner_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS videos_share_id_idx ON videos (share_id);
