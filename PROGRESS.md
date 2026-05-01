# PROGRESS — roto-master

Última atualização: 2026-04-30 (extraída de `random-experiments/cga-video-fx/web-aseprite-poc/` modularizada e funcional, pronta pra Fase 3 — file picker, deploy `roto.did.lu`, color mode Indexed).

## status atual

PoC funcional e modular. Roda local em `http://localhost:4783/`. Captura `video.mp4` fixo + efeitos CRT/glitch/scanlines/etc, exporta `.aseprite` válido (abre no Aseprite com layer `ref` locked-reference + layer `draw` editável + FPS correto).

## como chegamos aqui (timeline)

### Fase 0 (no repo `random-experiments`) — exploração
- `cga-video-fx/web/` — lab WebGL de efeitos em vídeo (legado).
- `cga-video-fx/web-aseprite-poc/` — PoC focada em provar `.aseprite` válido.

### Fase 1 (random-experiments commit `64b1e8d`, 2026-04-30) — v1 funcional
- Writer `.aseprite` em JS puro (~150 linhas) escrito do zero — não existe lib pública pra escrever, só ler. Header 128 bytes + Color Profile chunk + Layer chunks + Cel chunks com pixel RGBA via `pako` deflate.
- Captura via `vid.currentTime = X` + `await seeked` + `requestVideoFrameCallback` (com timeout fallback).
- **Bug "frames idênticos"** resolvido: `seeked` dispara antes da superfície de vídeo ter o frame novo. Fix: `Promise.race([rVFC, setTimeout(80ms)])`.
- Caminho técnico validado.

### Fase 2 (random-experiments commit `1fded22`, 2026-04-30) — v2 quebrada
Tentativa de empilhar 3 features ao mesmo tempo num monolito de 1463 linhas:
- Princípio WYSIWYG (transport único frame-a-frame)
- Dois modos: vídeo original / rotoscopia
- Dual-thumb slider in/out

Ficou quebrada com 3 bugs e sensação de "gambiarra amarrada". Pausada com contexto degradado.

### Fase 2.5 (random-experiments commit `a2cd695`, 2026-04-30) — modularização + bug fixes
**Modularização behavior-preserving** primeiro: monolito de 1463 linhas → 8 módulos ES sob `js/` (state, shaders, aseprite, gl, capture, playback, ui, main). Comportamento idêntico, só reorganizado. Plano em `~/.claude/plans/ent-o-a-gente-tem-tidy-sundae.md`.

**Os 3 bugs corrigidos**, na ordem:

1. **Modo source não iniciava (canvas preto, vídeo não tocava).**
   - Causa: `setMode('source')` chamado no boot disparava o early return `if (STATE.mode === mode) return` (default já era 'source'). Loop nunca arrancava.
   - Fix: separei `applyMode(mode)` (idempotente, sempre executa branch) de `setMode(mode)` (público, no-op se igual). Boot chama `bootMode('source')` em `main.js`.
   - Arquivos: `js/playback.js`, `js/main.js`.

2. **Y-flip em rotoscope (vídeo aparecia de cabeça pra baixo).**
   - Diagnóstico: criei `test-orientation.html` (descartável, removido). Cantos coloridos + letra F + amostragem automática de pixels nos 4 cantos. Comparei A=referência canvas 2D, B=`UNPACK_FLIP_Y_WEBGL=false`, C=`UNPACK_FLIP_Y_WEBGL=true`, D=após `flipYRGBA`. Marcadores empíricos confirmaram: **`<video>` em `texImage2D` precisa de `UNPACK_FLIP_Y_WEBGL=true`** (canvas 2D não precisa — comportamento browser-specific).
   - Fix: adicionado `gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)` antes do `texImage2D(... vid)` em `renderShaderFrame`, resetado pra false depois. Mesmo padrão que o source loop já fazia.
   - Arquivos: `js/gl.js`.
   - **Lição registrada (memory):** após 2 tentativas que falham num bug visual, construir teste mínimo isolado com evidência antes da 3ª. Aplicado.

3. **Dual-range trava em frequência alta.**
   - Causas, três:
     a. `max`/`step` setados em todo input event → forçava reflow do range.
     b. `.value` reescrito no slider que disparou o evento → cancela drag em alguns browsers.
     c. `clientWidth` lido em layout sync → thrash.
   - Fix:
     a. Movido pra `initRangeUI()` (chamado uma vez no boot).
     b. `refreshRangeUI(originSlider)` — pula o write no slider de origem.
     c. Substituído por `calc(6px + (100% - 12px) * frac)` em CSS (browser resolve, sem JS reading).
   - Arquivos: `js/ui.js`, `js/main.js`.

**Bonus:** `<video loop>` nativo (vídeos curtos repetem sozinho enquanto user ajusta efeitos).

### Fase 3 (este repo, a partir de agora)
Promovido pra repo dedicado `~/ved/roto-master/`. Próximos passos abaixo.

## arquitetura (estado atual)

### Estrutura de módulos

```
state.js   shaders.js   aseprite.js (leaf, só pako global)
   |          |              |
   +----+-----+              |
        v                    |
      gl.js                  |
        |                    |
        +────► capture.js    |
        |          |         |
        +─────► playback.js  |
                   |         |
                   +───► ui.js
                          |
                          +───► main.js
```

