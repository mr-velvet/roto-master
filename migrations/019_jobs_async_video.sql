-- 019: jobs assíncronos pra geração de vídeo (i2v + t2v).
-- Reativa a tabela `jobs` (criada em 008 e nunca consumida) com schema ajustado:
--   - jobs_kind_check passa a aceitar 'generate-video' e 'generate-text-video'
--     (mantém os 4 originais pra não quebrar nada hipotético).
--   - owner_sub vira NULL-able (auth simples removeu owner em 014).
--   - dismissed_at: marca quando o user dispensou a notificação na bandeja.
--   - video_id: FK pra videos quando o job entrega — facilita o link "abrir
--     no editor" e a limpeza em massa quando o vídeo vai pra lixeira.

ALTER TABLE jobs ALTER COLUMN owner_sub DROP NOT NULL;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_kind_check
  CHECK (kind IN (
    'generate-appearance',
    'generate-framing',
    'generate-motion',
    'download-from-url',
    'generate-video',
    'generate-text-video'
  ));

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS video_id UUID REFERENCES videos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_visible_idx ON jobs (created_at DESC)
  WHERE dismissed_at IS NULL AND status IN ('queued', 'running', 'completed', 'failed');
CREATE INDEX IF NOT EXISTS jobs_video_idx ON jobs (video_id) WHERE video_id IS NOT NULL;
