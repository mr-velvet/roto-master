# PROGRESS — roto-master

Última atualização: 2026-05-05 fim do dia (smoke test fixes + Fluxo D em prod. Tudo comitado (`9267494`) e deployado em `https://roto.did.lu` — saudável, código atual rodando. Deploy passou a sincronizar via git no `deploy.sh` da VM.)

## ⚠️ Leitura obrigatória antes de continuar

### Ordem de leitura — não inverter

1. **`docs/visao-da-ferramenta.md`** — referência mestra. **Ler INTEIRO**. Em ordem de criticidade pra UI: seção 6.1 (metáfora Ateliê/Galeria), 6.5 (anti-padrões — lista do que NÃO pode aparecer), 6.7 (detalhe do asset, decisão fechada no patch v4), 6.6 (regra de validação).
2. **`docs/arquitetura-tecnica.md`** — espelho técnico. Régua: **time interno pequeno** — não inventar cerimônia de SaaS público.
3. **`docs/modulo-personagem.md`** — especialização do Fluxo D. Anterior à visão mestra; em conflito **vale a visão**.

### Cicatrizes de erros reais (não esquecer)

- **2026-05-04:** o segundo protótipo violou anti-padrões de UI por pular a seção 6. Patch v3 da visão nasceu desse erro. **Antes de produzir QUALQUER UI**, passar pelo checklist da seção 12 da visão. Se não passar, parar.
- **2026-05-04:** durante o trabalho da fatia mínima, ao tentar conversar com o user sobre decisões técnicas, deliri trazendo preocupações de produto público (membership pra prevenir vazamento, etc.) num contexto de time interno pequeno e fechado. Régua é "isso aparece porque é necessidade desta ferramenta ou porque é padrão de SaaS?". Se for o segundo, remover.
- **2026-05-04:** durante a v1, ignorei a definição de "Detalhe de asset" (seção 6.2 ponto 5) tratando como "decisão futura" e entreguei o asset card sem ação alguma. Resultado: o usuário publicou um asset e ficou olhando pra um card morto. Princípio "asset é cidadão central" quebrado. Patch v4 da visão fechou a decisão (modal, ver 6.7).
- **Asset é cidadão central**, não label técnico. Se entrar na ferramenta e não ver "isto é um asset" como objeto tangível e **interagível**, a UI errou.

## Estado atual

**Em produção em https://roto.did.lu:** v1 fechada (commit `10d59fc`).

**Em main mas NÃO deployado ainda** (commits `bef6eb7`, `9e7465a`, `5977749`):
- **Fluxo C** completo (geração genérica): prompt → imagem (Nano Banana Pro) → vídeo (Kling 2.5 Turbo Pro i2v).
- **Fluxo B** completo (vídeo de URL/YouTube): cola URL → editor com streaming → "extrair trecho" gera novo vídeo no GCS.
- **UX:** botão voltar no editor, nome inline editável, loading do vídeo, thumb (1º frame), context menu no asset, "melhorar prompt" via Sonnet 4.6, sanitizar imagem via Nano Banana edit, timer de geração, upload/paste/drop de imagem inicial.

**Ambiente local funcionando** com bypass de auth + túnel IAP pro Postgres da VM. Ver "ambiente local" abaixo.

### Antes do próximo deploy

Dockerfile precisa de yt-dlp+ffmpeg (já adicionado no commit `5977749`). Migrations 010, 011, 012 precisam rodar via deploy.sh da plataforma. Receita Anthropic em `lib/prompt-recipes.js` é editável — manter atualizada conforme modelos evoluem.

### Bug aberto

- **"Usar como imagem inicial" no modal de paste/drop:** botão clica mas request `/api/generate/ref-upload` não dispara. Adicionei console.log de debug — precisa o user reproduzir e me trazer o log.

### Smoke test 2026-05-05 — fixes feitos (não comitados)

