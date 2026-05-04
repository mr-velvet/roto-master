-- 009: catálogo de modelos de IA. Dirige a UI (dropdowns por etapa) e o cálculo de custo.

CREATE TABLE IF NOT EXISTS models (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  step TEXT NOT NULL,
  provider TEXT NOT NULL,
  cost_per_unit NUMERIC(10,4) NOT NULL,
  unit TEXT NOT NULL,
  default_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE models
  ADD CONSTRAINT models_step_check
  CHECK (step IN ('appearance', 'framing', 'motion'));

ALTER TABLE models
  ADD CONSTRAINT models_unit_check
  CHECK (unit IN ('per_call', 'per_second'));

CREATE INDEX IF NOT EXISTS models_step_enabled_idx ON models (step, enabled);

-- Seed inicial conforme docs/modulo-personagem.md seção 8.
INSERT INTO models (key, name, step, provider, cost_per_unit, unit, default_params) VALUES
  ('nano-banana-pro', 'Nano Banana Pro', 'appearance', 'google', 0.04, 'per_call',
   '{"resolution": "1K"}'::jsonb),
  ('nano-banana-pro-framing', 'Nano Banana Pro', 'framing', 'google', 0.04, 'per_call',
   '{"resolution": "1K"}'::jsonb),
  ('kling-i2v', 'Kling 2.5 Turbo Pro (i2v)', 'motion', 'fal-kling', 0.07, 'per_second',
   '{"default_duration_s": 5}'::jsonb),
  ('hailuo-i2v', 'Hailuo (i2v)', 'motion', 'fal-hailuo', 0.045, 'per_second',
   '{"default_duration_s": 5}'::jsonb)
ON CONFLICT (key) DO NOTHING;
