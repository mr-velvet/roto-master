-- 023: Frames Editor — png_url original por celula.
--
-- "Original" eh a imagem que veio na importacao (.aseprite/video/upload)
-- ou foi subida manualmente antes do primeiro prompt. NUNCA muda depois.
-- Independente do hist orico de prompts (fe_celula_versao) — eh sagrada.
--
-- Usado pelo frontend pra mostrar "antes de tudo" ao segurar tecla O.
-- Celula que comecou vazia fica com original=NULL — comportamento esperado.
--
-- Backfill: pra celulas existentes que tem png_url mas nao tem versao
-- registrada, assume que o png_url atual eh tambem o original. Pra celulas
-- que ja' passaram por prompt (tem linha em fe_celula_versao), pega a
-- versao mais antiga conhecida (LIMIT 1 ORDER BY created_at ASC).

ALTER TABLE fe_celula
  ADD COLUMN IF NOT EXISTS png_url_original TEXT;

-- Backfill: celulas que NAO tem versao registrada (= nunca passaram por
-- prompt) → original = png_url atual.
UPDATE fe_celula c
   SET png_url_original = c.png_url
 WHERE png_url_original IS NULL
   AND c.png_url IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM fe_celula_versao v WHERE v.celula_id = c.id
   );

-- Backfill: celulas que tem versao registrada → original = versao mais antiga
-- (ANTES do primeiro prompt aplicado). Pode ser NULL (celula comecou vazia).
UPDATE fe_celula c
   SET png_url_original = (
     SELECT v.png_url
       FROM fe_celula_versao v
      WHERE v.celula_id = c.id
      ORDER BY v.created_at ASC
      LIMIT 1
   )
 WHERE png_url_original IS NULL
   AND EXISTS (
     SELECT 1 FROM fe_celula_versao v WHERE v.celula_id = c.id
   );