- **Feedback do "re-editar" no modal de detalhe do asset.** O botão funcionava mas dava sensação de quebrado: entre o click e o vídeo aparecer no editor podia passar quase 1 min em vídeos grandes. Agora `openEditor` mostra o spinner `#video-loading` imediatamente ("abrindo vídeo…" → "baixando vídeo do storage…"). `editor.js` modificado.
- **Republish que muda nome/projeto cria asset novo (mantendo asset original).** Visão diz "1:1 vídeo↔asset, reuso = duplicar vídeo". Implementação: novo endpoint `POST /api/videos/:id/publish-as-new` que duplica vídeo + cria asset novo numa transação (usa `copyObject` do GCS, sem baixar blob). Modal de publish agora pré-preenche projeto+nome do asset existente quando vídeo já está publicado e mostra info ao vivo "vai sobrescrever" vs "vai criar novo" conforme user altera nome/projeto. Sobrescreve só quando ambos batem. Arquivos: `routes/videos.js`, `public/js/videos_api.js`, `public/js/editor.js`, `public/index.html`, `public/styles.css`.

### Pendências de futuro

- Cobrir edição/recorte de uploads/gerados (não só url) — `extract` só funciona com source_url hoje.
- "Adapt for content policy" automático antes do gerar (se quiser virar opt-in).
- Adicionar crédito Anthropic na chave pra o "melhorar" funcionar local (já funciona em prod).

## Ambiente local (dev no Windows)

Setup já feito, persiste sem reconfiguração:

- **Server:** `node server.js` na pasta do projeto. Porta 5050 (5031 ocupada por outra coisa). URL: http://localhost:5050.
- **Auth:** bypass via `DEV_USER_SUB` + `DEV_USER_EMAIL` no `.env`. `requireUser` injeta esse user, `auth.js` do front detecta `localhost` e pula Logto.
- **Postgres:** túnel IAP do Windows → container `roto-pgproxy` (socat) na VM → Postgres real. Comando: `gcloud compute start-iap-tunnel adorable-claude 5433 --zone=us-central1-a --local-host-port=localhost:5433`. `scripts/dev.cmd` automatiza.
- **GCS:** mesma chave que produção, copiada no `.env` local. Sobe arquivos pro mesmo bucket.
- **yt-dlp + ffmpeg:** binários em `~/.local/bin/` (yt-dlp.exe e ffmpeg-portable/). Path via env `YTDLP_BIN` e `FFMPEG_DIR` no `.env`.
- **fal.ai key:** `FAL_KEY` no `.env` (toolbelt pessoal). Mesma chave que VM.
- **Anthropic:** chave do toolbelt **sem crédito** — testes locais do "melhorar prompt" falham com 400, mensagem clara aparece no UI.

**Persistência VM:**
- `roto-pgproxy` rodando com `--restart unless-stopped` — sobrevive reboot.
- Firewall rule `allow-iap-pgproxy` (5433 do range IAP).

## O que está em produção e funcionando

### Plataforma e infra
- Container `roto-master` em `:5031`, Caddy serve `roto.did.lu` com HTTPS automático.
- Postgres compartilhado da plataforma, database `roto_master`. Migrations 001–009 aplicadas (as 005–009 criaram tabelas de v2 que ainda não são consumidas).
- Logto App ID `36iz4iomybe4r1n67a7jc` (Google OAuth), `auth.did.lu`. Multi-user via `req.user.sub`.
- GCS: bucket `didlu-imagestore`, URL pública via `https://st.did.lu/...`. Auth via `GCS_SERVICE_ACCOUNT` injetada pela plataforma.

### Galeria
- Home (`#/`): lista projetos onde o user é membro.
- Modal "novo projeto": cria + insere creator como owner em transação.
- Detalhe do projeto (`#/p/:id`): lista assets, filtros (todos/pendentes/feitos), chamada redigida quando vazio (sem "+ novo asset", anti-padrão 6.5).

### Ateliê
- Subseção Vídeos (`#/atelie`): grid de vídeos do user, selos (origem + publicado/rascunho), criar vídeo (fluxo A), apagar via confirm modal.
- Outras 3 subseções (Personagens, Enquadramentos, Câmeras) com selo "em breve" na sidebar — placeholders deferidos pra v2.

### Editor (`#/v/:id`)
- Editor de rotoscopia preservado: dois modos, dual-thumb in/out, transport único WYSIWYG, presets, sliders de PARAMS, export `.aseprite` local.
- Carrega vídeo do GCS se já upado; senão espera file picker e sobe em background.
- Autosave debounced (1s) + flush no beforeunload; `edit_state` restaurado ao reabrir.
- Modal "publicar como asset": escolhe projeto, aviso de sobrescrita ao republicar, transição animada de volta pra Galeria → Detalhe do projeto.

