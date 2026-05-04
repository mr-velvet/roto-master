-- 008: jobs de geração assíncrona.
-- Worker (worker.js no mesmo container) consome status='queued' com FOR UPDATE SKIP LOCKED.
-- Cliente faz polling em /api/jobs?status=queued,running.

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error_message TEXT,
  provider_job_id TEXT,
  cost_estimated NUMERIC(10,4) NOT NULL DEFAULT 0,
  cost_actual NUMERIC(10,4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jobs
  ADD CONSTRAINT jobs_kind_check
  CHECK (kind IN (
    'generate-appearance',
    'generate-framing',
    'generate-motion',
    'download-from-url'
  ));

ALTER TABLE jobs
  ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed'));

CREATE INDEX IF NOT EXISTS jobs_owner_sub_idx ON jobs (owner_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_worker_idx ON jobs (status, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS jobs_owner_status_idx ON jobs (owner_sub, status);
