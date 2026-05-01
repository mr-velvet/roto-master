# roto-master

Ferramenta web de rotoscopia: vídeo → `.aseprite` pronto pra desenhar por cima.

**Em produção:** https://roto.did.lu (login Google via Logto, multi-user).

## Por que existe

O fluxo padrão de rotoscopia em cima de vídeo é repetitivo: rodar vídeo num lugar, exportar PNGs frame-a-frame, importar no Aseprite, configurar FPS, criar layers, travar referência. A cada projeto novo, repete tudo.

Esta ferramenta colapsa isso em **arrastar vídeo → ajustar efeito → exportar `.aseprite`**.

O arquivo exportado abre no Aseprite com:
- N frames na timeline com FPS correto
- Layer `ref` na base, **travada como Reference Layer** (esmaecida, não-exportável)
- Layer `draw` vazia em cima, pronta pra rotoscopar

## Princípios

- **Estética é decisão do usuário**, não da ferramenta. Vídeo limpo, paleta CGA, glitch/scanlines, qualquer combinação dos efeitos disponíveis — é opção, não default.
- **WYSIWYG total**: o que toca no preview frame-a-frame é o que vai pro `.aseprite`. Sem "fps de preview" diferente do "fps de captura".
- **Stack maduro, sem build**: vanilla ES modules + CDN no frontend. Sem bundler. WebGL puro.

## Stack

- Backend: Express 4 + node-postgres (Postgres compartilhado da plataforma `did.lu`)
- Auth: Logto (`auth.did.lu`) — Google OAuth
- Frontend: HTML/CSS + JavaScript ES modules nativos (sem build step)
- WebGL pra render dos efeitos
- [pako](https://github.com/nodeca/pako) (zlib) pra deflate dos cels do `.aseprite`
- Writer `.aseprite` em JS puro (validado contra a [spec oficial](https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md))

## Estrutura

```
server.js              # Express + /api/health + rotas
package.json           # express, pg
Dockerfile             # node:20-alpine
did.json               # manifest da plataforma did.lu (logto+db+domain customizado)
migrations/
  001_videos.sql       # tabela videos
middleware/
  auth.js              # requireUser (valida token Logto via /oidc/me)
routes/
  config.js            # GET /api/config — identidade do user logado
  videos.js            # GET/POST/PATCH/DELETE /api/videos
public/
  index.html           # shell + CSS + login screen + lista + modais
  logto-auth.js        # SDK wrapper Logto
  js/
    main.js            # bootstrap: auth → router → list/editor
    auth.js            # initAuth, signIn, signOut, authedFetch
    router.js          # hash routing #/list e #/v/:id
    videos_api.js      # cliente da API /api/videos
    video_list.js      # tela de lista + modal "novo vídeo"
    file_loader.js     # file picker + drag-drop (no editor)
    state.js           # PARAMS, PRESETS, SLIDERS, STATE
    shaders.js         # VS_SRC, FS_SRC
    gl.js              # WebGL boot + render + pixel IO
    capture.js         # seek/await + resample + overlay + buildTimeline
    aseprite.js        # ByteWriter + buildAseprite
    playback.js        # source/rotoscope loops
    ui.js              # DOM refs + handlers + export
```

## Rodar local

Precisa ter um Postgres acessível em `DATABASE_URL` e um Logto App ID válido em `public/js/auth.js` (constante `LOGTO_APP_ID`).

```sh
npm install
DATABASE_URL=postgres://... LOGTO_APP_ID=... npm start
```

Abrir `http://localhost:5031/`.

## Deploy

Plataforma `did.lu` na VM `adorable-claude` (GCP). `did.json` declara `database: true, logto: true, domain: "roto.did.lu"`. Deploy via:

```sh
# (na VM)
bash /home/manu/platform/scripts/deploy.sh roto-master
```

Detalhes em [PROGRESS.md](./PROGRESS.md) e [`~/dev/claude-preferences/DEPLOY-GUIDE.md`].

## Status

App em produção, com login Google e lista de vídeos. Próximas etapas: upload do vídeo pro GCS, auto-save de edição, share link público. Ver [PROGRESS.md](./PROGRESS.md) pra estado vivo.
