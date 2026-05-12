# Frames Editor — pincéis (brushes)

Última atualização: 2026-05-12 (reescrito do zero após o experimento da página de
calibração — versão anterior planejava gaps que foram parcialmente implementados
e interpretava `shapeRotation` errado).

Documenta a engine de pincéis: arquitetura, formato de brush, o que está
implementado, o que está aproximado, o que falta. Para semântica detalhada
de cada campo do `.brushset` Procreate, ver `brushset-fields.md`.

Pré-requisitos: `visao.md`, `ui.md`.

---

## 1. Princípio

Pincéis existem pra **viabilizar o toque humano** sobre quadros (princípio 10
de `docs/visao-da-ferramenta.md`). Não substituem IA, não competem com ela,
não são input pra ela. São capacidade independente.

O alvo qualitativo é **ficar o mais perto possível do Procreate** dentro das
limitações do navegador, usando todos os recursos disponíveis. Quando algo só
faz sentido com GPU, usar GPU é caminho válido (não foi necessário até agora —
canvas 2D atende com performance aceitável pra Wacom em PC desktop).

**Princípio durável da implementação:** ler tudo do arquivo `.brushset` e
expor o que não consumimos como sinal explícito (`__notImplemented`). Inventar
comportamento — interpretar um campo do arquivo de um jeito que não é
documentado — é falha. Pré-fere marcar "desconhecido" a "chutei algo
plausível".

---

## 2. Arquitetura

### 2.1 Bancada de calibração

Página standalone em `public/brush-test.html` + `prototype/brush-test/`
(versão pra GCS). Não é editor — é instrumento de validação. A bancada
mostra cada brush com:

- Preview do thumb original do Procreate.
- Canvas branco grande pra desenhar.
- Slider de tamanho, swatches de cor, toggle Borracha.
- Painel direito: pointerType + pressure + tilt ao vivo.
- Lista **"Não implementado (N)"** com os campos do brush que nossa engine ignora.
- JSON dos params consumidos.

Toda evolução da engine é validada aqui antes de ir pro editor.

Deploy: `https://st.did.lu/brush-test/v<N>/index.html` (versão atual = v7).
Cache TTL 1h — sempre subir versão nova quando mudar pra forçar reload.

### 2.2 Engine em runtime

Três módulos pequenos em `public/js/`:

| Arquivo | Responsabilidade |
|---|---|
| `fe_brush_loader.js` | `loadBrush(baseUrl)`: baixa `meta.json`, prepara canvas do tip (luminância → alpha) e do grain. |
| `fe_brush_stamp.js` | Render de um stamp único (tip-colorido + grain por multiply, recortado pelo alpha do tip). |
| `fe_brush_stroke.js` | `createBrushStroke(ctx, brush, opts)`: interpolação de pontos espaçados, modulações (pressão, tilt, jitter, falloff, taper). |
| `fe_brush.js` | Fachada — re-exporta `loadBrush` e `createBrushStroke`. |

API mínima:

```js
import { loadBrush, createBrushStroke } from '/js/fe_brush.js';

const brush = await loadBrush('/brushes/pencil-strokes-6');
const stroke = createBrushStroke(ctx, brush, { color: '#000', size: 32, erase: false });
stroke.addPoint(x, y, pressure, tiltX, tiltY);
// ... mais addPoint ao longo do gesto
stroke.finish();
```

`ctx` é `CanvasRenderingContext2D` (visível ou offscreen). Coords em px do
espaço do ctx. Sem zoom embutido — quem chama converte.

### 2.3 Pipeline de import

`scripts/brush-import.js` (Node) consome `.brushset` Procreate (ZIP com
NSKeyedArchiver bplist por brush + `Shape.png` + `Grain.png` + `Thumbnail.png`).

Gera em `public/brushes/`:

```
public/brushes/
  index.json                  # [{id, name, dir, thumb}]
  shared/grain-<hash>.png     # grain compartilhado entre brushes (dedup sha1)
  <id>/
    tip.png                   # PNG grayscale (branco=opaco, preto=transparente)
    thumb.png                 # preview do traço (PNG RGBA, fundo transparente)
    meta.json                 # schema próprio + debug
```

O `meta.json` tem três seções:

```json
{
  "name": "Pencil Strokes 6",
  "tip": "tip.png",
  "spacing": 0.1508,
  "...": "...",                // params canônicos consumidos pela engine
  "__implemented": ["plotSpacing", "minSize", "..."],
  "__notImplemented": [
    { "field": "dynamicsPressureBleed", "value": 0.0017 }
  ],
  "__source": {
    "plotSpacing": 0.15077,
    "...": "..."                // TODOS os 192 campos crus do bplist, com nomes Procreate
  }
}
```

