-- 006: enquadramentos avulsos (especificação de câmera reusável, sem personagem associado).
-- Existem pra honrar a regra da visão item 7: "um enquadramento pode ser usado com vários
-- personagens". Na prática inicial talvez fiquem vazios; manter a tabela pra não quebrar a visão.

CREATE TABLE IF NOT EXISTS enquadramentos_avulsos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub TEXT NOT NULL,
  name TEXT NOT NULL,
  camera_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  viewport_screenshot_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enquadramentos_avulsos_owner_sub_idx
  ON enquadramentos_avulsos (owner_sub, created_at DESC);