### Chrome global
- Alternador binário Galeria/Ateliê no canto direito do header.
- Header muda de cor entre os dois espaços (ink frio / cobre quente).
- Transição animada (~500ms) ao trocar de espaço, com label do destino.
- Breadcrumb persistente refletindo o caminho.

## O que falta pra fechar a v1

Apenas o item 5. Itens 1–4 implementados no commit `10d59fc` e em produção em `https://roto.did.lu`.

5. **Smoke test sistemático com você usando.** Você navega no app, lista tudo que parecer estranho (visual, fluxo confuso, console error), eu corrijo em batch. Aí marca v1 fechada formalmente.

### Resumo do que foi entregue nos itens 1–4

- **Item 1 — Detalhe do asset (modal 6.7).** `DELETE /api/assets/:id` (despublicar via `ON DELETE SET NULL`). Listagem de assets retorna `owner_email` via subquery em `project_members`. Modal `asset-detail` em `index.html`; lógica em `public/js/asset_modal.js`. Card no `gal_project.js` virou `<button>` com preview tipográfico (primeira letra do nome) e atalhos `↓ ↗` no hover. Inline-edit do nome no modal (Enter confirma, Esc descarta). Chip de status alterna pendente↔feito direto.
- **Item 2 — Vínculo asset→vídeo do lado do vídeo.** `GET /api/videos` com `LEFT JOIN` em `assets`+`projects` retornando `published_project_id` e `published_project_name`. Card de vídeo no Ateliê mostra "publicado em [Projeto]" como botão clicável que leva pro detalhe do projeto.
- **Item 3 — Duplicar vídeo.** `POST /api/videos/:id/duplicate` em transação: copia row sem `published_asset_id`, copia arquivo no GCS server-side via `lib/gcs.copyObject` (não baixa o blob). UI: botão `⎘` no hover do card de vídeo no Ateliê + botão "duplicar vídeo" no modal de detalhe do asset (caminho "publicar em outro projeto").
- **Item 4 — Convite de membros pelo UI.** `POST /api/projects/:id/members` (só owner; resolve sub via lookup em `project_members` ou cai em `pending:<email>` quando desconhecido). `DELETE /api/projects/:id/members/:sub` (só owner; bloqueia remover último owner). `middleware/auth.js` resolve linhas `pending:<email>` pro sub real automaticamente no primeiro login do convidado, com guarda contra duplicata. Seção "Membros" no detalhe do projeto com avatar+email+role+selo "aguarda 1º login" pros pending; input "adicionar por email" só visível pra owner.

## O que NÃO está na v1 (fica pra v2)

- Fluxo D (módulo personagem completo: aparências, enquadramentos, movimentos, viewport 3D, hierarquia de prompt).
- Jobs assíncronos + worker + tela "Gerações" no Ateliê + indicador no header.
- Catálogo de modelos consumido pela UI (tabela `models` já tem seed mas frontend não lê).
- Fluxos B (URL) e C (geração genérica).
- Share link público via `share_id`.
- Histórico de versões publicadas do mesmo asset (republish sobrescreve).
- Permissionamento granular dentro do projeto.
- Outros formatos de saída além de `.aseprite`.

## Próximos passos — plano pra fechar a v1

A ordem aqui é intencional. **Itens 1 e 2 são pareados** (um do lado do asset, outro do lado do vídeo) e fecham a regra 4 da seção 6.6 (vínculo asset↔vídeo visível). Item 3 é a operação de primeira classe que a visão (decisão 5) deixou faltando. Item 4 transforma "projeto compartilhado" de promessa do schema em coisa real. Item 5 é amarração final.

### 1. Detalhe do asset (modal)
Conforme `docs/visao-da-ferramenta.md` seção 6.7. Inclui o card também — hoje é puro losango sem ação.

Quebra em sub-passos:
- **Backend:** rota `DELETE /api/assets/:id` ("despublicar"; vídeo volta a ser rascunho, asset some). Já existe `PATCH /api/assets/:id` pra status — confirmar se aceita transição pendente↔feito sem regalia.
- **Frontend:**
  - Card de asset no `gal_project.js` ganha: click abre modal, hover revela atalhos `↓` (download direto) e `↗` (abrir editor direto), preview tipográfico (substituir o `◇`), selo de origem do vídeo.
  - Novo arquivo `asset_modal.js`: monta e gerencia o modal de detalhe. Lê o asset + busca o vídeo associado pra mostrar nome no vínculo "fonte".
  - Integração com router: opcional adicionar `#/p/:id/a/:asset_id` pra deep-link, mas pode ficar pra depois.

