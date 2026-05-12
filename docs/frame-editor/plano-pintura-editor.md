# Frames Editor — plano de integração da pintura no editor

Última atualização: 2026-05-12.

Como a engine de pincéis (validada na bancada `prototype/brush-test/`) entra
no editor oficial de tirinhas. Rascunho de plano, ainda em discussão.

Pré-requisitos:
- `visao.md` — onde a pintura encaixa no produto.
- `brushes.md` — arquitetura da engine (`fe_brush_*.js`).
- `brushset-fields.md` — fidelidade ao formato Procreate.
- `modelo-de-dados.md` — entidades `fe_camada`, `fe_celula`.
- `api.md` — endpoints existentes que vamos reusar (`/api/fe/upload-png`, `PATCH /api/fe/celulas/:id`).
- `storage.md` — onde os PNGs vivem.

---

## 1. Princípio

Pintura é **outra ferramenta** ao lado de "prompt", não substitui nem alimenta.
Princípios 9 e 10 da visão da ferramenta:

- Não-babá: ferramenta não infere intenção a partir de uma ação pra
  modificar outra ("se pintou então IA muda comportamento" é proibido).
- IA tira bruto, toque é humano: pintura existe pra **viabilizar o toque
  humano**, não pra alimentar IA nem pra ser substituída por ela. As duas
  vias coexistem como capacidades independentes.

Implicação direta: **pintura escreve pixel na célula da camada selecionada.
IA continua operando sobre o pixel que estiver na célula no momento do
disparo**, sem saber se veio de pintura, upload, ou outra IA. Sem opção
"se já tem pintura aqui, pergunte ao user".

## 2. Onde encaixa na arquitetura existente

### 2.1 Modelo de dados

**Zero mudança no schema.** Pintura escreve em `fe_celula.png_url` igual a
qualquer outra operação. Sem coluna `tipo_camada` em `fe_camada`. O user
cria uma camada chamada "pintura", "linha", "rascunho" — texto livre,
ferramenta não distingue. Continua valendo:

```
fe_celula
  ├ tirinha_id, camada_id, quadro_id  (FK)
  ├ png_url            ← sobrescrito pela pintura no pointerup
  ├ largura, altura
  ├ estado             ← continua `idle`/`processando` (pintura não muda estado)
  └ updated_at
```

### 2.2 Backend

**Zero endpoint novo.** Usa o que `api.md` §6 já define:

1. `POST /api/fe/upload-png` — recebe PNG da célula renderizada, devolve URL.
2. `PATCH /api/fe/celulas/:id` — atualiza `png_url`.

Mesmo fluxo que o parser de `.aseprite` usa na importação e que a IA usa
ao gerar nova versão. Nada novo do lado do servidor.

### 2.3 Frontend — onde o código entra

A engine atual vive em 3 arquivos isolados:

```
public/js/fe_brush_loader.js
public/js/fe_brush_stamp.js
public/js/fe_brush_stroke.js
public/js/fe_brush.js          (fachada — re-exporta)
```

O editor da tirinha vive em `public/js/fe_editor.js` (~2050 linhas). Hoje
ele:

- Renderiza canvas compondo as camadas via `renderCanvas()`.
- Trata pan via `wheel` (`onWheel`, linha ~1473) e zoom.
- **Não captura `pointerdown/move/up`** — canvas é read-only.

A integração precisa adicionar:

1. **Estado de ferramenta ativa** — `move` (default), `brush`, `eraser`.
2. **Listener de pointer events no canvas** quando ferramenta ≠ `move`.
3. **Conversão de coords tela → coords da célula** (já tem `panX/panY/zoom`).
4. **Buffer offscreen da célula da camada ativa** — onde a pintura aterrissa.
5. **Re-render do canvas a cada `pointermove`** mostrando preview do traço em
   tempo real.
6. **Persistência otimista no `pointerup`**.

### 2.4 UI

Adicionar à esquerda do canvas uma **toolbar de ferramenta** estreita:

