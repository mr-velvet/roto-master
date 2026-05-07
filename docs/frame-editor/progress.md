# Frames Editor — progresso de implementação

Última atualização: 2026-05-08 (segunda atualização) — task #9 (integração com Assets) também entregue. Todas as 9 tasks fechadas. Falta apenas o smoke test do user com banco/túnel ativo.

Doc específico da implementação do **Frames Editor** (a 3ª área macro). Para o quadro geral do projeto e outras áreas, ver `PROGRESS.md` da raiz.

Os docs conceituais estão em `docs/frame-editor/` (visao, modelo-de-dados, storage, aseprite-io, ia, api, ui, integracao-com-assets) e são **fonte de verdade do contrato**. Este doc só rastreia o que foi entregue, o que falta e onde está cada coisa.

---

## Estado em uma frase

**MVP completo entregue** em uma sessão (2026-05-08), 9 de 9 tasks fechadas. Falta o smoke test do user com banco real. Em prod no próximo deploy.

## Mapa do código

### Banco
- `migrations/017_frame_editor.sql` — 4 tabelas `fe_*`. Aplicada em prod via `STEP 3` do `deploy.sh` no próximo deploy.

### Backend
- `routes/fe.js` — todos os endpoints sob `/api/fe/*` (CRUD de tirinha/camada/quadro/célula, `upload-png`, `upload-aseprite`, `prompts`).
- `lib/fe-prompts.js` — processamento assíncrono de prompts (provider Fal.ai `nano-banana-pro/edit`, concorrência limitada in-memory).
- `server.js` — `app.use('/api/fe', require('./routes/fe'))`.

### Frontend
- `public/js/aseprite_io.js` — parser/writer `.aseprite` genérico (não confundir com `aseprite.js` do editor de rotoscopia, que tem layout fixo `ref`/`draw`).
- `public/js/fe_api.js` — cliente das rotas.
- `public/js/fe_home.js` — Tela 1 (lista de tirinhas + modal "nova tirinha").
- `public/js/fe_editor.js` — Tela 2 (canvas + matriz + ações).
- `public/index.html` — alternador ternário, screens `#fe-home-screen`/`#fe-editor-screen`, modais "nova tirinha" e "prompt".
- `public/styles.css` — paleta própria escopada em `[data-space="frame-editor"]` (ciano `#4dd9d6` + grafite + violeta `#9070f0`).
- `public/js/router.js`, `public/js/chrome.js`, `public/js/main.js` — wire das rotas/alternador/bootstrap.

## Decisões fechadas durante a implementação

Cada uma dessas é cicatriz que pode confundir leitor que vai só pelos docs conceituais. Listadas pra ficar inequívoco.

1. **Provider de IA real é Fal.ai `nano-banana-pro/edit`**, não OpenAI (decisão pragmática: reusar `lib/providers/fal.js` que já está em prod evitou superfície nova de chave/lib). `docs/frame-editor/ia.md` §4 atualizado.
2. **Schema ganhou 3 colunas que não estavam no doc original** (`fe_tirinha.largura/altura NOT NULL`, `fe_tirinha.last_aseprite_url`, `fe_celula.estado/estado_erro/estado_atualizado_em`). `docs/frame-editor/modelo-de-dados.md` atualizado.
3. **Live updates via polling de 3s** enquanto há célula em `processando`. SSE/WS fica pra quando virar problema real de escala. `api.md` §8 deixava o mecanismo em aberto.
4. **`aseprite_io.js` é arquivo novo**, não estende o `aseprite.js` antigo. O writer antigo tem layout fixo `ref`/`draw` e é consumido pelo editor de rotoscopia em prod — mexer nele arriscava regressão.
5. **CONCURRENCY=3** no processamento de lote (workers in-memory). Sem fila persistente. Se o servidor cair no meio do lote, células ficam travadas em `processando` — aceitável no MVP, decisão de produto pra rodada própria.
6. **Identidade visual**: ciano-elétrico + grafite-frio + violeta como estado processando. Distinto do cobre+ink das outras duas áreas. `visao.md` §9 deixava livre.

## Tasks