### 2. Vínculo asset↔vídeo visível do lado do vídeo
- Card de vídeo no Ateliê hoje mostra "publicado" sem dizer onde. Trocar pra "publicado em [Projeto X]" com nome do projeto, **clicável** — leva pro detalhe do projeto.
- Backend: `GET /api/videos` já retorna `published_asset_id`; expandir pra incluir `project_id` e `project_name` quando publicado (subquery via JOIN).
- Frontend: `atelie_videos.js` consome o campo novo e renderiza.

### 3. Duplicar vídeo na workbench
Operação de primeira classe (decisão 5 da seção 9 da visão).

- **Backend:** `POST /api/videos/:id/duplicate`. Cria row `videos` nova com mesmos `name` (com sufixo "(cópia)" ou similar), `origin`, `edit_state`, mas **sem** `published_asset_id` e **sem** `source_*_id` (duplicata é independente — visão fala explicitamente disso). Copia o arquivo no GCS pra path novo (`roto-master/videos/<novo-id>/source.<ext>`).
- **Frontend:** ação "duplicar" no card de vídeo (Ateliê) e no modal de detalhe do asset (item 1) — fluxo "publicar em outro projeto" começa por aqui.

### 4. Convite de membros pelo UI
Hoje a tabela `project_members` existe e é honrada nas queries, mas só dá pra adicionar membros via INSERT manual no banco. Sem UI, "projeto compartilhado" é só promessa.

- **Backend:**
  - `POST /api/projects/:id/members` body `{ email }`. Faz lookup no Logto (existe API `/api/users?search=<email>` em `auth.did.lu` — confirmar antes de implementar; se não existir, cair em INSERT cego e a primeira vez que o convidado logar o `member_sub` é resolvido). Retorna o membro adicionado.
  - `DELETE /api/projects/:id/members/:sub`. Só owner pode. Não deixa remover o último owner.
- **Frontend:** seção "Membros" no detalhe do projeto (`gal_project.js`), com lista atual e campo "adicionar por email" (só visível pra owner).

### 5. Smoke test sistemático
Após 1–4, você navega no app, lista tudo que parecer estranho (visual, fluxo confuso, console error), eu corrijo em batch. Atualizar PROGRESS pra marcar v1 fechada.

## v2 — depois da v1 fechar

Aplicar migrations 005–009 já está feito; falta o código que consome.

1. **Worker + tela de Gerações** — `worker.js` em paralelo ao `server.js`, consome `jobs WHERE status='queued'` com `FOR UPDATE SKIP LOCKED`. Subseção "Gerações" no Ateliê (5ª da sidebar) com lista cronológica + botão retry pra falhas. Indicador no header global com contador de jobs ativos.
2. **Fluxo D (módulo personagem)** — viewport 3D reaproveitando `prototype-v1-personagem/`, etapas aparência → enquadramento → movimento. Hierarquia de prompt embutida. Catálogo `models` consumido pela UI.
3. **Fluxos B/C** — vídeo de URL e geração genérica.
4. **Share link público** — rota `GET /api/share/:share_id` (sem auth) retorna metadata + URL do `.aseprite`.

## Estrutura do projeto