```
┌─────────────────────────────────────┐
│ ┌──┐                                │
│ │↺ │     <canvas do quadro>         │
│ │  │                                │
│ │✏ │                                │
│ │  │                                │
│ │⌫ │                                │
│ └──┘                                │
│                                     │
│ ┌─ matriz camadas × quadros ──────┐ │
│ └────────────────────────────────┘ │
└─────────────────────────────────────┘

↺ = Mover (pan/zoom, default — comportamento atual)
✏ = Pincel
⌫ = Borracha
```

Quando Pincel ou Borracha ativos, aparece um painel inferior compacto com:

- **Brush atual** (preview + nome) — clique abre seletor de brushes (modal
  com grid igual à bancada).
- **Slider de tamanho** (2-200 px).
- **Cor** — botão custom (não `<input type=color>`) que abre swatches +
  HSL picker custom. Cor única ativa por vez.
- **Cursor de brush** no canvas: círculo fino mostrando tamanho atual.

Toolbar e painel obedecem identidade visual já existente do Frames Editor
(ciano elétrico sobre grafite frio).

---

## 3. Comportamento detalhado

### 3.1 Pré-requisito pra pintar

Pintura precisa de:

1. **Tirinha aberta** (já é o pré-requisito do editor).
2. **Quadro selecionado** (a matriz já mantém esse estado em `activeCelKey`).
3. **Camada selecionada** que receba o traço. Se nenhuma camada está
   selecionada, ao ativar Pincel a UI seleciona automaticamente a camada
   de cima visível (heurística). Se não houver nenhuma camada visível,
   mostra hint "Crie uma camada pra pintar".

### 3.2 Início do traço (`pointerdown`)

1. Pega célula da `(camada_ativa, quadro_ativo)`.
2. Carrega ou cria buffer offscreen da célula (canvas do tamanho da
   tirinha em px lógicos). Se `png_url` da célula existe, decodifica e
   desenha no buffer. Se vazia, fica transparente.
3. Snapshot do buffer pro stack de undo (ver §6).
4. Cria stroke: `createBrushStroke(bufferCtx, brushCarregado, {color, size, erase})`.
5. Converte coords do `pointerdown` de tela → coords da célula (usando
   `panX/panY/zoom` invertido).
6. `stroke.addPoint(x, y, pressure, tiltX, tiltY)`.
7. Re-render do canvas visível (composta camadas, incluindo a célula em
   edição via buffer offscreen no lugar do PNG salvo).

### 3.3 Durante o traço (`pointermove` com botão pressionado)

1. Converte coords.
2. `stroke.addPoint(...)` — aterrissa stamps no buffer.
3. Re-render do canvas visível.

Re-render por `pointermove` direto (sem rAF batching até virar problema).
Se virar lag visível, encaixa rAF batching depois.

### 3.4 Fim do traço (`pointerup`)

1. `stroke.finish()`.
2. Exporta buffer offscreen pra PNG: `canvas.toBlob('image/png')`.
3. **Otimista:** atualiza a célula localmente (UI segue mostrando o resultado
   do buffer). Sync com servidor vai em background.
4. `POST /api/fe/upload-png` com `tirinha_id`, `celula_id`, blob.
5. `PATCH /api/fe/celulas/:id` com `png_url` retornado.
6. Em falha (rede/servidor): mostra toast, reverte ao último estado
   sincronizado (do snapshot anterior — não do undo do user).

Padrão otimista já existe em `fe_editor.js` (ver `setSync`, linha ~81;
operações estruturais como renomear/criar camada já fazem isso).

### 3.5 Trocar de célula com traço pendente

Se o user clica em outra célula da matriz com `pointer` ainda baixo:
descartamos. `pointermove` só é processado se `pointerdown` foi no canvas
e o botão segue pressionado. Mudar a célula ativa via matriz não interrompe
um traço que está acontecendo no canvas — o `pointercapture` mantém o
gesto no canvas até soltar.

### 3.6 Apagar (Borracha)

Mesma engine. `createBrushStroke(..., { erase: true })` aplica
`globalCompositeOperation = 'destination-out'` no `bufferCtx`. Apaga o
pixel pintado e deixa transparência. Sem dúvida sobre "fundo opaco" porque
a célula começa sempre transparente (regra do PNG da célula).

---

## 4. Camadas e composição

### 4.1 Renderização do quadro ativo

