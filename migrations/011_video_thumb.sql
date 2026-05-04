-- 011: thumb (primeiro frame) do vídeo, capturada pelo cliente no editor
-- e usada como preview em cards de vídeo e de asset.

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS thumb_url TEXT;
