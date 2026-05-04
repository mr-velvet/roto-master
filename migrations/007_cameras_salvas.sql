-- 007: cameras salvas (presets de posição/rotação/FOV reusáveis pelo usuário).

CREATE TABLE IF NOT EXISTS cameras_salvas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub TEXT NOT NULL,
  name TEXT NOT NULL,
  camera_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cameras_salvas_owner_sub_idx
  ON cameras_salvas (owner_sub, created_at DESC);