```
server.js                  Express + /api/health + monta /api/{config,videos,projects,assets}
package.json               express, pg, @google-cloud/storage, multer
Dockerfile                 node:20-alpine, EXPOSE 5031
did.json                   manifest da plataforma (logto+db+domain)

migrations/
  001_videos.sql                       videos (id, owner_sub, name, gcs_*, edit_state, share_id)
  002_videos_workbench_columns.sql     ALTER videos: origin + published_asset_id + source_*
  003_projects.sql                     projects + project_members (compartilhados)
  004_assets.sql                       assets + UNIQUE(video_id) + FK videos.published_asset_id
  005_personagens.sql                  personagens + aparencias + enquadramentos + movimentos (v2)
  006_enquadramentos_avulsos.sql       enquadramentos reusáveis sem personagem (v2)
  007_cameras_salvas.sql               presets de câmera do usuário (v2)
  008_jobs.sql                         jobs assíncronos + índice pro worker (v2)
  009_models.sql                       catálogo de modelos + seed (v2)

lib/
  gcs.js                   helper de upload pro GCS (bucket didlu-imagestore)

middleware/
  auth.js                  requireUser — valida token Logto via /oidc/me
  membership.js            isMember, isOwner — projetos compartilhados

routes/
  config.js                GET /api/config — identidade do user
  videos.js                CRUD + POST :id/upload + POST :id/publish (transação)
  projects.js              CRUD com membership; criação insere creator como owner
  assets.js                lista escopada, PATCH (rename/status), POST :id/publish (republish)

public/
  index.html               chrome global + screens + modais + canvas editor
  styles.css               sistema visual Atelier 2087 (paleta cobre/ink + Fraunces)
  logto-auth.js            wrapper do SDK Logto
  js/
    main.js                bootstrap: auth → router → screens
    auth.js                initAuth, signIn, signOut, authedFetch
    router.js              hash routing (#/, #/p/:id, #/atelie, #/v/:id)
    chrome.js              setSpace, setBreadcrumb, transição animada
    modals.js              sistema de modais + confirmModal + showToast
    gal_home.js            lista projetos + criar projeto
    gal_project.js         detalhe do projeto + lista de assets + filtros
    atelie_videos.js       lista vídeos + criar vídeo (fluxo A; B/C/D em breve)
    editor.js              wrapper editor: carrega gcs_url, upload em background, publicar
    autosave.js            debounce 1s + restore de edit_state
    file_loader.js         file picker + drag-drop + loadFromUrl (carrega do GCS)
    projects_api.js        cliente da API /api/projects
    assets_api.js          cliente da API /api/assets
    videos_api.js          cliente: list/create/get/patch/delete + upload + publish
    state.js               PARAMS, PRESETS, SLIDERS, STATE
    shaders.js             VS_SRC, FS_SRC
    gl.js                  WebGL boot + render + pixel IO
    capture.js             seek/await + resample + overlay + buildTimeline
    aseprite.js            ByteWriter + buildAseprite
    playback.js            source/rotoscope loops + setMode
    ui.js                  DOM refs + setProgress + handlers + export
```

## Decisões arquiteturais já estabelecidas (não revisitar sem motivo)

- **Sem build step.** Vanilla ES modules + CDN. Frontend serve direto via `express.static('public')`.
- **Modais custom** pra criar/confirmar (regra UI global: nunca `prompt()`/`confirm()`/`alert()` do browser).
- **Hash routing** em vez de history API — simples, não exige fallback no servidor.
- **Multi-user via `owner_sub`** do Logto, não via `ADMIN_TOKEN`. Whitelist removida deliberadamente.
- **Live bindings** preservados nos módulos WebGL (`prevTex`/`fbTex`/`plainProg` como `let` exportados, consumers via `import * as glmod`).
- **DI no playback** (não circular): `playback.js` recebe deps de UI via `bindUI()`.
- **Captura determinística** com `Promise.race([rVFC, setTimeout(80ms)])` — bug "frames idênticos" resolvido em 2026-04-30.
- **Y-flip:** `<video>` em `texImage2D` precisa de `UNPACK_FLIP_Y_WEBGL=true`. Buffer rotoscope chega bottom-up; export aplica `flipYRGBA` pra Aseprite (top-down).

## Histórico

### Fase 0–2.5 (no repo `random-experiments`, até 2026-04-30)
- PoC inicial → modularização (1463 linhas de monolito → 8 módulos ES) → 3 bugs fixed (modo source não iniciava, Y-flip rotoscope, dual-range trava).
- Detalhe completo no commit `a2cd695` do `random-experiments`.

### Fase 3 (este repo, 2026-04-30)
- File picker / drag-drop substituindo `<video src="video.mp4">` fixo.
- Embrulhamento Express + Docker + did.json.
- Deploy em `roto.did.lu` (com bug de domain customizado nos scripts da plataforma — corrigido na VM).
- Auth Logto Google + tabela `videos` + multi-user.
- Lista de vídeos como home + criação via modal + roteamento hash.

### Fase 4 — discussão de visão (2026-05-02 a 2026-05-03)

Sem código. Discussão profunda de produto que produziu dois documentos centrais:

