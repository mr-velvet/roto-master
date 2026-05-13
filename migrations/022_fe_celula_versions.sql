-- 022: Frames Editor — historico de versoes de celula pra undo de prompts.
--
-- Cada vez que processarCelula substitui o png_url de uma fe_celula que ja
-- tinha conteudo, a versao anterior (png_url + dims + prompt + modelo) e
-- guardada aqui. O endpoint POST /api/fe/celulas/:id/undo pop a mais recente
-- pra fe_celula, deletando a linha de versao (single-step undo, sem redo).
--
-- Sem retencao automatica no MVP — alinhado com docs/frame-editor/storage.md §3
-- (PNGs antigos no GCS tambem ficam sem politica de limpeza por enquanto).

CREATE TABLE IF NOT EXISTS fe_celula_versao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  celula_id UUID NOT NULL REFERENCES fe_celula(id) ON DELETE CASCADE,
  png_url TEXT,
  largura INTEGER,
  altura INTEGER,
  prompt TEXT,
  model_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fe_celula_versao_celula_recent_idx
  ON fe_celula_versao (celula_id, created_at DESC);
