-- 020: índices de performance pra listagens.
-- Listagem de vídeos (Ateliê) ordena por updated_at DESC e o índice
-- antigo (videos_owner_sub_idx) ficou inútil depois da 014 (owner_sub
-- virou NULL pra todos os novos vídeos). Sem índice em updated_at,
-- cold-start de /api/videos chega a 2s+ em VMs ociosas.
--
-- Listagem de assets faz LEFT JOIN em videos por video_id; já existe
-- índice via FK, então não precisa. Mas a galeria-projeto filtra por
-- a.deleted_at IS NULL — adiciona partial index pra cobrir.

CREATE INDEX IF NOT EXISTS videos_updated_at_idx
  ON videos (updated_at DESC);

CREATE INDEX IF NOT EXISTS assets_active_project_idx
  ON assets (project_id, updated_at DESC)
  WHERE deleted_at IS NULL;
