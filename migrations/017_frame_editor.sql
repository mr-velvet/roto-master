-- 017: Frames Editor — 4 tabelas isoladas com prefixo fe_*.
-- Espelha docs/frame-editor/modelo-de-dados.md (escopo MVP).
--
-- Princípios:
-- - Editor online com estado vivo no banco (não stateless).
-- - "Nada é do usuário": sem owner_*, qualquer pessoa com APP_TOKEN vê tudo.
-- - Pixel não vive no banco — fe_celula.png_url referencia PNG no GCS.
-- - Cardinalidade de fe_celula é sempre C × Q (célula vazia = png_url NULL).
-- - Sem cache de IA, sem versionamento de pixel, sem .aseprite proativo.
--
-- Desacoplado do resto: nenhuma FK pra videos/assets/projects.
-- Comunicação com Assets é via arquivo .aseprite (cópia consciente, sem vínculo).

CREATE TABLE IF NOT EXISTS fe_tirinha (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL DEFAULT 'Tirinha sem título',
  largura INTEGER NOT NULL,
  altura INTEGER NOT NULL,
  origem TEXT NOT NULL,
  origem_meta JSONB,
  last_aseprite_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fe_tirinha
  ADD CONSTRAINT fe_tirinha_origem_check
  CHECK (origem IN ('vazia', 'upload', 'asset'));

CREATE INDEX IF NOT EXISTS fe_tirinha_updated_at_idx ON fe_tirinha (updated_at DESC);

CREATE TABLE IF NOT EXISTS fe_camada (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tirinha_id UUID NOT NULL REFERENCES fe_tirinha(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  visivel BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tirinha_id, ordem)
);

CREATE INDEX IF NOT EXISTS fe_camada_tirinha_idx ON fe_camada (tirinha_id, ordem);

CREATE TABLE IF NOT EXISTS fe_quadro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tirinha_id UUID NOT NULL REFERENCES fe_tirinha(id) ON DELETE CASCADE,
  indice INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tirinha_id, indice)
);

CREATE INDEX IF NOT EXISTS fe_quadro_tirinha_idx ON fe_quadro (tirinha_id, indice);

CREATE TABLE IF NOT EXISTS fe_celula (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tirinha_id UUID NOT NULL REFERENCES fe_tirinha(id) ON DELETE CASCADE,
  camada_id UUID NOT NULL REFERENCES fe_camada(id) ON DELETE CASCADE,
  quadro_id UUID NOT NULL REFERENCES fe_quadro(id) ON DELETE CASCADE,
  png_url TEXT,
  largura INTEGER,
  altura INTEGER,
  estado TEXT NOT NULL DEFAULT 'idle',
  estado_erro TEXT,
  estado_atualizado_em TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (camada_id, quadro_id)
);

ALTER TABLE fe_celula
  ADD CONSTRAINT fe_celula_estado_check
  CHECK (estado IN ('idle', 'processando'));

CREATE INDEX IF NOT EXISTS fe_celula_tirinha_idx ON fe_celula (tirinha_id);
CREATE INDEX IF NOT EXISTS fe_celula_estado_idx ON fe_celula (tirinha_id, estado) WHERE estado = 'processando';
