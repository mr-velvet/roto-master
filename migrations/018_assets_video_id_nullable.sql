-- 018: relaxa assets.video_id pra nullable.
--
-- Razão: integração Frames Editor → Assets ("Publicar como novo asset" no
-- editor de tirinha) cria asset que NÃO veio de um vídeo. video_id 1:1
-- obrigatório era cicatriz do modelo antigo (todo asset = saída de
-- rotoscopia de vídeo).
--
-- O unique parcial existente em assets_video_id_active_uidx já é
-- compatível com NULL (Postgres trata NULL como "diferente de tudo" em
-- UNIQUE INDEX, então N assets sem vídeo não conflitam entre si).

ALTER TABLE assets ALTER COLUMN video_id DROP NOT NULL;
