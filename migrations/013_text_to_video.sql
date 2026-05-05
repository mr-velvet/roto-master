-- 013: fluxo D — text-to-video. Mesmo schema de generation_meta, mas
-- attempts[i] não tem source_image_url. Adiciona origin 'generated-t2v'
-- e seed do model fal-ai/kling-video/v2.5-turbo/pro/text-to-video.

ALTER TABLE videos
  DROP CONSTRAINT IF EXISTS videos_origin_check;

ALTER TABLE videos
  ADD CONSTRAINT videos_origin_check
  CHECK (origin IN ('uploaded', 'url', 'generated-generic', 'generated-from-character', 'generated-t2v'));

INSERT INTO models (key, name, step, provider, cost_per_unit, unit, default_params, enabled) VALUES
  ('fal-ai/kling-video/v2.5-turbo/pro/text-to-video', 'Kling 2.5 Turbo Pro (t2v)', 'motion', 'fal-ai', 0.07, 'per_second',
   '{"default_duration_s": 5}'::jsonb, TRUE)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  cost_per_unit = EXCLUDED.cost_per_unit,
  default_params = EXCLUDED.default_params,
  updated_at = NOW();