Defaults pra decidir o que vai em `__notImplemented` vêm de dois lugares:

1. `scripts/brush-defaults-sko4.json` — observação: 148 campos que têm o mesmo
   valor em todos os 20 brushes do pacote Sko4 (provável default real do app).
2. `SEMANTIC_DEFAULTS` hardcoded no `brush-import.js` — defaults óbvios pra
   campos que variam ("0 = inativo"). Reduz ruído.

`NOISE_FIELDS` filtra metadados (creationDate, savedPaintSizes, smudgeSize, etc.)
que não são features renderizadas — ficam em `__source` mas não em `__notImplemented`.

### 2.4 Pipeline de render

1. `addPoint(x, y, pressure, tiltX, tiltY)` calcula segmento desde último ponto.
2. Interpola pontos espaçados em `spacing × sizePx` ao longo do segmento.
3. Pra cada ponto:
   - Calcula `sizePx`, `alpha`, `sx/sy` aplicando modulações na ordem:
     pressão → jitter → tilt → falloff → taper → plot jitter → scatter.
   - Pega tip colorizado do cache (chave: `size` arredondado pra 2px).
   - Se brush tem grain e `grainDepth > 0`: monta stamp num offscreen
     reusado (tip-colorido + grain multiply, recortado pelo alpha do tip).
   - Senão: usa tip colorizado direto.
   - Estampa no `ctx` com `globalAlpha` final.

`erase=true` usa `globalCompositeOperation = 'destination-out'` no `ctx` —
apaga o que tem embaixo proporcional ao alpha do tip. Não-destrutivo pra
canvas transparente (mantém transparência onde apaga).

---

## 3. Estado de fidelidade ao arquivo

### 3.1 Implementado

Campos do bplist consumidos pela engine:

| Campo Procreate | Como traduz |
|---|---|
| `name` | nome exibido |
| `plotSpacing` | distância entre stamps (fração do tipSize) |
| `minSize` / `maxSize` | range de size do brush (não usado diretamente; UI usa) |
| `minOpacity` / `maxOpacity` | range de opacity (não usado diretamente) |
| `paintSize` / `paintOpacity` | valores nominais (alpha base do brush) |
| `shapeScatter` | deslocamento radial aleatório do stamp |
| `shapeAngle` | orientação base do tip (radianos — observado nos Sko4 como -π/2) |
| `shapeRoundness` | squash do tip (1 = circular; sem suporte real ainda no render) |
| `dynamicsJitterSize` / `dynamicsJitterOpacity` | jitter aleatório por stamp |
| `dynamicsPressureSize` / `dynamicsPressureOpacity` | modulação por pressão (linear) |
| `grainDepth` | força do grain por multiply |
| `grainOrientation` | "follows" vs "space" (aproximado — semântica exata sem fonte) |
| `blendMode` | lido, não interpretado (sempre 0 nos Sko4) |
| `textureScale` | tamanho do grain dentro do stamp (janela de sample) |
| `plotJitter` | deslocamento perpendicular à direção do traço |
| `dynamicsFalloff` | fade exponencial por distância acumulada |
| `taperStartLength` + `taperSize`/`taperOpacity`/`taperPressure` | afilamento no início do stroke (aproximado) |
| `dynamicsTiltSize` / `dynamicsTiltOpacity` / `dynamicsTiltAngle` / `dynamicsTiltCompression` | modulação por inclinação da caneta |

### 3.2 Aproximado (não-fiel)

- **`dynamicsFalloff`** — Procreate doc diz "fade do início ao fim". Sem
  conhecer comprimento total do stroke em tempo real, uso decaimento
  exponencial constante por px. Funciona em strokes "típicos" mas escurece
  cedo demais em strokes curtos e tarde demais em strokes longos.
- **`taperStartLength`** — é fração [0..1] do stroke. Sem comprimento total,
  uso referência fixa de 200px. Taper visível mas não fiel.
- **`grainOrientation`** — observamos `1` em todos os Sko4 mas significado
  exato sem fonte. Usamos como toggle `space`/`follows`.

### 3.3 Pendentes (não-implementados, valor não-default em algum brush Sko4)

Lista observada no Sko4. Quantidade exata por brush em
`prototype/brush-test/brushes/<id>/meta.json` → `__notImplemented`.