Hoje `renderCanvas()` (linha 559 do `fe_editor.js`) compõe as camadas
visíveis ordenadas por `ordem` ASC, desenhando cada PNG no canvas via
`drawImage`.

Mudança proposta: quando há uma célula em edição (ferramenta ativa +
buffer offscreen dela carregado), no momento de compor essa camada
específica usa o buffer em vez do PNG do banco. Resto idêntico.

Pseudocódigo:

```js
for (const camada of camadas_visiveis_ordem_asc) {
  const celula = celulaDe(camada.id, quadroAtivoId);
  if (celula.id === editingCelulaId && editingBuffer) {
    ctx.drawImage(editingBuffer, ...);   // estado live da edição
  } else if (celula.png_url) {
    ctx.drawImage(imgCache(celula.png_url), ...);
  }
}
```

### 4.2 Zoom / pan durante pintura

Pan continua funcionando via `wheel` mesmo com Pincel ativo (não conflita).
Zoom também.

`pointerdown` no canvas com Pincel ativo NÃO inicia pan — só inicia stroke.
O modo "Mover" é necessário pra pan via drag (não tem hoje — adiciona junto
da toolbar).

### 4.3 Export `.aseprite`

A camada pintada é uma `fe_camada` normal com `fe_celula`s normais. O writer
de `.aseprite` já trata isso sem mudança. **Zero trabalho a mais.**

---

## 5. Catálogo de brushes no editor

### 5.1 Mesmo catálogo que a bancada

`public/brushes/` já é o catálogo único, gerado por `scripts/brush-import.js`
a partir de `.brushset` Procreate. O editor lê o mesmo `index.json`. Adicionar
brush novo = importar `.brushset` → `public/brushes/` → catálogo cresce na UI.

### 5.2 Seletor de brush

Modal aberto pelo botão "brush atual" do painel inferior:

- Grid de cards (mesma estrutura da lista da bancada).
- Cada card: thumb invertido + nome.
- Clique seleciona e fecha modal.

Sem categorias por enquanto (20 brushes Sko4 cabem numa coluna). Quando
crescer pra 60+, adicionar busca por nome.

### 5.3 Cor

Cor é estado do **editor**, não do brush. Trocar de brush mantém a cor.
Pode haver presets/swatches favoritos (5-8 swatches custom + 1 picker
"última cor escolhida").

Picker em si: HSL ou HSV custom (não nativo) num popup. Decisão de visual
fica pra rodada de UI.

### 5.4 Tamanho

Idem — estado do editor. Trocar de brush mantém o tamanho. Cada brush
tem `paintSize`/`sizeMin`/`sizeMax` no meta — esses são "preferência do
brush" mas a UI pode ignorar e usar o tamanho que o user escolheu por
último.

---

## 6. Undo

### 6.1 Escopo

Stack in-memory por **célula em edição**. Snapshot do buffer offscreen
antes de cada stroke (incluindo apagar). Limite ~20 snapshots por célula.

**Ao trocar de célula ativa:** descarta stack.
**Ao recarregar página:** descarta stack.

Sem persistência. Não é histórico de revisões — é só "desfazer último
traço enquanto estou aqui". Coerente com o resto do editor (sem histórico
profundo, conforme `visao.md` §6 e §11).

### 6.2 Atalhos

Ctrl/Cmd+Z desfaz. Ctrl/Cmd+Shift+Z refaz (se entrar redo na primeira
rodada; senão, fica só undo).

### 6.3 Persistência otimista vs undo

Undo opera no buffer local. Quando o user faz undo, o buffer volta ao
snapshot — e isso dispara o mesmo fluxo do `pointerup` (upload + PATCH).
**Cada estado válido é uma nova revisão no servidor**, sem histórico
ali — o último escrito é o que existe.

---

## 7. O que NÃO entra na primeira rodada de integração

Pra escopo crescer com clareza, lista do que **fica de fora** da
implementação inicial. Cada um vira rodada própria.

1. **WebGL / OffscreenCanvas / Worker** — engine canvas 2D atende com
   performance aceitável no PC. Migrar antes de virar problema é
   complexidade prematura.
