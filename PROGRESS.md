# PROGRESS — roto-master

Última atualização: 2026-05-04 (fatia mínima da v1 implementada localmente; pendente de deploy + smoke test em produção)

## ⚠️ Leitura obrigatória antes de continuar

A visão do produto foi reformulada em 2026-05-03 (patch v2: workbench do usuário, asset 1:1 com vídeo, vinculação só na publicação, fluxos B/C adiados) e **endurecida em 2026-05-04 (patch v3 antidelírio)** após uma tentativa de protótipo v2 ter falhado por violar princípios de UI básicos.

### Ordem de leitura obrigatória — não inverter

1. **`docs/visao-da-ferramenta.md`** — referência mestra. **Ler INTEIRO**, com atenção redobrada à **seção 6** (UI). Subseções críticas: 6.1 (metáfora Ateliê/Galeria), 6.5 (anti-padrões — lista do que NÃO pode aparecer, com exemplos do delírio real), 6.6 (regra de validação).
2. **`docs/arquitetura-tecnica.md`** — espelho técnico da visão. Tabelas, endpoints, storage, jobs assíncronos, fluxo de publicação como transação. Régua: **time interno pequeno** — não inventar cerimônia de produto público.
3. **`docs/modulo-personagem.md`** — especialização do Fluxo D. Anterior à visão mestra; em conflito **vale a visão**.

### Pontos de atenção (cicatrizes de erros reais)

- **2026-05-04:** ao construir o primeiro protótipo v2 (descartado), ignorei a seção de UI e produzi delírio: botão "workbench" repetido no header, dropdown que misturava workbench com suas próprias subseções, "+ novo asset" no projeto (asset não nasce ali), home global sem identidade do conceito. Sintoma de produzir muito de uma vez sem releitura intermediária. Patch v3 da visão nasceu desse erro — seção 6 inteira foi reescrita.
- **Antes de produzir QUALQUER UI** (HTML, mockup, wireframe), passar pelo checklist no fim de `docs/visao-da-ferramenta.md` (seção 12). Se não passar, parar.
- **Não confundir "menu global pra alternar Galeria/Ateliê" com "atalhos contextuais em todo header"**. O menu já é a forma. Repetir é ruído.
- **Asset é cidadão central**, não label técnico. Se entrar na ferramenta e não ver "isto é um asset" como objeto tangível na tela, a UI errou.

A implementação em produção ainda não reflete a visão. **O protótipo navegável v2** (em `prototype/`) foi aprovado em 2026-05-04 como **modelo de referência da UI** para a implementação real — quando descer pra código de produção, espelhar as decisões dele (metáfora Galeria↔Ateliê com diferenciação visual deliberada, transição animada entre espaços, sidebar do Ateliê listando 4 subseções diretamente, asset como objeto tangível, publicação como ato deliberado). O protótipo v1 (módulo personagem isolado) continua **preservado** em `prototype-v1-personagem/` como referência histórica e fonte de reaproveitamento do Fluxo D (estética Atelier 2087, viewport 3D, presets de câmera).

### Modelo de referência (protótipo v2)

Decisões da UI a preservar quando implementar de verdade:

- **Dois espaços, não duas abas.** Galeria (projetos+assets) e Ateliê (workbench do usuário) com paletas distintas — Galeria fria/ink puro, Ateliê quente/cobre — e header que muda de cor entre os dois.
- **Alternador binário no canto direito do header** é a única forma de trocar de espaço. Sem botão "workbench" replicado em cantos contextuais.
- **Transição animada (~500ms)** ao trocar de espaço: overlay full-screen com label do destino + "entrando…". Anuncia a mudança em vez de só pular.
- **Sidebar do Ateliê** lista as 4 subseções (Vídeos, Personagens, Enquadramentos, Câmeras salvas) diretamente, sem item-pai "Workbench". A sidebar *é* a workbench.
- **Detalhe do projeto sem botão "+ novo asset"** — chamada redigida explicando que asset nasce ao publicar.
- **Card de vídeo no Ateliê** mostra dois selos: origem (upload/url/genérico/personagem) e estado de publicação ("publicado em Projeto X" ou "rascunho").
- **Editor com publicação como ritual** — modal próprio com escolha de projeto-destino, aviso explícito de sobrescrita ao republicar, transição animada de volta pra Galeria após confirmar.
- **Breadcrumb persistente no header** mostra o caminho real ("Galeria › Projeto X › Asset Y" ou "Ateliê › Vídeos › nome do vídeo"). Sem botões "voltar" duplicados.
- Reaproveitar a estética **Atelier 2087** (paleta cobre, Fraunces serif itálica, JetBrains Mono).

## Estado atual (em uma frase)

App em produção em **https://roto.did.lu** com login Google. **A v1 da nova visão (galeria + ateliê + ato de publicar + upload pro GCS) está implementada no código (commits `5daffb4`, `431837c`, `e031e17`) mas ainda não foi deployada** — falta rodar `bash /home/manu/platform/scripts/deploy.sh roto-master` na VM pra aplicar as migrations 002–004 e atualizar o container.

## O que já está em produção (antes da fatia v1)

