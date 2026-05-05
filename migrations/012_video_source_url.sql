-- 012: Fluxo B (vídeo de URL).
-- videos com origin='url' nascem apontando pra source_url externa.
-- Quando o user "extrai trecho", cria-se um vídeo NOVO independente
-- com source_url + source_segment_in_s/out_s preenchidos e gcs_url
-- apontando pro pedaço cortado.

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS source_url        TEXT,
  ADD COLUMN IF NOT EXISTS source_segment_in_s  REAL,
  ADD COLUMN IF NOT EXISTS source_segment_out_s REAL;
