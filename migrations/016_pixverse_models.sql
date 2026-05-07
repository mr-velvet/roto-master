-- Adiciona PixVerse V6 ao catálogo de modelos. Aceita 1-15s inteiro,
-- $0.045/s a 720p — escolha automática quando user pede menos de 5s
-- (Kling tem mínimo 5s).

-- Permite step='motion-text' pra t2v além do 'motion' que já existia.
ALTER TABLE models DROP CONSTRAINT IF EXISTS models_step_check;
ALTER TABLE models
  ADD CONSTRAINT models_step_check
  CHECK (step IN ('appearance', 'framing', 'motion', 'motion-text'));

-- Marca as model_id strings reais do fal pra match com result.model.
INSERT INTO models (key, name, step, provider, cost_per_unit, unit, default_params, enabled) VALUES
  ('fal-ai/pixverse/v6/image-to-video', 'PixVerse V6 (i2v)', 'motion', 'fal-pixverse', 0.045, 'per_second',
   '{"default_duration_s": 3, "min_duration_s": 1, "max_duration_s": 15, "resolution": "720p"}'::jsonb, TRUE),
  ('fal-ai/pixverse/v6/text-to-video', 'PixVerse V6 (t2v)', 'motion-text', 'fal-pixverse', 0.045, 'per_second',
   '{"default_duration_s": 3, "min_duration_s": 1, "max_duration_s": 15, "resolution": "720p"}'::jsonb, TRUE)
ON CONFLICT (key) DO NOTHING;

-- Garante que os Kling estejam catalogados pelos seus model_id reais (modelCost
-- consulta por result.model que é o full id do fal). Os keys existentes do
-- seed inicial (kling-i2v, hailuo-i2v) eram aliases — não batiam com result.model.
INSERT INTO models (key, name, step, provider, cost_per_unit, unit, default_params, enabled) VALUES
  ('fal-ai/kling-video/v2.5-turbo/pro/image-to-video', 'Kling 2.5 Turbo Pro (i2v)', 'motion', 'fal-kling', 0.07, 'per_second',
   '{"default_duration_s": 5, "allowed_duration_s": [5, 10]}'::jsonb, TRUE),
  ('fal-ai/kling-video/v2.5-turbo/pro/text-to-video', 'Kling 2.5 Turbo Pro (t2v)', 'motion-text', 'fal-kling', 0.07, 'per_second',
   '{"default_duration_s": 5, "allowed_duration_s": [5, 10]}'::jsonb, TRUE)
ON CONFLICT (key) DO UPDATE SET step = EXCLUDED.step, name = EXCLUDED.name, cost_per_unit = EXCLUDED.cost_per_unit, default_params = EXCLUDED.default_params;
