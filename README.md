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

Ver [PROGRESS.md](./PROGRESS.md) (seção "Estrutura do projeto") pra árvore comentada com responsabilidade de cada arquivo.

## Rodar local

Em desenvolvimento normal, o app roda só na VM `did.lu` — local não é o caminho usual. Se precisar:

- `DATABASE_URL` apontando pra um Postgres acessível.
- O Logto App ID `36iz4iomybe4r1n67a7jc` está hardcoded em `public/js/auth.js`. Funciona local desde que o callback `http://localhost:5031/callback` esteja registrado no Logto (não está por padrão).

```sh
npm install
DATABASE_URL=postgres://... npm start
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

App em produção, com login Google e lista de vídeos. O vídeo carregado no editor ainda só vive no browser — não é salvo em storage. Próximas etapas: upload do vídeo pro GCS, auto-save de edição, share link público. Ver [PROGRESS.md](./PROGRESS.md) pra estado vivo.
