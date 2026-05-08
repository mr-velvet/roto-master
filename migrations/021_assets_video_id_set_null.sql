-- 021: troca assets.video_id FK de ON DELETE RESTRICT pra SET NULL.
--
-- Decisão (2026-05-08): vídeo e asset são entidades independentes. Asset
-- vive no projeto sob seu próprio nome (pensa "sistema de arquivos"); a
-- referência ao vídeo-fonte é só metadata de origem. O RESTRICT antigo
-- impedia mandar pra lixeira qualquer vídeo já publicado, o que quebrava
-- o bulk delete e o fluxo de limpeza no Ateliê.
--
-- Migração equivalente já fizemos pra `videos.published_asset_id`?
-- Sim, era SET NULL desde o início (não bloqueava). Aqui só refletimos
-- a mesma decisão no outro lado da relação.

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_video_id_fkey;
ALTER TABLE assets
  ADD CONSTRAINT assets_video_id_fkey
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE SET NULL;
