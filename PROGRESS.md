# PROGRESS — roto-master

Última atualização: 2026-05-04 (arquitetura técnica fechada e migrations 002–009 escritas; pronto pra começar implementação)

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

App em produção em **https://roto.did.lu** com login Google (Logto), lista de vídeos como home, criação de novo vídeo via modal, abertura do editor por rota `#/v/:id`. Editor ainda não faz upload do vídeo pra storage — o arquivo só vive no browser via `URL.createObjectURL`. **Estrutura atual ainda não tem conceito de Projeto, Asset (no sentido novo) ou Workbench** — esses conceitos vêm da nova visão e ainda não existem em código.

## O que já funciona

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
- Postgres compartilhado da plataforma (tabela `videos` no schema do app).
- Logto App ID `36iz4iomybe4r1n67a7jc` (Google OAuth), hardcoded em `public/js/auth.js`.

### Multi-user
- `requireUser` middleware valida token Logto via `/oidc/me` (token opaco, não JWT).
- Toda rota `/api/videos` é escopada por `owner_sub`.
- Sem whitelist — qualquer Google login entra. Usuário só vê os próprios vídeos.

### Lista + criação + navegação
- Home (`#/list`) renderiza grid de vídeos do user logado.
- Botão "+ novo vídeo" abre modal custom (regra UI: nada de `prompt()` nativo) → POST cria registro com `name` (`gcs_path`/`gcs_url` vazios) → navega pra `#/v/:id`.
- Editor (`#/v/:id`) carrega metadata, mostra nome no header, botão "‹ voltar" retorna pra lista.
- Delete via modal de confirmação custom.

## O que NÃO funciona ainda

- **Upload pro GCS:** o vídeo carregado no editor existe só no browser via `URL.createObjectURL`. Não é salvo em storage. Recarregou a página → perdeu o vídeo.
- **Auto-save de edição:** PARAMS, in/out, fps, scale, preset não são persistidos. `edit_state` (JSONB) tá no schema mas vazio.
- **Restaurar estado ao reabrir vídeo:** consequência do anterior — abre sempre vazio.
- **Share link público via `share_id`:** schema tem o campo, rota não existe ainda.

## Próximos passos (próxima sessão)

**Visão fechada + protótipo v2 aprovado + arquitetura técnica escrita + migrations 002–009 prontas.** Próxima etapa é descer pra implementação real, começando pelo backend (rodar migrations + endpoints) e UI espelhando o protótipo.

### Em ordem de prioridade

1. **Rodar migrations 002–009 no Postgres da plataforma.** Ordem alfabética automática no deploy. Confirmar que os ALTER TABLE em `videos` rodam limpos sobre dados existentes.
2. **Implementar endpoints da workbench e galeria** conforme `docs/arquitetura-tecnica.md` seção 4. Ordem: `projects` + `project_members` (visão central), `assets` (com fluxo de publicação como transação atômica), depois `personagens` + variações + `cameras_salvas`, depois `jobs` + worker + `models`.
3. **Upload do vídeo pro GCS.** `POST /api/videos/:id/upload` multipart, valida ≤100MB, sobe pra `roto-master/videos/<video_id>/source.<ext>` (URL via `https://st.did.lu/...`). Atualiza `gcs_url`/`size_bytes`/`width`/`height`/`duration_s`. No editor, ao detectar `v.gcs_url`, atribui `vid.src = v.gcs_url` e dispara o fluxo de "vídeo carregado" sem precisar do file picker.
4. **Implementar a UI espelhando `prototype/`** — chrome global com alternador Galeria/Ateliê, transição animada entre espaços, sidebar do Ateliê com 5 subseções (Vídeos, Personagens, Enquadramentos, Câmeras, Gerações), telas Home/Projeto/Editor com a estética Atelier 2087.
5. **Ato de publicar** — modal de publicação (escolha de projeto-destino, aviso de sobrescrita ao republicar), gera `.aseprite`, sobe pro GCS, cria `asset` no projeto, vincula `video.published_asset_id`. Após confirmar, transiciona pra Galeria → Detalhe do projeto.
6. **Auto-save de `edit_state`.** Debounce 1s + flush no `beforeunload`. Inclui PARAMS, in/out, fps, scale, preset selecionado. Restaurar ao reabrir vídeo.
7. **Worker + tela de Gerações** — `worker.js` no mesmo container consome `jobs WHERE status='queued'` com `FOR UPDATE SKIP LOCKED`. Tela "Ateliê → Gerações" lista jobs do usuário com retry pra falhas. Indicador de jobs ativos no header global.
8. **Fluxo D (módulo personagem)** — implementar conforme `docs/modulo-personagem.md`, reaproveitando viewport 3D + presets de câmera de `prototype-v1-personagem/`. Vídeos gerados aparecem em Ateliê → Vídeos com selo de origem "personagem".
9. **Convite de membros** — `POST /api/projects/:id/members` por email, lookup no Logto, listagem na tela de detalhe do projeto.
10. **Share link público.** Rota `GET /api/share/:share_id` (sem auth) retorna metadata + URL do `.aseprite` do asset publicado.

## Estrutura do projeto

```
server.js                  Express + /api/health + monta /api/config e /api/videos
package.json               express, pg
Dockerfile                 node:20-alpine, EXPOSE 5031
did.json                   manifest da plataforma (logto+db+domain)
migrations/
  001_videos.sql                       tabela videos (id, owner_sub, name, gcs_*, edit_state, share_id, ...)
  002_videos_workbench_columns.sql     ALTER videos: origin, published_asset_id, source_*
  003_projects.sql                     projects + project_members (compartilhados)
  004_assets.sql                       assets + UNIQUE(video_id) + FK videos.published_asset_id
  005_personagens.sql                  personagens + aparencias + enquadramentos + movimentos
  006_enquadramentos_avulsos.sql       enquadramentos reusáveis sem personagem
  007_cameras_salvas.sql               presets de câmera do usuário
  008_jobs.sql                         jobs assíncronos + índice pro worker (FOR UPDATE SKIP LOCKED)
  009_models.sql                       catálogo de modelos + seed (nano-banana-pro, kling, hailuo)
middleware/
  auth.js                  requireUser — valida token Logto via /oidc/me, popula req.user
routes/
  config.js                GET /api/config — devolve identidade do user logado
  videos.js                GET/POST/PATCH/DELETE /api/videos[/:id], escopado por owner_sub
public/
  index.html               shell + CSS + login screen + lista + modais + editor
  logto-auth.js            wrapper do SDK Logto
  js/
    main.js                bootstrap: auth → router → list/editor (bootEditorOnce guarda)
    auth.js                initAuth, signIn, signOut, getUser, authedFetch
    router.js              hash routing #/list e #/v/:id
    videos_api.js          listVideos, createVideo, getVideo, patchVideo, deleteVideo
    video_list.js          renderiza grid + modal "novo vídeo" + modal confirm delete
    file_loader.js         file picker + drag-drop no editor
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
