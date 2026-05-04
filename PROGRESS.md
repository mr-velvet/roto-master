# PROGRESS — roto-master

Última atualização: 2026-05-03 (sessão da tarde — patch v2 da visão)

## ⚠️ Leitura obrigatória antes de continuar

A visão do produto foi reformulada profundamente em 2026-05-03 e recebeu **patch v2** na mesma data (workbench do usuário, asset 1:1 com vídeo, vinculação a projeto só na publicação, fluxos B/C adiados). **Antes de qualquer trabalho técnico, ler:**

1. **`docs/visao-da-ferramenta.md`** — referência mestra (com patch v2 no topo). Define o que a ferramenta é, entidades, fluxos A–D, princípios e decisões fechadas.
2. **`docs/modulo-personagem.md`** — especialização: detalha o Fluxo D. **Atenção:** este doc foi escrito antes da visão geral; em conflito vale a visão.

A implementação atual (descrita abaixo) ainda não reflete a nova visão. Próximo passo de produto: **produzir protótipo navegável v2** em `prototype/` refletindo a visão mestra. O protótipo v1 (módulo personagem isolado) foi **preservado** em `prototype-v1-personagem/` como referência histórica e fonte de reaproveitamento (estética Atelier 2087, viewport 3D, presets de câmera).

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

**Antes de qualquer código novo:** validar a visão da ferramenta com protótipo navegável atualizado.

### Em ordem de prioridade

0. **Refazer protótipo `prototype/`** refletindo `docs/visao-da-ferramenta.md`:
   - Home global = lista de projetos do usuário.
   - Dentro do projeto: Assets como entrada principal (com filtros por estágio: a fazer / em andamento / feito); Workbench acessada via menu.
   - Workbench com subseções independentes (Vídeos, Personagens, Enquadramentos, Câmeras salvas) — sem acoplamento forçado.
   - Ação destacada "+ Criar vídeo" com escolha de fluxo (A: upload, B: URL, C: genérico, D: caminho personagem).
   - Fluxo D ainda detalhado conforme `modulo-personagem.md`, mas com personagens/enquadramentos sendo recursos independentes da workbench (não filhos do personagem).
   - Banner "MODO PROTÓTIPO — sem chamadas reais à IA, dados em localStorage" no topo.
1. **Upload do vídeo pro GCS.** `PATCH /api/videos/:id` multipart, valida ≤100MB, sobe pra `gs://didlu-imagestore/roto-master/videos/<uuid>.<ext>` (URL via `https://st.did.lu/...`). Atualiza `gcs_url`/`size_bytes`/`width`/`height`/`duration_s`. No editor, ao detectar `v.gcs_url` em `showEditor()`, atribui `vid.src = v.gcs_url` e dispara o fluxo de "vídeo carregado" sem precisar do file picker.
2. **Auto-save de `edit_state`.** Debounce 1s + flush no `beforeunload`. Inclui PARAMS, in/out, fps, scale, preset selecionado.
3. **Restaurar `edit_state` ao abrir vídeo.** Aplicar antes do primeiro render.
4. **Share link público.** Rota `GET /api/share/:share_id` (sem auth) retorna metadata + URL do vídeo. Frontend tem rota `#/s/:share_id` que abre versão read-only.

Os passos 1–4 acima vinham da sessão anterior e ainda fazem sentido tecnicamente, mas devem ser revisitados após a nova visão — provavelmente o schema vai precisar ganhar `projects`, `assets`, e o `videos` atual vira recurso da workbench.

## Estrutura do projeto

```
server.js                  Express + /api/health + monta /api/config e /api/videos
package.json               express, pg
Dockerfile                 node:20-alpine, EXPOSE 5031
did.json                   manifest da plataforma (logto+db+domain)
migrations/
  001_videos.sql           tabela videos (id, owner_sub, name, gcs_*, edit_state, share_id, ...)
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

- **Visão da ferramenta (referência mestra, com patch v2):** `docs/visao-da-ferramenta.md`
- **Módulo personagem (especialização):** `docs/modulo-personagem.md`
- **Protótipo navegável v1** (módulo personagem isolado — preservado como referência histórica): `prototype-v1-personagem/`
- **Protótipo navegável v2** (a ser produzido refletindo a visão mestra): `prototype/`
- Projeto irmão (CLI de geração de vídeo, será absorvido como Fluxo D na workbench): `~/ved/motion-ref-gen/`
- Asset humanoide Mixamo + experimento Three.js base do viewport 3D: `~/ved/random-experiments/skeleton-animation/`
- Spec do `.aseprite`: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
- Deploy guide: `~/dev/claude-preferences/DEPLOY-GUIDE.md`
- Origem da PoC: `~/ved/random-experiments/cga-video-fx/web-aseprite-poc/` (commit `a2cd695`)
- Plano de modularização (histórico): `~/.claude/plans/ent-o-a-gente-tem-tidy-sundae.md`