| # | Task | Status | Commit |
|---|---|---|---|
| 1 | Commit + push das mudanças pendentes (PixVerse + docs) | ✅ | `6fcb1dc` + `338f588` |
| 2 | Migration `fe_*` | ✅ | `d4d4888` (alinhamento doc em `671612b`) |
| 3 | Parser/writer `.aseprite` genérico | ✅ | `0742331` (mergeado em `dbad9cc`) |
| 4 | CRUD backend `/api/fe/*` | ✅ | `a96d5e1` |
| 5 | Upload PNG + GCS path | ✅ | `a96d5e1` (junto com #4) |
| 6 | Endpoint de prompt + IA assíncrona | ✅ | `8869452` (doc `c4076cc`) |
| 7 | Live updates | ✅ | resolvido via polling, sem código extra |
| 8 | UI Tela 1 + Tela 2 | ✅ | `f3adca1` |
| 9 | Integração com Assets | ✅ commit `543dbf3` (migration 018) |

## Integração com Assets — entregue (task #9, commit `543dbf3`)

Duas pontes únicas, sem vínculo vivo (princípio §4.4 do `integracao-com-assets.md`):

**1. Asset → Frames Editor** (botão "editar como tirinha" no modal do asset):
- Front baixa `.aseprite` do asset, parseia com `aseprite_io.js`, sobe PNGs via `/api/fe/upload-png`, finaliza com `POST /api/fe/tirinhas` variante `asset`. `origem_meta` carrega `{ asset_id, tipo_aseprite: 'final' }` como cicatriz informativa.
- Lógica extraída pra `public/js/fe_import.js` (compartilhada com upload manual da Tela 1).
- Tirinha resultante é cópia consciente — mudanças nela não afetam o asset.

**2. Frames Editor → Asset** (botão "publicar como asset" habilitado na Tela 2):
- Modal custom com seletor de projeto + nome do asset.
- `POST /api/fe/tirinhas/:id/publicar-asset` orquestra: gera `.aseprite` no front, sobe via `uploadAseprite`, depois cria asset na área Assets via cópia interna do arquivo no GCS (`copyObject` server-side, sem baixar/resubir).
- Migration 018 relaxa `assets.video_id` pra nullable (asset publicado do Frames Editor não veio de um vídeo). `UNIQUE` parcial existente já é compatível com NULL no Postgres. JOINs em `routes/assets.js` viraram LEFT JOIN.
- Asset criado nasce com `status='done'`, `version=1`, `gcs_url` apontando pro `.aseprite` copiado.
- Sem vínculo: publicar mesma tirinha duas vezes cria dois assets distintos.

### Smoke test (último item pendente)

- User abre túnel IAP (`scripts/dev.cmd`), aplica migrations 016+017+018, sobe `node server.js`, navega `http://localhost:5050/#/fe`. Validar:
  - Criar tirinha vazia → editor abre.
  - Criar via upload `.aseprite` → célula a célula sobe → editor mostra os quadros.
  - Adicionar/remover camadas e quadros.
  - Disparar prompt em todos os quadros / em selecionados → células ficam `processando` → polling traz resultados.
  - Download `.aseprite` → arquivo gerado abre no Aseprite desktop sem erro.
  - **Editar como tirinha** num asset existente da Galeria → tirinha aparece no Frames Editor com os quadros do asset.
  - **Publicar como asset** na tirinha → asset aparece na Galeria, no projeto escolhido, com o `.aseprite` da tirinha.

### Adiadas conscientemente (não confundir com pendentes)

- **SSE/WebSocket** pra live updates (polling resolve enquanto não virar problema).
- **Cancelamento de prompt em curso** (`ia.md` §7).
- **Retry automático** pós-erro de provider (`ia.md` §8).
- **Cache de IA por (input + prompt)** (`ia.md` §10 — explicitamente fora do MVP).
- **Edição manual de pixels no canvas** (`ui.md` §5 anti-padrão #1).
- **Histórico/undo** (`ui.md` §5 anti-padrão #2).
- **Edição simultânea com locking/CRDT** (`modelo-de-dados.md` §5).
- **Varredura/limpeza de PNGs órfãos no GCS** (`storage.md` §6).
- **Drag-de-seleção retangular** na matriz (só click + shift/ctrl no MVP).
- **Reorder de camadas/quadros por drag** (`+camada`/`+quadro` cobrem o MVP).

### Conhecidas mas em outro doc

- `docs/visao-da-ferramenta.md` raiz e `docs/arquitetura-tecnica.md` raiz **continuam desatualizados** em relação ao patch v7 e a esta rodada. Ficam pra rodada própria de varredura de docs raiz.

## Como rodar

### Local
1. Abre túnel IAP: `gcloud compute start-iap-tunnel adorable-claude 5433 --zone=us-central1-a --local-host-port=localhost:5433` (ou `scripts/dev.cmd`).
2. Aplica migrations pendentes (016 PixVerse + 017 frame-editor) no Postgres da VM.
3. `node server.js` → `http://localhost:5050/#/fe`.

### Prod
- `cd ~/ved/devops-workflow-2026 && .\scripts\did.ps1 deploy roto-master`. `STEP 3` aplica migrations automaticamente. `https://roto.did.lu/#/fe`.

## Referências

- `docs/frame-editor/visao.md`, `docs/frame-editor/modelo-de-dados.md`, `docs/frame-editor/storage.md`, `docs/frame-editor/aseprite-io.md`, `docs/frame-editor/ia.md`, `docs/frame-editor/api.md`, `docs/frame-editor/ui.md`, `docs/frame-editor/integracao-com-assets.md` — contratos conceituais.
- `PROGRESS.md` raiz — quadro geral do projeto.