| Arquivo | Responsabilidade | LOC aprox |
|---|---|---|
| `state.js` | `PARAMS`, `PRESETS`, `SLIDERS`, `STATE` | ~57 |
| `shaders.js` | `VS_SRC`, `FS_SRC` como template literals | ~87 |
| `gl.js` | Bootstrap WebGL + render path + plain shader + pixel IO | ~185 |
| `capture.js` | seek/await + resample + overlay + `buildTimeline` + `paintFrameToCanvas` | ~196 |
| `aseprite.js` | `ByteWriter` + `buildAseprite` (auto-contido, depende só de `pako`) | ~122 |
| `playback.js` | source/rotoscope loops + `setMode`. UI deps via `bindUI()` | ~155 |
| `ui.js` | DOM refs + setProgress + `init/refreshRangeUI` + `updateInfo` + `markDirty` + `buildUI`/`applyPreset` + `wireHandlers` + export | ~218 |
| `main.js` | entry: buildUI → bindPlaybackUI → wireHandlers → onMetadataReady | ~46 |
| `index.html` | shell HTML/CSS + `<script type="module" src="./js/main.js">` | ~462 |

### Princípios arquiteturais já estabelecidos (não revisitar sem motivo)

- **Sem build step.** Vanilla ES modules + CDN.
- **Live bindings preservados:** `prevTex`/`fbTex`/`plainProg`/`plainTex` são `let` exportados; consumers que precisam do valor corrente (após swap de feedback) acessam via `import * as glmod`.
- **Dependency injection no playback** (não circular): `playback.js` recebe `setProgress`/`updateInfo`/refs DOM via `bindUI()`. Evita import circular com `ui.js`.
- **Writer `.aseprite` em JS puro**, validado. Não tentar usar lib (não existem libs de write).
- **Captura determinística** com `Promise.race([rVFC, setTimeout(80ms)])`. Não voltar a `await seeked` direto.

### Y-flip — onde estão os flips e por quê

| Lugar | Flip | Razão |
|---|---|---|
| `gl.js` `renderShaderFrame` antes de `texImage2D(... vid)` | `UNPACK_FLIP_Y_WEBGL=true` | `<video>` em `texImage2D` entra invertido vs canvas 2D. Bug fixed em 2026-04-30. |
| `shaders.js` VS_SRC | `v_uv.y = 1.0 - v_uv.y` | Mantém o resto do pipeline em `<video>` correto (junto com o flip acima). |
| `gl.js` `uploadAndDrawTexture` | sem flip | Buffer chega bottom-up (linha 0 = base visual); plain shader sample correto sem flip. |
| `playback.js` `startSourceLoop` antes de `texImage2D(... vid)` | `UNPACK_FLIP_Y_WEBGL=true` | Mesmo motivo do `renderShaderFrame`. |
| `ui.js` export antes de `buildAseprite` | `flipYRGBA` | Aseprite quer top-down; buffer está bottom-up. |

## próximos passos (Fase 3)

### 🔴 prioritário

1. **Deploy em `roto.did.lu`** (plataforma `did.lu` GCP + Docker + Caddy). Ler `~/dev/claude-preferences/DEPLOY-GUIDE.md` antes. Estático servido via Express/static dentro do container do app.
2. **File picker / drag-drop** de qualquer vídeo. Substituir `<video src="video.mp4">` fixo por `URL.createObjectURL(file)`. Limpar URL ao trocar arquivo.
3. **UI dedicada** — atualmente herda layout do "lab de efeitos" (CGA-vibe pink/green/orange). Repensar pra produto rotoscopia (timeline com scrub, área pra arrasto de arquivo, presets nomeáveis).

### 🟡 evolução

4. **Color mode Indexed** no `.aseprite`:
   - Header `color depth = 8`
   - Palette chunk (`0x2019`) — entries RGBA, índice 0 = transparente
   - Cel data: array de índices em vez de RGBA
   - Quantização: o efeito do shader já gera paleta limitada (presets CGA, magenta, amber); coletar cores únicas após shader e mapear pra índices.
   - Como definir paleta: fixa pelo preset / extraída do vídeo após shader / customizável.

5. **Persistência de presets** via `localStorage`. Salvar PARAMS atual + nome do preset.

6. **Onion skin pré-configurado** no `.aseprite` exportado (atributo do arquivo).

7. **Tags de animação** no Aseprite (marcar trechos do vídeo).

### 🟢 nice-to-have

8. Streaming do `.aseprite` writer (escrever frame a frame em chunks) pra vídeos longos. Atualmente acumula tudo em RAM — 30s @ 12fps em 640×360 = ~330MB.
9. Warning explícito de limite de memória/resolução acima de N MB.
10. Substituir dual-range caseiro por lib pronta (ex: `noUiSlider`) se UX continuar desconfortável.

## decisões em aberto

- **Indexed mode**: quem define a paleta? Fixa pelo preset, extraída do vídeo, ou customizável pelo usuário?
- **Subdomínio do deploy**: `roto.did.lu` (escolhido) ou outro nome?
- **Evolução do video.mp4 demo**: manter ou tirar do repo (~3.3MB)? Recomendação: tirar e adicionar instrução no README pra usar arquivo próprio.

## referências

- Spec do `.aseprite`: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
- Docs Aseprite: https://www.aseprite.org/docs/files/
- Plano de modularização (histórico): `~/.claude/plans/ent-o-a-gente-tem-tidy-sundae.md`
- Origem da PoC: `~/ved/random-experiments/cga-video-fx/web-aseprite-poc/` (commit `a2cd695`)
- Proposta original (histórico): `~/ved/random-experiments/cga-video-fx/ROTOSCOPE-TOOL-PROPOSAL.md`