### Editor de rotoscopia (núcleo da PoC)
- File picker / drag-drop carrega qualquer vídeo (`URL.createObjectURL`).
- Dois modos: "vídeo original" (playback nativo) e "rotoscopia" (frames discretos com efeitos WebGL).
- Dual-thumb in/out range pra delimitar trecho.
- Transport único (princípio WYSIWYG): play, scrub e export consomem o mesmo `frames[]`.
- Export `.aseprite` válido com layer `ref` (referência travada esmaecida) + layer `draw` (vazia em cima). Writer JS puro contra spec oficial.
- Presets de efeito (CGA, magenta, amber, scanlines, glitch, etc.).

### Plataforma did.lu
- Container `roto-master` em `:5031`, Caddy serve `roto.did.lu` com HTTPS automático.
- `did.json` declara `port: 5031, domain: "roto.did.lu", database: true, logto: true, migrations: "migrations/"`.
- Postgres compartilhado da plataforma.
- Logto App ID `36iz4iomybe4r1n67a7jc` (Google OAuth), hardcoded em `public/js/auth.js`.
- Multi-user via `req.user.sub` do Logto, tudo escopado.

## O que está implementado no código (fatia v1) — pendente de deploy

### Backend
- Migrations 002–004 escritas (videos com origin/published_asset_id/source_*; projects + project_members; assets 1:1 com videos via UNIQUE).
- `routes/projects.js`: CRUD com membership; criação insere creator como owner em transação.
- `routes/assets.js`: lista escopada por membership, PATCH (rename, status), republicação incrementa version.
- `POST /api/videos/:id/upload`: multipart, sobe pro GCS em `roto-master/videos/<id>/source.<ext>`.
- `POST /api/videos/:id/publish`: primeira publicação como transação atômica (cria asset + atualiza video.published_asset_id).
- `lib/gcs.js`: helper de upload (`@google-cloud/storage`, bucket `didlu-imagestore`, URL via `https://st.did.lu`).
- `middleware/membership.js`: `isMember` / `isOwner`.

### Frontend
- `public/styles.css`: sistema visual do protótipo v2 (Atelier 2087: paleta cobre/ink, Fraunces serif itálica, JetBrains Mono) + estilos do editor reestilizados.
- `public/index.html`: chrome global com alternador Galeria/Ateliê, breadcrumb, transição animada (~500ms) ao trocar de espaço, screens (home / projeto / ateliê / editor) + modais (novo projeto, novo vídeo, publicar, confirmar).
- `chrome.js`: `setSpace` + `setBreadcrumb` + transição animada.
- `modals.js`: sistema centralizado, sem `prompt()`/`confirm()` nativo, ESC fecha, Enter confirma; helpers `confirmModal` e `showToast`.
- `gal_home.js`: lista projetos + criar projeto (modal).
- `gal_project.js`: detalhe do projeto + lista de assets + filtro (todos/pendentes/feitos). Sem botão "+ novo asset" (regra anti-padrão 6.5) — chamada redigida quando vazio.
- `atelie_videos.js`: lista vídeos + criar vídeo (fluxo A; B/C/D com selo "em breve").
- `editor.js`: wrapper do editor. Carrega `gcs_url` se já upado; senão espera file picker e sobe pro storage em background. Modal de publicação com escolha de projeto-destino e aviso de sobrescrita.
- `autosave.js`: debounce 1s + flush no beforeunload, restaura `edit_state` ao reabrir vídeo.
- `router.js`: hash routing (`#/`, `#/p/:id`, `#/atelie`, `#/v/:id`).

## O que NÃO está nesta v1 (fica pra v2)

- Fluxo D inteiro (módulo personagem, viewport 3D, jobs assíncronos, área de Gerações).
- Convite de membros pelo UI (no v1 precisa INSERT manual no DB pra adicionar membros num projeto).
- Fluxos B (URL) e C (geração genérica).
- Share link público via `share_id`.
- Migrations 005–009 (personagens, enquadramentos, câmeras, jobs, models) escritas mas não aplicadas no deploy ainda.

## Próximos passos

### Imediato — deployar e testar a v1

1. **Deploy na VM:** `bash /home/manu/platform/scripts/deploy.sh roto-master`. Aplica migrations 002–004 automaticamente. Smoke test no `https://roto.did.lu`:
   - Login Google
   - Criar projeto na Galeria
   - Trocar pra Ateliê → Vídeos, criar vídeo, abrir editor
   - Carregar arquivo de vídeo (deve subir pro GCS em background)
   - Editar trecho, mudar pra rotoscopia, dar play (constrói frames)
   - Publicar como asset → escolher projeto → confirmar → ver transição pra Galeria → asset aparece no projeto
   - Recarregar a página → asset persiste, vídeo carrega do GCS, edit_state restaurado
2. Se algum bug aparecer, corrigir antes de v2.

### v2 — depois da v1 estar de pé

1. **Convite de membros pelo UI** — `POST /api/projects/:id/members` por email, listagem na tela de detalhe do projeto.
2. **Worker + tela de Gerações** — `worker.js` consome `jobs WHERE status='queued'` com `FOR UPDATE SKIP LOCKED`. Subseção "Gerações" no Ateliê com lista cronológica + retry. Indicador no header global. Aplicar migrations 008 + 009.
3. **Fluxo D (módulo personagem)** — viewport 3D reaproveitando `prototype-v1-personagem/`, etapas aparência → enquadramento → movimento. Aplicar migrations 005 + 006 + 007.
4. **Fluxos B/C** — vídeo de URL e geração genérica.
5. **Share link público.** Rota `GET /api/share/:share_id` retorna metadata + URL do `.aseprite`.

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