- `docs/modulo-personagem.md` — primeira proposta: pipeline opinionada de 4 etapas (aparência → enquadramento → movimento → rotoscopia), com viewport 3D para enquadramento e árvore de exploração.
- Protótipo navegável v1 em `prototype/` (frontend-design skill + Three.js + Mixamo FBX). Validou visualmente o módulo personagem mas **revelou problema conceitual:** acoplamento forçado personagem ↔ enquadramento ↔ movimento, e foco excessivo no módulo personagem como se fosse o produto inteiro.
- `docs/visao-da-ferramenta.md` — síntese final que recoloca o módulo personagem como **um caminho dentro da ferramenta maior** (esteira de produção de assets de rotoscopia). Define entidades (Projeto, Asset, Workbench), separação clara entre asset (entregável) e recurso da workbench (matéria-prima), princípio de baixo acoplamento (personagens/enquadramentos/câmeras como recursos independentes reusáveis), e ato deliberado de "publicar como asset".

**Próximo passo é refazer o protótipo** refletindo a visão mestra antes de qualquer código de produção.

## Patches pendentes nos scripts da plataforma

Aplicados na VM (`/home/manu/platform/scripts/`) mas **não sincronizados** com o repo `mr-velvet/adorable-devops`:

- `new-app.sh`: aceita flag `--domain` que sobrescreve `${APP_NAME}.did.lu`.
- `deploy.sh`: lê `domain` do `did.json` e propaga via `--domain`.
- `compose-update.py`: regex tolerante a linhas em branco no bloco `environment:`.

Aplicados na VM **e sincronizados** com `adorable-devops` em 2026-05-05 (commit `c539cd6`):

- `deploy.sh` STEP 0: IS_NEW check via mktemp + `grep -Fxq`, sem pipe. Antes `docker compose config --services | grep -qx` sofria de SIGPIPE não-determinístico sob `pipefail` (255), fazendo apps existentes serem detectados como novos.
- `deploy.sh` STEP 0.5 (novo): se `/home/manu/platform/<svc>/` é git repo, faz `fetch + reset --hard` antes do build. Antes o sync de código pra prod dependia de cron em `~/dev/`, mas projetos novos em `~/ved/` ficavam órfãos — deploys reportavam SUCCESS com código velho. Para uma app começar a usar isso: `cd /home/manu/platform/<app> && git init && git remote add origin <repo-url> && git fetch && git reset --hard origin/main`.

Bugs ainda **não corrigidos** nos scripts da VM:

- `kill-app.sh` não suporta `domain` customizado (deixa Caddyfile/DNS órfãos no teardown).
- `new-app.sh` etapa Logto: `INSERT` com `2>/dev/null` engole erro silencioso. Recuperação manual via `/tmp/insert-logto.sh`.

## Referências

- **Visão da ferramenta (referência mestra, com patch v3 antidelírio):** `docs/visao-da-ferramenta.md` — ler **inteiro**, especialmente seção 6.
- **Arquitetura técnica:** `docs/arquitetura-tecnica.md` — espelho técnico da visão. Régua: time interno pequeno, sem cerimônia desnecessária.
- **Módulo personagem (especialização):** `docs/modulo-personagem.md`
- **Protótipo navegável v1** (módulo personagem isolado — preservado como referência histórica): `prototype-v1-personagem/`
- **Protótipo navegável v2** (refeito em 2026-05-04, contexto limpo): `prototype/` — foco na metáfora Galeria/Ateliê, com diferenciação visual deliberada entre os dois espaços (paleta, densidade, header) e transição animada (~500ms) que anuncia o destino. Tudo em vanilla JS + localStorage, sem build.
- Projeto irmão (CLI de geração de vídeo, será absorvido como Fluxo D na workbench): `~/ved/motion-ref-gen/`
- Asset humanoide Mixamo + experimento Three.js base do viewport 3D: `~/ved/random-experiments/skeleton-animation/`
- Spec do `.aseprite`: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
- Deploy guide: `~/dev/claude-preferences/DEPLOY-GUIDE.md`
- Origem da PoC: `~/ved/random-experiments/cga-video-fx/web-aseprite-poc/` (commit `a2cd695`)
- Plano de modularização (histórico): `~/.claude/plans/ent-o-a-gente-tem-tidy-sundae.md`
