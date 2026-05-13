-- 024: pastas no Atelie pra agrupar videos.
--
-- Escopo MVP (alinhado em conversa 2026-05-13):
--   - Pastas globais (sem owner). Coerente com "nada na plataforma e do user".
--   - Um nivel so (sem aninhamento).
--   - Video tem 0 ou 1 pasta (folder_id NULL = raiz do Atelie).
--   - Nome unico globalmente (case-insensitive).
--   - Apagar pasta nao deleta videos — eles voltam pra raiz (ON DELETE SET NULL).

CREATE TABLE IF NOT EXISTS video_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique case-insensitive no nome. Evita duas pastas "Skate" e "skate".
CREATE UNIQUE INDEX IF NOT EXISTS video_folders_nome_lower_uq
  ON video_folders (LOWER(nome));

-- Adiciona folder_id em videos. SET NULL no delete = video sobrevive a apagar
-- pasta e volta pra raiz, conforme decisao de produto.
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS folder_id UUID
  REFERENCES video_folders(id) ON DELETE SET NULL;

-- Index pra filtrar videos por pasta rapido (ex: GET /api/videos?folder_id=...).
CREATE INDEX IF NOT EXISTS videos_folder_id_idx ON videos (folder_id);
