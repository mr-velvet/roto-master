-- 014: simplificação de auth — token único, sem owner.
-- Decisão (2026-05-05): ferramenta interna, time pequeno, fricção de
-- login/permissionamento causou dor de cabeça desproporcional. Quem tem o
-- APP_TOKEN vê e mexe em tudo. Não há mais distinção de usuário.
--
-- Estratégia: NÃO dropar colunas owner_sub/owner_email pra preservar dados
-- existentes (uma migration de drop seria irreversível). Apenas relaxar
-- constraints pra que novos INSERTs possam omitir essas colunas. Drop só
-- da tabela project_members que era exclusivamente sobre permissionamento.

ALTER TABLE projects ALTER COLUMN owner_sub DROP NOT NULL;
ALTER TABLE videos ALTER COLUMN owner_sub DROP NOT NULL;
ALTER TABLE videos ALTER COLUMN owner_email DROP NOT NULL;
ALTER TABLE assets ALTER COLUMN owner_sub DROP NOT NULL;

DROP TABLE IF EXISTS project_members CASCADE;
