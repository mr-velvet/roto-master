-- 025: Frames Editor — extender fe_celula_versao pra suportar edicoes locais
-- (dither, pixel art, ajustes), nao so prompts de IA.
--
-- Ate aqui o historico de versoes assumia que toda mudanca era um prompt de IA.
-- Edicoes diretas (sem provider) reusam o mesmo mecanismo: grava versao antes
-- de sobrescrever png_url, undo funciona igual. So precisa de dois campos:
--   op_type   — qual operacao foi aplicada ('prompt', 'dither', 'adjust', ...)
--   op_params — parametros usados (JSONB) pra exibir no historico
--
-- Registros legados ficam op_type=NULL — interpretacao implicita 'prompt'
-- (so o caminho de IA gravava versoes ate agora).

ALTER TABLE fe_celula_versao
  ADD COLUMN IF NOT EXISTS op_type TEXT,
  ADD COLUMN IF NOT EXISTS op_params JSONB;