2. **`taperEndLength`** — exige renderizar stroke num offscreen dedicado e
   aplicar máscara no `finish()`. Vai entrar quando aparecer brush que
   dependa muito disso na produção (Sko4 quase não usa).
3. **Build-up controlado (`renderingModulatedTransfer`, `renderingMaxTransfer`)** —
   stroke acumula alpha sem cap. Pra brushes lápis monocromático não é o
   gap mais visível. Entra junto com WebGL quando WebGL entrar.
4. **`renderingRecursiveMixing`, `wetEdgesAmount`, `dynamicsPressureBleed`** —
   features de blending de cor avançado. Só importantes pra brushes
   coloridos com mix. Lápis monocromático Sko4 não usa.
5. **Ferramenta Smudge** — não é pincel, é ferramenta separada. Sko4 traz
   `smudgeSize/Opacity` mas só importam se houver Smudge tool no editor.
6. **Importar `.abr` (Photoshop), `.gbr` (GIMP)** — `brush-import.js` é
   específico pra `.brushset`. Quando aparecer demanda real, adicionar
   parser separado que cospe no mesmo formato `public/brushes/<id>/meta.json`.
7. **Brush maker UI** — criar/editar brush dentro da ferramenta. Artistas
   trazem brushes prontos do mundo Procreate.

---

## 8. Ordem de implementação proposta

Estimativa honesta (cada item supõe que o anterior funciona):

| # | Item | Custo | Bloqueia próximos? |
|---|---|---|---|
| 1 | Adicionar estado `tool: 'move' \| 'brush' \| 'eraser'` + toolbar mínima à esquerda do canvas. Default `move`. | baixo | sim — toolbar é UI base |
| 2 | Capturar pointer events no canvas quando `tool ≠ move`. Converter coords. Mostrar cursor circular. | baixo | sim — sem isso nada pinta |
| 3 | Buffer offscreen da célula ativa. `renderCanvas` usa o buffer em vez do PNG quando há edição em curso. | médio | sim — é o coração da pintura |
| 4 | Plugar `fe_brush.js` no `pointerdown/move/up`. Brush hardcoded (pencil-strokes-6) e cor preta + tamanho 32 fixos. **Pintar funciona.** | médio | não, mas é o smoke test |
| 5 | Painel inferior com seletor de brush (modal com grid) + slider tamanho + 6 swatches de cor fixas. Cursor segue tamanho. | médio | não |
| 6 | Persistência otimista no `pointerup` — upload + PATCH com toast em falha. | baixo | não |
| 7 | Undo local in-memory (stack de snapshots por célula). | médio | não |
| 8 | Color picker custom (HSL/HSV popup). | médio | não — swatches fixas dão pra começar |
| 9 | Atualizar `docs/frame-editor/ui.md` §4-§5 com o estado final. | baixo | não |
| 10 | Smoke test export `.aseprite` com camada pintada (já existia como task #7 — segue válida). | baixo | não |

Decisões a tomar antes de começar #1:

- **Onde fica a toolbar?** Esquerda do canvas (proposta), em cima da matriz
  (alternativa), ou flutuante? Esquerda parece mais natural (Aseprite faz
  assim).
- **Pintura precisa selecionar camada explicitamente?** Heurística (cima
  visível) ou obriga clicar no header da camada antes? Heurística é menos
  babá; clicar antes é mais explícito. Decisão de produto.
- **Painel inferior fica visível sempre que Pincel/Borracha ativo?** Ou tem
  um botão pra mostrar/esconder? Sempre visível é mais simples.

---

## 9. O que este documento não cobre

- Decisões de visual (cores exatas, tipografia, microinterações) — matéria
  de rodada de design.
- Integração com o módulo de cor avançado (HSL/HSV picker custom) — pode
  ser componente que já existe em outra parte do app; verificar antes de
  reimplementar.
- Tablet de input em mobile/touch — Frames Editor é desktop-only por ora
  (princípio da visão da ferramenta).
- Multi-stroke simultâneo (multitouch) — não cabe em Wacom desktop;
  ignorado.
- Otimização de rede pra strokes longos (chunked upload, etc.) — encaixa
  se for medido como problema.
