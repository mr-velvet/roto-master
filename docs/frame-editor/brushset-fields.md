# .brushset Procreate — catálogo de campos

Última atualização: 2026-05-12. Baseado no `Brush.archive` (Apple bplist
NSKeyedArchiver) extraído de cada brush dentro de um `.brushset`, observado
nos 20 brushes do pacote **"Pencils by Sko4"** que estão em
`%TEMP%\brush-test\<UUID>\Brush.archive`.

Fontes de referência principais (usadas pra interpretação semântica de cada
campo):

- **Procreate Handbook — Brush Studio Settings**: lista todos os painéis
  e controles visíveis na UI do Brush Studio.
  https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings
- **`procreate-brush-decoder` (aumlette-lab)**: web viewer com schema
  estruturado (`procreate-brush-decoder-v1.7.json`) que mapeia paths do
  bplist → painel/setting da UI, com `raw_range`, fórmula `raw→gui` e
  notas. Cobre ~107 dos ~192 campos do bplist Sko4.
  https://github.com/aumlette-lab/procreate-brush-decoder ·
  https://github.com/aumlette-lab/procreate-brush-decoder/blob/procreate-brush-decoder/src/data/procreate-brush-decoder-v1.7.json

Quando uma linha cita só "Decoder schema v1.7" como fonte, é o JSON do
`procreate-brush-decoder` acima.

## Resumo

- Total de campos no bplist (top-level `objects[1]` do `Brush.archive`): **192**
  (mais a chave `$class` que o NSKeyedArchiver injeta em todo dict).
- Campos com fonte pública confirmada (handbook ou decoder schema): **134**
- Campos com hipótese plausível baseada em padrão de nome (ex.: todos os
  `*TiltAngle` herdam a explicação genérica do handbook): **48**
- Campos verdadeiramente desconhecidos (sem fonte e sem padrão claro): **10**
- Curvas Bézier/poligonais (`*Curve`): **9**. Nos 20 brushes Sko4 **todas**
  são a identidade `[(0,0), (1,1)]`.

## Convenções desta tabela

- **Tipo** = tipo Python depois de resolver UIDs do NSKeyedArchiver
  (`bool`, `int`, `float`, `str`, `curve` = `dict{points: NS.objects}`,
  `dict` = NSArray/NSData/NSDate em formato dict-objeto, `bytes` = NSData
  bruta).
- **Range Sko4** = se ≤6 valores únicos, lista todos; se mais, mostra
  `min..max | uniq=N`. Booleans mostram só os valores observados.
- **Status sugerido**:
  - `implementar` — fácil, impactante na fidelidade visual, dentro do
    escopo de uma engine canvas 2D.
  - `aproximar` — faz sentido pro look final mas vale uma simplificação
    (curva linear, fórmula heurística, etc.).
  - `ignorar` — feature 3D-painting, Apple Pencil Pro, hover cursor,
    metadata, preset, "Reset point" — fora do escopo de canvas 2D.
  - `desconhecido` — nem o handbook nem o decoder explicam; chute
    educado entre parênteses no campo "Significado".