| Campo | Onde aparece | Por que não foi feito |
|---|---|---|
| `shapeRotation` | sombreamentos + alguns strokes (`1.0`) | Significado pra 0..1 sem fonte pública. Tentativa anterior (= rotação aleatória) introduziu artefato visual e foi removida. |
| `taperEndLength` | Pencil 4 | Exige render offscreen do stroke pra aplicar no `finish()`. Não pode ser feito em tempo real sem rearquitetura. |
| `dynamicsPressureBleed` | quase todos (valores tiny ~0.002) | Efeito "sangrar cor" sob pressão — exige render colorido com bleed por pixel; só importa pra brushes coloridos com mix. |
| `pencilTaperStartLength` / `pencilTaperEndLength` | Pencil 4 | Variante do taper específica pra Pencil tool. Semântica não documentada. |
| `renderingRecursiveMixing` | Pencil 4 (bool true) | Mixing recursivo de cor — exige `getImageData` por stamp ou WebGL. |
| `wetEdgesAmount` | Pencil 4 (0.26) | Escurece bordas do stroke (efeito aquarela). Exige shader. |
| `plotSmoothing` | alguns (0.06) | Suavização do traço por StreamLine. Custo médio (filtro de média móvel). |
| `dynamicsPressureOpacityTransfer` | Pencil 4 | Transfer mode com cap manual de alpha. Já documentado como ideia de Gap 2 da versão antiga; precisa de render offscreen. |
| `dynamicsSmudgeAccumulation` | vários | Param da ferramenta Smudge (não-pincel). Pode ficar fora enquanto Smudge não existir. |

### 3.4 Removido por interpretação errada

- **Rotação aleatória do stamp** (`rotationRandom × 2π × random`) — removida em
  2026-05-12. Foi consequência de mapear `shapeRotation: 1.0` como "rotação
  totalmente aleatória", mapeamento sem fonte. Catálogo `brushset-fields.md`
  e decoder schema dizem que `shapeRotation` é "offset relativo à direção do
  stroke" — significado preciso pra 0..1 ainda incerto.

---

## 4. Performance

Engine canvas 2D simples; ~60 stamps/segundo num brush típico (spacing denso,
tamanho ~32px), sem trava no PC do user (RTX, Wacom). Versão anterior com
supersampling 2× + rAF batching introduziu lag — foi removida na v5.

Não há otimização especial além de:

- Cache de tip colorizado por size discreto (chave arredondada pra 2px).
- Offscreen do stamp reutilizado entre stamps de um stroke (sem realocação).
- Tip preparado em RGBA-com-alpha-luminância só uma vez no `loadBrush` (custa
  ~50ms num PNG 1500×1500; aceitável porque é one-shot).

Quando virar gargalo:

- **OffscreenCanvas + Worker** se main thread ficar saturada.
- **WebGL** se compositing em CPU não escalar pra brushes não-lápis (aquarela,
  óleo, recursive mixing).

---

## 5. O que validar a cada mudança

Bancada serve como suite de regressão visual + smoke test funcional.

1. **20 brushes Sko4** carregam sem erro de console.
2. **Cada brush estampa** quando arrasta com botão pressionado.
3. **Pressão real da Wacom** modula size/opacity nos brushes que declaram
   `pressureSize` / `pressureOpacity` > 0.
4. **Tilt** muda valor no painel direito (não é zero quando inclina).
5. **Não há rotação aleatória inventada** (verificável: brushes de
   sombreamento não devem ter espinhos cruzados em ângulos arbitrários).
6. **Borracha apaga** o que foi pintado, deixando transparência.
7. **Painel "Não implementado"** mostra contagem coerente por brush
   (sombreamentos ~1, strokes ~1-2, pencil-4 ~7).

---

## 6. Histórico de versões da bancada

| Versão | Data | Estado |
|---|---|---|
| v1 | 2026-05-12 manhã | Primeira versão. Tip lido como alpha-mask (incorreto). |
| v2 | 2026-05-12 | Tip corrigido (luminância → alpha). Visual ficou bom. |
| v3 | 2026-05-12 | Adicionou orientação errada de tip + supersampling. Lag perceptível. |
| v4 | 2026-05-12 | Tentativa de fix de performance. Mantia lag em alguns brushes. |
| v5 | 2026-05-12 | Reverte pra v2 limpa + thumbs invertidos. Baseline. |
| v6 | 2026-05-12 | Engine v2 + meta.json com `__source`/`__implemented`/`__notImplemented`. |
| v7 | 2026-05-12 | textureScale + plotJitter + dynamicsFalloff + tilt + taperStart implementados. Rotação aleatória ainda presente (será removida na v8). |
| v8+ | a próxima | Rotação errada removida. Engine modular em 3 arquivos. |

---

## 7. O que este documento não cobre

- **Como a engine é consumida pelo editor de tirinha** → `plano-pintura-editor.md`.
- **Semântica detalhada de cada campo do .brushset** → `brushset-fields.md`.
- **Importação de outros formatos** (`.abr` Photoshop, `.gbr` GIMP, etc.) — não
  implementada. `brush-import.js` é específico pra `.brushset` Procreate.
- **Brush maker UI** (criar brush dentro da ferramenta) — fora de escopo;
  artistas trazem brushes prontos.
