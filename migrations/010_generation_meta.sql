-- 010: histórico de tentativas de geração colado no vídeo (fluxo C).
-- Schema do JSONB:
-- {
--   "image_prompt": string,
--   "image_url": string,            -- imagem-base usada na geração ATIVA
--   "image_refs": [string, ...],    -- refs usadas pra gerar a image_url (opcional)
--   "model_image": string,          -- key da tabela models
--   "model_motion": string,
--   "active_attempt_idx": int,      -- aponta pra attempts[i].url que está em videos.gcs_url
--   "attempts": [
--     {
--       "url": string,              -- URL no GCS
--       "motion_prompt": string,
--       "duration_s": int,
--       "source_image_url": string, -- imagem-base usada NESSA tentativa específica
--       "cost": number,
--       "generated_at": string (ISO)
--     }
--   ]
-- }

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS generation_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Seed update: ajusta keys pra bater com o que fal.ai expõe hoje (em 2026-05-04).
-- ON CONFLICT garante idempotência.
INSERT INTO models (key, name, step, provider, cost_per_unit, unit, default_params, enabled) VALUES
  ('fal-ai/nano-banana-pro', 'Nano Banana Pro (txt→img)', 'appearance', 'fal-ai', 0.04, 'per_call',
   '{"resolution": "1K", "aspect_ratio": "16:9"}'::jsonb, TRUE),
  ('fal-ai/nano-banana-pro/edit', 'Nano Banana Pro (img+refs→img)', 'appearance', 'fal-ai', 0.04, 'per_call',
   '{"resolution": "1K", "aspect_ratio": "16:9"}'::jsonb, TRUE),
  ('fal-ai/kling-video/v2.5-turbo/pro/image-to-video', 'Kling 2.5 Turbo Pro (i2v)', 'motion', 'fal-ai', 0.07, 'per_second',
   '{"default_duration_s": 5}'::jsonb, TRUE)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  cost_per_unit = EXCLUDED.cost_per_unit,
  default_params = EXCLUDED.default_params,
  updated_at = NOW();

-- Desabilita seeds antigos (que existiam mas com keys que não batem com o fal real).
UPDATE models SET enabled = FALSE
  WHERE key IN ('nano-banana-pro', 'nano-banana-pro-framing', 'kling-i2v', 'hailuo-i2v');