- **Curva** `[(0,0), (1,1)]` = identidade. Procreate edita esta curva no
  painel **Apple Pencil → Pressure Curve** (e o decoder schema confirma
  que `dynamicsPressureOverall.points.NS.objects[]` é "Array of {x, y}
  float pairs for pressure graph"). Cada uma das curvas `dynamicsPressure*Curve`
  parece ser a curva de transferência específica de uma propriedade
  (size, opacity, hue, etc.) — ver seção "Curvas observadas".

## Categorias

A ordem segue mais ou menos os painéis do Brush Studio. Cada subseção tem
um cabeçalho com o nome do painel; campos fora dele caem em "Misc / unclear".

---

### 1. Stroke Path (painel "Stroke Path")

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `plotSpacing` | float | 0.00079..0.20316 (15 valores únicos) | **Spacing** — distância entre stamps ao longo do path. Decoder: `raw 0..2` → `gui = round(72.943 * raw^0.4558)` (0..100%). Quanto menor, mais denso o stamp. | implementar | Decoder schema v1.7; handbook §Stroke Path |
| `plotSpacingVersion` | int | [1] | Versão do algoritmo de spacing usado pelo Procreate. Aparece pra brushes salvos por versões mais novas do app. Provavelmente seleciona entre fórmulas de spacing (ver `taperVersion` análogo). | aproximar (usar v1) | sem fonte pública específica; inferido por analogia |
| `plotJitter` | float | 0..0.34993 (uniq=10) | **Jitter Lateral** — desloca cada stamp perpendicular à direção do stroke. Decoder: `raw 0..13.78` → `gui = round(60.69 * raw^0.4545)` (0..200%). | implementar | Decoder schema v1.7; handbook §Stroke Path |
| `dynamicsFalloff` | float | [0.0, 0.0433, 0.0643, 0.0702, 0.0971] | **Fall Off** — fade de opacidade do início ao fim do stroke. 0 = sem fade. | implementar | Decoder schema v1.7; handbook §Stroke Path |

> Os 4 campos novos vistos no decoder schema mas **ausentes** do bplist Sko4
> (`plotSpacingJitter`, `plotJitterLongitudinal`, `plotSpacingSpeed`) só
> aparecem em brushes salvos em versões do Procreate mais novas que o
> snapshot do Sko4. Não precisam ser implementados pra fidelidade ao Sko4.

### 2. Stabilization (painel "Stabilization")

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `plotSmoothing` | float | [0.0, 0.06] | **StreamLine Amount** — suaviza wobble do stroke. 0..1. | aproximar | Decoder schema v1.7; handbook §Stabilization |
| `dynamicsPressureSmoothing` | float | [0.0] | **StreamLine Pressure** — alonga aplicação suave de pressão. | aproximar | Decoder schema v1.7; handbook §Stabilization |
| `plotMovingAverageStabilization` | float | [0.0, 0.14809] | **Stabilization Amount** — média móvel para suavizar trazo. | aproximar | Decoder schema v1.7; handbook §Stabilization |
| `plotFFTSmoothingAmount` | float | [0.0] | **Motion Filtering Amount** — remove wobbles sem média. | aproximar | Decoder schema v1.7; handbook §Stabilization |
| `plotFFTSmoothingBias` | float | [0.0] | **Motion Filtering Expression** — restaura expressividade no stroke filtrado. | aproximar | Decoder schema v1.7; handbook §Stabilization |

### 3. Taper (painel "Taper")

Dois conjuntos paralelos: `pencilTaper*` (Apple Pencil) e `taper*` (touch / mouse).

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `pencilTaperStartLength` | float | [0.0, 1.0] | **Pressure Taper — Start Length** (0..1). | implementar | Decoder schema v1.7 (notes: "Pressure taper start") |
| `pencilTaperEndLength` | float | [0.0, 1.0] | **Pressure Taper — End Length**. | implementar | Decoder schema v1.7 (notes: "Pressure taper end") |
| `pencilTaperSize` | float | [0.0] | **Pressure Taper — Size** (severidade do thick→thin no taper). | implementar | Decoder schema v1.7; handbook §Taper |
| `pencilTaperOpacity` | float | [0.0] | **Pressure Taper — Opacity** fade no início/fim do taper. | implementar | Decoder schema v1.7; handbook §Taper |
| `pencilTaperShape` | float | [0.0] | **Pressure Taper — Tip**. Decoder: "0% = Sharp, 100% = Blunt". | aproximar | Decoder schema v1.7 |
| `pencilTaperSizeLinked` | bool | [False] | **Pressure Taper — Link tip sizes** (slider de início/fim se movem juntos). | ignorar (UI-only) | Decoder schema v1.7 |
| `pencilTipAnimation` | bool | [True] | **Pressure Taper — Tip Animation** (preview anima a ponta). | ignorar (UI-only) | Decoder schema v1.7 |
| `taperStartLength` | float | [0.0, 1.0] | **Touch Taper — Start Length** (taper artificial pra dedo/mouse). | implementar | Decoder schema v1.7 |
| `taperEndLength` | float | [0.0, 1.0] | **Touch Taper — End Length**. | implementar | Decoder schema v1.7 |
| `taperSize` | float | [0.0] | **Touch Taper — Size**. | implementar | Decoder schema v1.7 |
| `taperOpacity` | float | [0.0] | **Touch Taper — Opacity**. | implementar | Decoder schema v1.7 |
| `taperShape` | float | [0.0] | **Touch Taper — Tip** (0=Sharp, 100=Blunt). | aproximar | Decoder schema v1.7 |
| `taperPressure` | float | [0.0, 1.0] | **Touch Taper — Pressure** (pressão simulada no taper touch). | aproximar | Decoder schema v1.7 |
| `taperSizeLinked` | bool | [False] | **Touch Taper — Link tip sizes**. | ignorar (UI-only) | Decoder schema v1.7 |
| `taperVersion` | int | [0, 1] | **Classic Taper**. Decoder: "0 = classic taper on, 1 = classic taper off". Brushes Sko4 mistos entre 0 e 1. | aproximar | Decoder schema v1.7 |

### 4. Shape (painel "Shape")

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `bundledShapePath` | str | ["$null"] | **Shape Source** — path para o `Shape.png` quando o brush usa uma das shapes built-in do Procreate. `$null` significa "shape custom embutida no .brush" (no Sko4 sempre `Shape.png` no zip). | implementar | Decoder schema v1.7 (notes: "path of the shape file") |
| `shapeAzimuth` | bool | [False] | **Input Style** — quando True, usa azimuth do Apple Pencil pra rotacionar a shape (rotação que segue como o stylus está apontando). | ignorar (Apple Pencil-only) | Decoder schema v1.7 |
| `shapeRotation` | float | [0.0, 1.0] | **Rotation** — offset de rotação do stamp em relação à direção do stroke. Decoder: range raw `-1..1`. No bplist Sko4 só vemos 0 ou 1 (extremos), o que sugere que aqui está em "fração do círculo" (1 = 360°). | implementar | Decoder schema v1.7 (notes: "Controls stamp rotation offset") |
| `shapeScatter` | float | 0..2 (uniq=8) | **Scatter** — aleatoriedade de rotação por stamp. Raw 0..2. | implementar | Decoder schema v1.7; handbook §Shape |
| `shapeCount` | float | [0.0, 0.0625, 0.0863] | **Count** — número de stamps por ponto do path. Raw 0..1 mapeia pra 1..16 stamps. | aproximar | Decoder schema v1.7; handbook §Shape |
| `shapeCountJitter` | float | [0.0] | **Count Jitter** — varia count aleatoriamente. | aproximar | Decoder schema v1.7 |
| `shapeRandomise` | bool | [False] | **Randomized** — randomiza rotação da shape no início do stroke. | implementar | Decoder schema v1.7 |
| `shapeFlipXJitter` | bool | [False] | **Flip X** — mirror horizontal aleatório do stamp. | implementar | Decoder schema v1.7 |
| `shapeFlipYJitter` | bool | [False] | **Flip Y** — mirror vertical aleatório do stamp. | implementar | Decoder schema v1.7 |
| `shapeRoundness` | float | [1.0] | **Roundness** — squash da shape. Decoder: "1 = Circle, <1 = Ellipse". | implementar | Decoder schema v1.7 |
| `shapeAngle` | float | [-1.5766, 0.0, 0.00072] | **Angle** — rotação base do tip. Decoder anota "Degrees (0-360)" mas no bplist Sko4 vemos `-1.5766` (que é `-π/2` ≈ -90°) — então o valor armazenado parece ser **radianos**, não graus, ou um valor pré-normalizado. Confirmar com testes. | implementar | Decoder schema v1.7 + observação direta |
| `shapeFilter` | bool | [True] | **Shape Filtering** (toggle on/off). | implementar (sempre on) | Decoder schema v1.7; handbook §Shape |
| `shapeFilterMode` | int | [0] | **Shape Filtering** modo. Handbook: enum {No, Classic, Improved} antialiasing. Sko4 sempre 0. | aproximar | Decoder schema v1.7; handbook §Shape |
| `shapeOrientation` | int | [1] | (Sem fonte pública direta.) Provavelmente toggle entre "orientação fixa ao canvas" vs "segue stroke" vs "segue device". Relacionado mas distinto de `oriented` (Properties). **Desconhecido**. | desconhecido | sem fonte pública |
| `shapeInverted` | bool | [False] | Inverter shape (preto↔branco no Shape.png). Não aparece no decoder mas o nome é auto-explicativo e há análogo em Grain. | aproximar | inferido por padrão de nome (vs `textureInverted` confirmado) |
| `dynamicsPressureShapeRoundness` | float | [1.0] | **Pressure Roundness** — pressão controla squash. 1 = sem efeito. | aproximar | Decoder schema v1.7 |
| `dynamicsPressureShapeRoundnessMinimum` | float | [1.0] | Mínimo da roundness sob pressão. | aproximar | Decoder schema v1.7 |
| `dynamicsPressureShapeRoundnessCurve` | curve | [(0,0),(1,1)] | Curva de transferência pressure→roundness. Ver §17 Curves. | ignorar (sempre identidade no Sko4) | inferido (ver "Curvas observadas") |
| `dynamicsTiltShapeRoundness` | float | [1.0] | **Tilt Roundness** — tilt controla squash. | ignorar (Apple Pencil) | Decoder schema v1.7 |
| `dynamicsTiltShapeRoundnessMinimum` | float | [1.0] | Mínimo da roundness sob tilt. | ignorar | Decoder schema v1.7 |

### 5. Grain / Texture (painel "Grain")

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `bundledGrainPath` | str | ["$null"] | **Grain Source** — path do PNG de grain built-in; `$null` quando grain é custom (caso do Sko4, sempre `Grain.png` no zip). | implementar | Decoder schema v1.7 (notes: "path of the grain file") |
| `textureApplication` | int | [0] | **Moving / Texturized** — 0 = Moving (grain arrasta junto do stroke, efeito de smear/streaky), 1 = Texturized (grain estático). | implementar | Decoder schema v1.7 (notes: "0 = Moving, 1 = Texturised") |
| `textureMovement` | float | [1.0] | **Movement** — quanto o grain arrasta. Decoder: "0 = stamp, 100 = rolling". | implementar | Decoder schema v1.7 |
| `textureScale` | float | [1.0606, 1.1614, 2.8675, 8.1323] | **Scale** — tamanho do grain dentro da shape. Raw 0..16. | implementar | Decoder schema v1.7 |
| `textureZoom` | float | [1.0] | **Zoom** — Decoder: "0 = follow size, 100 = cropped". Define se grain re-escala com brush ou fica em tamanho fixo. | implementar | Decoder schema v1.7 |
| `textureRotation` | float | [0.0] | **Rotation** — Decoder: "100 = follow stroke". 0 = grain não rotaciona. | implementar | Decoder schema v1.7 |
| `grainDepth` | float | [0.275, 0.479, 0.826, 0.945, 0.979, 1.0] | **Depth** — força da textura sobre a cor base. 0..1. | implementar | Decoder schema v1.7 |
| `grainDepthMinimum` | float | [0.0] | **Depth Minimum** — mínimo da depth sob jitter. | aproximar | Decoder schema v1.7 |
| `grainDepthJitter` | float | [0.0] | **Depth Jitter** — randomiza balanço textura↔cor. | aproximar | Decoder schema v1.7 |
| `textureOffsetJitter` | bool | [True] | **Offset Jitter** — randomiza offset do grain a cada novo stroke. | implementar | Decoder schema v1.7 |
| `grainBlendMode` | int | [1] | **Blend Mode** do grain. Enum (não documentado publicamente; valor 1 nos Sko4 = provavelmente "Multiply" pelo comportamento de lápis). | aproximar | Decoder schema v1.7 (enum não público) |
| `textureBrightness` | float | [0.0] | **Brightness** — ajusta brilho do grain. Raw -0.75..0.75. | aproximar | Decoder schema v1.7 |
| `textureContrast` | float | [0.0] | **Contrast** — ajusta contraste do grain. Raw -1..1. | aproximar | Decoder schema v1.7 |
| `textureFilter` | bool | [True] | **Grain Filtering** toggle. | implementar (sempre on) | Decoder schema v1.7 |
| `textureFilterMode` | int | [0] | **Grain Filtering** modo {No, Classic, Improved}. | aproximar | Decoder schema v1.7; handbook §Grain |
| `texturizedGrainFollowsCamera` | bool | [True] | **3D Grain Follow Camera** — só importa em 3D painting. | ignorar (3D) | Decoder schema v1.7 |
| `grainOrientation` | int | [1] | (Sem fonte pública direta.) Análogo a `shapeOrientation`. Provavelmente enum {canvas, stroke, device}. | desconhecido | sem fonte pública |
| `textureOrientation` | int | [1] | Idem `grainOrientation`. | desconhecido | sem fonte pública |
| `textureInverted` | bool | [False] | Inverter texture (decoder não cita explicitamente mas o nome bate com toggle visível na UI). | aproximar | inferido por padrão |

### 6. Rendering (painel "Rendering")

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `renderingRecursiveMixing` | bool | [False, True] | **Rendering Mode** — flag que com `renderingModulatedTransfer` e `renderingMaxTransfer` formam o enum Rendering Mode (Light Glaze .. Intense Blending). | aproximar | Decoder schema v1.7; handbook §Rendering |
| `renderingModulatedTransfer` | bool | [False] | idem (combina com os outros pra selecionar o modo). | aproximar | Decoder schema v1.7 |
| `renderingMaxTransfer` | bool | [False] | idem. | aproximar | Decoder schema v1.7 |
| `dynamicsGlazedFlow` | float | [1.0] | **Flow** — fluxo de cor/textura por stamp. 0..1. | implementar | Decoder schema v1.7 |
| `wetEdgesAmount` | float | [0.0, 0.26] | **Wet Edges** — suaviza bordas mimetizando pigmento sangrando. | implementar | Decoder schema v1.7 |
| `burntEdgesAmount` | float | [0.0] | **Burnt Edges** — efeito de queima/burn onde strokes se sobrepõem. | aproximar | Decoder schema v1.7 |
| `burntEdgesBlendMode` | int | [1] | **Burnt Edges Mode** — enum de blend mode pro burnt edges. | aproximar | Decoder schema v1.7 |
| `blendMode` | int | [0] | **Blend Mode** — modo de blending do stroke inteiro. Enum (Procreate tem 26 blend modes; 0 = Normal). Sko4 sempre 0. | implementar | Decoder schema v1.7; handbook §Layers (blend modes) |
| `extendedBlend` | int | [0] | Provavelmente seletor pra blend modes "extended" (modos adicionais introduzidos em versões novas). Pareceia com `extendedBlend2` no decoder schema mais novo. | aproximar | inferido (analogia com decoder `extendedBlend2`) |
| `blendGammaCorrect` | bool | [False] | **Luminance Blending** — blend em espaço de luminância em vez de RGB. | aproximar | Decoder schema v1.7 |
| `dualBlendMode` | int | [0] | **Combine Mode** (Dual Brush panel) — como o dual brush combina com o primary. | ignorar (Dual Brush off no Sko4) | Decoder schema v1.7 |

### 7. Wet Mix (painel "Wet Mix")

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `dynamicsMix` | float | [0.0] | **Dilution** — razão água/tinta (mais transparência). | aproximar | Decoder schema v1.7 |
| `dynamicsLoad` | float | [0.5] | **Charge** — quantidade de tinta no início do stroke. | aproximar | Decoder schema v1.7 |
| `dynamicsPressureMix` | float | [0.0] | **Attack** — adesão da tinta ao canvas. | aproximar | Decoder schema v1.7 |
| `dynamicsWetAccumulation` | float | [0.75] | **Pull** — força de arrasto/mixagem da tinta molhada. | aproximar | Decoder schema v1.7 |
| `dynamicsMixSoftening` | float | [0.0] | **Grade** — chunkiness/contraste da textura. Decoder: "100 = smooth". | aproximar | Decoder schema v1.7 |
| `dynamicsBlur` | float | [0.0] | **Blur** — blur aplicado à tinta no canvas. | aproximar | Decoder schema v1.7 |
| `dynamicsBlurJitter` | float | [0.0] | **Blur Jitter** — randomiza blur por stamp. | aproximar | Decoder schema v1.7 |
| `dynamicsWetnessJitter` | float | [0.0] | **Wetness Jitter** — randomiza wet por stamp. | aproximar | Decoder schema v1.7 |

> Wet Mix é o motor pesado de "tinta molhada" do Procreate. Pra um lápis
> seco (caso do Sko4) os campos ficam todos no default — implementar
> aproximação simplificada é suficiente; full wet engine é fora de escopo.

### 8. Color Dynamics (painel "Color Dynamics")

Três grupos: **Stamp Jitter** (variação por stamp), **Stroke Jitter** (uma
variação por stroke inteiro), e **Pressure / Tilt** (variação contínua).

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `dynamicsJitterHue` | float | [0.0] | **Stamp Hue Jitter** — randomiza hue por stamp. 0..1. | implementar | Decoder schema v1.7 |
| `dynamicsJitterSaturation` | float | [0.0] | **Stamp Saturation Jitter**. | implementar | Decoder schema v1.7 |
| `dynamicsJitterLightness` | float | [0.0] | **Stamp Lightness Jitter** (clareia). | implementar | Decoder schema v1.7 |
| `dynamicsJitterDarkness` | float | [0.0] | **Stamp Darkness Jitter** (escurece). | implementar | Decoder schema v1.7 |
| `dynamicsJitterOpacity` | float | [0.0, 0.121] | **Jitter Opacity** (na verdade do painel Dynamics, mas afeta cada stamp). | implementar | Decoder schema v1.7 (panel Dynamics) |
| `dynamicsJitterSize` | float | [0.0, 0.1225] | **Jitter Size** (painel Dynamics). | implementar | Decoder schema v1.7 |
| `jitterSecondary` | float | [0.0] | **Stamp Secondary Color Jitter** — randomiza entre cor primária/secundária. | aproximar | Decoder schema v1.7 |
| `dynamicsJitterStrokeHue` | float | [0.0] | **Stroke Hue Jitter** — randomiza hue por stroke inteiro. | implementar | Decoder schema v1.7 |
| `dynamicsJitterStrokeSaturation` | float | [0.0] | **Stroke Saturation Jitter**. | implementar | Decoder schema v1.7 |
| `dynamicsJitterStrokeLightness` | float | [0.0] | **Stroke Lightness Jitter**. | implementar | Decoder schema v1.7 |
| `dynamicsJitterStrokeDarkness` | float | [0.0] | **Stroke Darkness Jitter**. | implementar | Decoder schema v1.7 |
| `jitterStrokeSecondary` | float | [0.0] | **Stroke Secondary Color Jitter**. | aproximar | Decoder schema v1.7 |
| `dynamicsPressureHue` | float | [0.0] | **Pressure Hue** — pressão desloca hue. Raw -1..1. | aproximar | Decoder schema v1.7 |
| `dynamicsPressureSaturation` | float | [0.0] | **Pressure Saturation**. Raw -1..1. | aproximar | Decoder schema v1.7 |
| `dynamicsPressureBrightness` | float | [0.0] | **Pressure Brightness**. Raw -1..1. | aproximar | Decoder schema v1.7 |
| `dynamicsPressureSecondaryColor` | float | [0.0] | **Pressure Secondary Color**. Raw -1..1. | aproximar | Decoder schema v1.7 |
| `dynamicsTiltHue` | float | [0.0] | **Tilt Hue**. Raw -1..1. | ignorar (tilt-only) | Decoder schema v1.7 |
| `dynamicsTiltSaturation` | float | [0.0] | **Tilt Saturation**. | ignorar | Decoder schema v1.7 |
| `dynamicsTiltBrightness` | float | [0.0] | **Tilt Brightness**. | ignorar | Decoder schema v1.7 |
| `dynamicsTiltSecondaryColor` | float | [0.0] | **Tilt Secondary Color**. | ignorar | Decoder schema v1.7 |

### 9. Dynamics (painel "Dynamics" — Speed + Jitter)

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `dynamicsSpeedSize` | float | [0.0] | **Speed Size** — velocidade do stroke afeta tamanho. Raw -1..1 (negativo: rápido→fino; positivo: rápido→grosso). | aproximar | Decoder schema v1.7; handbook §Dynamics |
| `dynamicsSpeedOpacity` | float | [0.0] | **Speed Opacity** — análogo pra opacidade. Raw -1..1. | aproximar | Decoder schema v1.7 |

> `dynamicsJitterSize` e `dynamicsJitterOpacity` estão listados acima em
> Color Dynamics porque o decoder schema os agrupa lá, mas na UI eles
> aparecem no painel "Dynamics".

### 10. Apple Pencil (painel "Apple Pencil")

Pressão + Tilt + Barrel Roll. Pra uma engine de canvas 2D que não tem
Apple Pencil, **só Pressure faz sentido** (assumindo pointer com pressure
via PointerEvent.pressure ou um mock).

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `dynamicsPressureSize` | float | [0.0, 0.4991, 0.6068] | **Pressure — Size** — quanto a pressão escala o tamanho. Raw -1..1. | implementar | Decoder schema v1.7 |
| `dynamicsPressureOpacity` | float | [0.0, 0.8] | **Pressure — Flow** (apesar do nome do bplist dizer Opacity, decoder mapeia pra "Flow"). Raw -1..1. | implementar | Decoder schema v1.7 |
| `dynamicsPressureOpacityTransfer` | float | [0.4857, 1.0] | **Pressure — Opacity** (o slider chamado "Opacity" na UI). 0..1. | implementar | Decoder schema v1.7 |
| `dynamicsPressureBleed` | float | [0.0, 0.0017, 0.0021] | **Pressure — Bleed** — pressão afeta bleed das bordas. 0..1. | aproximar | Decoder schema v1.7 |
| `dynamicsTiltAngle` | float | [0.1, 0.13, 0.135, 0.33, 0.331, 0.333] | **Tilt Angle** (Apple Pencil panel) — threshold global em **graus** (decoder anota "Degrees 0-90"). Sko4 usa ~0.1 (≈ 5.7°, perto do default Procreate de 9°) ou ~0.33. **Cuidado**: aqui o range do raw é 0..1, então `0.1` corresponde a 9° (default), `0.333` ≈ 30°. | aproximar | Decoder schema v1.7 + handbook ("default Tilt 9º, range 0-90º") |
| `dynamicsTiltOpacity` | float | [0.0, 0.4461, 0.45, 0.7008, 0.7032] | **Tilt — Opacity** — quanto o tilt afeta opacidade. 0..1. | ignorar (tilt) | Decoder schema v1.7 |
| `dynamicsTiltGradation` | float | [0.0] | **Tilt — Gradation** — efeito de sombreado quando inclina. | ignorar | Decoder schema v1.7 |
| `dynamicsTiltBleed` | float | [0.0, 0.0005, 0.0045] | **Tilt — Bleed**. | ignorar | Decoder schema v1.7 |
| `dynamicsTiltSize` | float | [0.0, 1.0] | **Tilt — Size**. | ignorar | Decoder schema v1.7 |
| `dynamicsTiltCompression` | float | [0.0, 1.0] | **Tilt — Size Compression** — Decoder: "0 = no compression, 1 = size compresses with tilt". Aqui parece bool armazenado como float. | ignorar | Decoder schema v1.7 |

> Não há campos `dynamicsRoll*` no bplist do Sko4 — o Apple Pencil Pro
> (Barrel Roll) é mais novo que o snapshot deste pacote.

### 11. Properties (painel "Properties")

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `oriented` | bool | [True] | **Orient to Screen** — quando True, a shape mantém orientação relativa à tela (segue rotação do device); quando False, fica fixa ao canvas. | implementar | Decoder schema v1.7 |
| `dynamicsSmudgeAccumulation` | float | [0.7486, 0.75, 1.0] | **Smudge Pull** (no painel Properties, não em Wet Mix). | aproximar | Decoder schema v1.7 |
| `maxSize` | float | 0.4..4.30 (uniq=7) | **Maximum Size** — limite superior do slider de size na UI. Em unidades de Procreate (até ~16). | implementar | Decoder schema v1.7 |
| `minSize` | float | [0.0] | **Minimum Size** — limite inferior. | implementar | Decoder schema v1.7 |
| `maxOpacity` | float | [0.3725, 0.8732, 1.0] | **Maximum Opacity**. 0..1. | implementar | Decoder schema v1.7 |
| `minOpacity` | float | [0.0] | **Minimum Opacity**. | implementar | Decoder schema v1.7 |
| `previewSize` | float | [0.3] | **Preview Size** — tamanho do stroke/stamp mostrado na brush library. | ignorar (UI-only) | Decoder schema v1.7 |
| `stamp` | bool | [False] | **Use Stamp Preview** — mostra preview como stamp único, não stroke. | ignorar (UI-only) | Decoder schema v1.7 |

### 12. Materials (painel "Materials" — 3D painting)

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `metallicAmount` | float | [0.0] | **Metallic Amount** — 0..1 (Decoder: "100 = metalic"). | ignorar (3D) | Decoder schema v1.7 |
| `metallicScale` | float | [0.16] | **Metallic Scale**. | ignorar (3D) | Decoder schema v1.7 |
| `metallicGrainInverted` | bool | [False] | Inverter textura do metallic. | ignorar (3D) | inferido |
| `bundledMetallicPath` | str | ["$null"] | Path da textura metallic. | ignorar (3D) | inferido |
| `roughnessAmount` | float | [0.5] | **Roughness Amount** (Decoder: "100 = matte"). | ignorar (3D) | Decoder schema v1.7 |
| `roughnessScale` | float | [0.16] | **Roughness Scale**. | ignorar (3D) | Decoder schema v1.7 |
| `roughnessGrainInverted` | bool | [False] | Inverter textura roughness. | ignorar (3D) | inferido |
| `bundledRoughnessPath` | str | ["$null"] | Path da textura roughness. | ignorar (3D) | inferido |
| `heightAmount` | float | [0.5] | Height map amount (3D painting — normal map gerado a partir de heightmap). | ignorar (3D) | inferido |
| `heightScale` | float | [0.16] | Height map scale. | ignorar (3D) | inferido |
| `bundledHeightPath` | str | ["$null"] | Path do height map. | ignorar (3D) | inferido |

> A presença desses campos em todo brush, mesmo nos lápis Sko4 puros 2D,
> sugere que o Procreate sempre serializa esses slots — só ficam zerados.

### 13. About this Brush (metadata)

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `name` | str | 20 únicos (cada brush) | Nome do brush. | implementar | Decoder schema v1.7 (não explícito mas óbvio) |
| `authorName` | str | ["Andrew Skoch Design"] | **Made by Name** — criador. | implementar (mostrar) | Handbook §About this Brush |
| `creationDate` | dict | `{NS.time: float}` | **Date Created** — NSDate (segundos desde 2001-01-01 UTC). Sko4 ≈ 666099955 ≈ 2022-02-08. | implementar (mostrar) | Handbook §About this Brush |
| `color` | bytes | 16 bytes zero | **Author Picture / Signature color**? Sempre zerado nos Sko4. Decoder schema não documenta. Hipótese: NSColor serializado (4 floats CGFloat = 16 bytes = 4 componentes RGBA), default = (0,0,0,0). | desconhecido | sem fonte; hipótese baseada em tamanho |
| `version` | int | [2] | Versão do schema do bplist. Indica qual revisão da estrutura de Brush.archive o Procreate usou. | aproximar (suportar v2) | inferido |
| `importedFromABR` | bool | [False] | **True** se o brush foi importado de um `.abr` (Photoshop). | implementar (mostrar) | inferido por nome + handbook §Importing brushes |

### 14. Brush Memory (saved presets)

Tudo aqui são `dict` no formato `{NS.objects: []}` (NSArray vazio nos
20 brushes Sko4). Funcionam como os 4 marks de memória do slider — ver
handbook §Brush Library / Paint, Smudge, Erase.

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `paintSize` | float | [0.169, 0.438, 0.5, 0.776] | Valor atual do slider **Brush Size** lembrado pra este brush no modo paint. | implementar | Handbook §Paint, Smudge, Erase + Brush Memory |
| `paintOpacity` | float | [0.797, 1.0] | Valor atual do slider **Brush Opacity** no modo paint. | implementar | idem |
| `paintPressure` | float | [1.0] | Valor de pressão "lembrado". Sko4 sempre 1.0. | aproximar | inferido |
| `smudgeSize` | float | [0.5] | Tamanho do slider lembrado pro modo Smudge. | ignorar (UI-state) | Handbook |
| `smudgeOpacity` | float | [0.8] | Opacidade do slider lembrado pro modo Smudge. | ignorar (UI-state) | Handbook |
| `eraseSize` | float | [0.5] | Idem pro modo Erase. | ignorar (UI-state) | Handbook |
| `eraseOpacity` | float | [1.0] | Idem. | ignorar (UI-state) | Handbook |
| `savedPaintSizes` | dict | `{NS.objects: []}` | Lista de até 4 marks de size salvos no slider (modo Paint). Vazio nos Sko4. | ignorar (UI-state) | Handbook |
| `savedPaintOpacities` | dict | `{NS.objects: []}` | Idem opacities. | ignorar (UI-state) | Handbook |
| `savedSmudgeSizes` | dict | `{NS.objects: []}` | Idem para Smudge. | ignorar (UI-state) | Handbook |
| `savedSmudgeOpacities` | dict | `{NS.objects: []}` | Idem. | ignorar (UI-state) | Handbook |
| `savedEraseSizes` | dict | `{NS.objects: []}` | Idem para Erase. | ignorar (UI-state) | Handbook |
| `savedEraseOpacities` | dict | `{NS.objects: []}` | Idem. | ignorar (UI-state) | Handbook |
| `maxPressureSizeClamped` | bool | [False] | (Hipótese) clampa size em pressão máxima — não cresce além de `maxSize`. | desconhecido | sem fonte |

### 15. Per-property Tilt Angle thresholds

Estes campos parecem ser o **threshold individual de tilt em radianos**
(0..π/2) pra cada propriedade que pode ser controlada por tilt. O handbook
diz: "Use the Tilt setting to assign a Pencil tilt angle to an individual
brush studio setting. (...) default Tilt 9º, range 0-90º". Nos Sko4 quase
todos ficam em `0.1` (≈ 5.7°). **Todos são tilt-only → fora de escopo de
canvas 2D, marcar `ignorar`.**

| Campo | Tipo | Range Sko4 | Significado (hipótese) | Status | Fonte |
|---|---|---|---|---|---|
| `sizeTiltAngle` | float | [0.1] | Threshold de tilt pra "Tilt → Size" começar a agir. | ignorar | inferido (Handbook §Apple Pencil) |
| `opacityTiltAngle` | float | [0.1] | Idem pra opacidade. | ignorar | inferido |
| `bleedTiltAngle` | float | [0.1] | Idem pra bleed. | ignorar | inferido |
| `hueTiltAngle` | float | [0.1] | Idem pra Color Tilt → Hue. | ignorar | inferido |
| `saturationTiltAngle` | float | [0.1] | Idem pra saturation. | ignorar | inferido |
| `brightnessTiltAngle` | float | [0.1] | Idem pra brightness. | ignorar | inferido |
| `secondaryColorTiltAngle` | float | [0.1] | Idem pra secondary color. | ignorar | inferido |
| `gradationTiltAngle` | float | [0.1] | Idem pra Tilt → Gradation. | ignorar | inferido |
| `shapeRoundnessTiltAngle` | float | [0.1] | Idem pra Tilt Roundness. | ignorar | inferido |
| `shapeCountTiltAngle` | float | [0.1] | Idem pra shapeCount sob tilt. | ignorar | inferido |
| `attackTiltAngle` | float | [0.1] | Idem pra Wet Mix "Attack" sob tilt. | ignorar | inferido |
| `darknessJitterTiltAngle` | float | [0.1] | Idem pra Color Jitter Darkness sob tilt. | ignorar | inferido |
| `hueJitterTiltAngle` | float | [0.1] | Idem pra Color Jitter Hue sob tilt. | ignorar | inferido |
| `saturationJitterTiltAngle` | float | [0.1] | Idem. | ignorar | inferido |
| `lightnessJitterTiltAngle` | float | [0.1] | Idem. | ignorar | inferido |
| `secondaryColorJitterTiltAngle` | float | [0.1] | Idem. | ignorar | inferido |
| `plotJitterTiltAngle` | float | [0.1] | Idem pra Stroke Path jitter sob tilt. | ignorar | inferido |
| `textureDepthTiltAngle` | float | [0.1] | Idem pra Grain Depth sob tilt. | ignorar | inferido |

### 16. Per-property "Jitter by Tilt" toggles

Bools que parecem ativar a modalidade "tilt controla esse jitter
específico" (complemento dos `*TiltAngle` acima). Todos `False` nos Sko4.

| Campo | Tipo | Range Sko4 | Significado (hipótese) | Status | Fonte |
|---|---|---|---|---|---|
| `attackTilt` | bool | [False] | "Tilt afeta Attack" toggle. | ignorar | inferido |
| `hueJitterTilt` | bool | [False] | "Tilt afeta Hue Jitter" toggle. | ignorar | inferido |
| `saturationJitterTilt` | bool | [False] | idem saturation. | ignorar | inferido |
| `lightnessJitterTilt` | bool | [False] | idem lightness. | ignorar | inferido |
| `darknessJitterTilt` | bool | [False] | idem darkness. | ignorar | inferido |
| `secondaryColorJitterTilt` | bool | [False] | idem secondary. | ignorar | inferido |
| `plotJitterTilt` | bool | [False] | idem plot/path jitter. | ignorar | inferido |
| `shapeCountTilt` | bool | [False] | idem count. | ignorar | inferido |
| `textureDepthTilt` | bool | [False] | idem grain depth. | ignorar | inferido |

### 17. Curves (pressão → propriedade)

Todas armazenadas como `dict{points: NSArray<NSString>}`, onde cada string
é `"{x, y}"` em coordenadas normalizadas `[0,1]`. Aparentemente avaliadas
como **piecewise linear** (interpolação linear entre pontos consecutivos)
— o decoder schema cita "Array of {x, y} float pairs for pressure graph"
sem mencionar Bézier; o painel Apple Pencil mostra a curva com handles
arrastáveis que sugerem linear-poligonal, não Bézier cúbica.

Default para todas as curvas é a identidade `[(0,0), (1,1)]`. **Nos 20
brushes Sko4 todas as curvas estão no default** — Sko4 não customizou
nenhuma.

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `dynamicsPressureSizeCurve` | curve | [(0,0),(1,1)] | Curva de transferência **pressure → size** (multiplica `dynamicsPressureSize`). | implementar | inferido (analogia com Pressure Graph do handbook) |
| `dynamicsPressureOpacityCurve` | curve | [(0,0),(1,1)] | Curva pressure → opacity/flow. | implementar | idem |
| `dynamicsPressureBleedCurve` | curve | [(0,0),(1,1)] | Curva pressure → bleed. | aproximar | idem |
| `dynamicsPressureHueCurve` | curve | [(0,0),(1,1)] | Curva pressure → hue shift. | aproximar | idem |
| `dynamicsPressureSaturationCurve` | curve | [(0,0),(1,1)] | Curva pressure → saturation. | aproximar | idem |
| `dynamicsPressureBrightnessCurve` | curve | [(0,0),(1,1)] | Curva pressure → brightness. | aproximar | idem |
| `dynamicsPressureSecondaryColorCurve` | curve | [(0,0),(1,1)] | Curva pressure → secondary color. | aproximar | idem |
| `dynamicsPressureShapeRoundnessCurve` | curve | [(0,0),(1,1)] | Curva pressure → roundness. | aproximar | idem |
| `dynamicsPressureTransferModulationCurve` | curve | [(0,0),(1,1)] | Curva mestra de modulação da pressão sobre transfer (provavelmente o que o decoder chama `dynamicsPressureOverall` / "Pressure Curve" do painel Apple Pencil). | implementar | Decoder schema v1.7 (Pressure Curve) |

### 18. Pressure helpers

| Campo | Tipo | Range Sko4 | Significado | Status | Fonte |
|---|---|---|---|---|---|
| `dynamicsPressureResponse` | float | [0.0] | (Sem fonte direta.) Hipótese: "responsividade" global da pressão (talvez análoga ao slider "Pressure" do painel Taper que alonga/encurta a aplicação de pressão). | desconhecido | sem fonte |
| `dynamicsPressureSizeSpeed` | float | [0.0] | (Sem fonte direta.) Hipótese: acoplamento speed↔size sob pressão. | desconhecido | sem fonte |
| `dynamicsPressureOpacitySpeed` | float | [0.0] | Idem para opacidade. | desconhecido | sem fonte |
| `dynamicsPressureBleedSpeed` | float | [0.0] | Idem para bleed. | desconhecido | sem fonte |

## Curvas observadas

Todas as 9 curvas (`dynamicsPressure*Curve`) nos 20 brushes Sko4 estão no
valor default `[(0.000000, 0.000000), (1.000000, 1.000000)]` — identidade
linear. O Sko4 não customiza nenhuma curva neste pacote, então não dá pra
inferir empiricamente o formato exato a partir destes arquivos.

Inferência sobre formato (do decoder schema + UI):

- Armazenamento: `NSArray` de strings, cada string formatada como
  `"{%f, %f}"` (`CGPoint` stringified pelo Cocoa).
- Coordenadas: ambos `x` (input normalizado) e `y` (output normalizado)
  estão em `[0, 1]`.
- Avaliação: provavelmente **piecewise linear** entre pontos consecutivos
  (o decoder schema chama o conjunto de "Array of {x, y} float pairs for
  pressure graph", e a UI do Procreate desenha segmentos retos entre os
  6 handles). Quando implementarmos, começar com linear; se renderizar
  diferente do Procreate em testes A/B, trocar pra Catmull-Rom ou Bézier.
- Quantidade de pontos: na UI o painel Apple Pencil tem **6 handles**
  fixos. As 9 curvas no bplist sempre têm 2 pontos (start + end) quando
  na identidade. Quando customizadas, podem ter até 6.

## Campos sem nenhuma fonte pública confirmada

Lista nominal — todos com hipótese explícita (chute educado, **não tratar
como verdade**):

1. `shapeOrientation` (int, sempre 1): provável enum {canvas/stroke/device}
   relacionado ao modo de orientação da shape. Análogo ao toggle "Orient
   to Screen" mas para shape em vez de canvas.
2. `grainOrientation` (int, sempre 1): idem pra grain.
3. `textureOrientation` (int, sempre 1): idem pra texture.
4. `extendedBlend` (int, sempre 0): seletor de blend modes "extendidos"
   (versões mais novas do Procreate adicionaram modos novos; este campo
   provavelmente seleciona o subset).
5. `color` (16 bytes, todos zero): provável `NSColor` (4 CGFloats RGBA)
   serializado. Talvez relacionado a Signature/Author Picture color, ou
   a "color override" do brush. Sempre default zero nos Sko4.
6. `dynamicsPressureResponse` (float, sempre 0): hipótese — ganho/curva
   global de resposta à pressão.
7. `dynamicsPressureSizeSpeed` (float, sempre 0): hipótese — modulação
   speed↔size sob pressão.
8. `dynamicsPressureOpacitySpeed` (float, sempre 0): idem opacity.
9. `dynamicsPressureBleedSpeed` (float, sempre 0): idem bleed.
10. `maxPressureSizeClamped` (bool, sempre False): hipótese — clampa size
    em pressão máxima pra não passar do `maxSize`.

Vale a pena: se quisermos resolver esses 10, a melhor estratégia é abrir
o Procreate, criar um brush, mexer em controles específicos do Brush Studio
e comparar o `Brush.archive` antes/depois — é assim que o `procreate-brush-decoder`
foi construído.

## Apêndice — campos do decoder schema v1.7 ausentes neste bplist

Estes 27 campos existem no schema v1.7 mas **não** estão nos Brush.archive
do Sko4 (provavelmente foram adicionados em versões do Procreate
posteriores ao snapshot Sko4 de 2022). Listados pra completude — quando
importarmos brushes mais recentes, vão aparecer:

`alphaThreshold`, `alphaThresholdAmount`, `burntEdgesBlendModeExtended`,
`dualBlendModeExtended`, `dynamicsRollBleed`, `dynamicsRollBrightness`,
`dynamicsRollHue`, `dynamicsRollOpacity`, `dynamicsRollSaturation`,
`dynamicsRollSecondaryColor`, `dynamicsRollSize`, `extendedBlend2`,
`grainBlendModeExtended`, `hoverFill`, `hoverOutline`, `hoverPressure`,
`jitterShapeRoundness`, `jitterShapeRoundnessX`, `plotJitterLongitudinal`,
`plotSpacingJitter`, `plotSpacingSpeed`, `previewPressureMinimum`,
`previewPressureScale`, `previewTiltAngleOffset`, `previewWetMixEnabled`,
`shapeRoll`, `shapeRollMode`.

Os `dynamicsRoll*` são todos do **Apple Pencil Pro Barrel Roll** (ignorar
em canvas 2D). `hover*` são do **Cursor Outline / Hover** (também só faz
sentido com hardware específico). `alphaThreshold*` é controle de
threshold de alpha que o handbook menciona. Os `shapeRoll*` são pra
controle de barrel roll na shape. `preview*` são UI-only.
