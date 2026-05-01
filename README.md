# roto-master

Ferramenta web de rotoscopia: vídeo → `.aseprite` pronto pra desenhar por cima.

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
- **Stack maduro, sem build**: vanilla ES modules + importmap + CDN. Sem bundler. WebGL puro.

## Stack

- HTML/CSS + JavaScript ES modules nativos (sem build step)
- WebGL pra render dos efeitos
- [pako](https://github.com/nodeca/pako) (zlib) pra deflate dos cels do `.aseprite`
- Writer `.aseprite` em JS puro (validado contra a [spec oficial](https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md))

## Estrutura

```
server.js           # Express estático + /api/health (deploy did.lu)
package.json        # express
Dockerfile          # node:20-alpine
did.json            # manifest da plataforma did.lu
public/
  index.html        # shell + CSS + entry point
  js/
    main.js         # init em ordem
    state.js        # PARAMS, PRESETS, SLIDERS, STATE
    shaders.js      # VS_SRC, FS_SRC do efeito
    gl.js           # bootstrap WebGL + render path + plain shader + pixel IO
    capture.js      # seek/await + resample + overlay + buildTimeline + paint
    aseprite.js     # ByteWriter + buildAseprite (formato binário)
    playback.js     # source/rotoscope loops + setMode
    ui.js           # DOM refs + handlers + export
    file_loader.js  # file picker + drag-drop de vídeo
```

## Rodar local

```sh
npm install
npm start
# ou só servir o estático:
python -m http.server 4783 -d public
```

Abrir `http://localhost:5021/` (ou 4783).

## Status

PoC funcional. Modo source toca o vídeo, modo rotoscopia constrói N frames discretos com efeito aplicado, exporta `.aseprite` válido. Ver [PROGRESS.md](./PROGRESS.md) pra estado vivo e próximos passos.

## Deploy

Próximo passo: subir em `https://roto.did.lu` via plataforma `did.lu` (VM GCP + Docker Compose). Ver `~/dev/claude-preferences/DEPLOY-GUIDE.md`.
