-- 005: personagens + árvore de variações (aparências, enquadramentos, movimentos).
-- Cada nó tem state ('favorita' | 'neutra' | 'descartada'). Lógica do app garante
-- exclusividade da favorita por etapa+pai (sem trigger).

CREATE TABLE IF NOT EXISTS personagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'sem nome',
  cover_aparencia_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS personagens_owner_sub_idx ON personagens (owner_sub, created_at DESC);

CREATE TABLE IF NOT EXISTS personagem_aparencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  personagem_id UUID NOT NULL REFERENCES personagens(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  style TEXT NOT NULL,
  model_key TEXT NOT NULL,
  gcs_url TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'neutra',
  cost_actual NUMERIC(10,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE personagem_aparencias
  ADD CONSTRAINT personagem_aparencias_style_check
  CHECK (style IN ('realismo', 'semi-realista', 'cartoon'));

ALTER TABLE personagem_aparencias
  ADD CONSTRAINT personagem_aparencias_state_check
  CHECK (state IN ('favorita', 'neutra', 'descartada'));

CREATE INDEX IF NOT EXISTS personagem_aparencias_personagem_id_idx
  ON personagem_aparencias (personagem_id, created_at DESC);

ALTER TABLE personagens
  ADD CONSTRAINT personagens_cover_aparencia_fkey
  FOREIGN KEY (cover_aparencia_id) REFERENCES personagem_aparencias(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS personagem_enquadramentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_aparencia_id UUID NOT NULL REFERENCES personagem_aparencias(id) ON DELETE CASCADE,
  camera_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  viewport_screenshot_url TEXT,
  prompt_extra TEXT,
  model_key TEXT NOT NULL,
  gcs_url TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'neutra',
  cost_actual NUMERIC(10,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE personagem_enquadramentos
  ADD CONSTRAINT personagem_enquadramentos_state_check
  CHECK (state IN ('favorita', 'neutra', 'descartada'));

CREATE INDEX IF NOT EXISTS personagem_enquadramentos_parent_idx
  ON personagem_enquadramentos (parent_aparencia_id, created_at DESC);

CREATE TABLE IF NOT EXISTS personagem_movimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_enquadramento_id UUID NOT NULL REFERENCES personagem_enquadramentos(id) ON DELETE CASCADE,
  motion_prompt TEXT NOT NULL,
  duration_s INTEGER NOT NULL,
  model_key TEXT NOT NULL,
  video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'neutra',
  cost_actual NUMERIC(10,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE personagem_movimentos
  ADD CONSTRAINT personagem_movimentos_state_check
  CHECK (state IN ('favorita', 'neutra', 'descartada'));

CREATE INDEX IF NOT EXISTS personagem_movimentos_parent_idx
  ON personagem_movimentos (parent_enquadramento_id, created_at DESC);

-- Agora que personagem_aparencias e personagem_enquadramentos existem,
-- liga as FKs de snapshot em videos (criadas vazias na migration 002).
ALTER TABLE videos
  ADD CONSTRAINT videos_source_aparencia_fkey
  FOREIGN KEY (source_aparencia_id) REFERENCES personagem_aparencias(id) ON DELETE SET NULL;
