// Frames Editor — I/O de .aseprite (parser + writer genéricos)
//
// Caso geral: tirinha com C camadas e Q quadros arbitrários, células podendo
// ser vazias (ausentes) em qualquer interseção.
//
// Mapeamento 1-pra-1 com o modelo de dados do Frames Editor (ver
// docs/frame-editor/modelo-de-dados.md). Fidelidade parcial (ver
// docs/frame-editor/aseprite-io.md §5): tags, slices, paths, tween, groups
// e tilemaps são ignorados na importação e não são gerados na exportação.
// Modo de cor assumido: RGBA 32bpp.
//
// Reusa o parser existente (aseprite_parser.js) pra evitar duplicação de
// lógica de baixo nível. O writer é novo — o writer antigo (aseprite.js) é
// fechado em layout (sempre 2 camadas ref/draw) e foi mantido intacto pra
// não regredir o fluxo da rotoscopia em produção.
//
// Depende de `window.pako` (já carregado via CDN no index.html).

import { parseAseprite } from './aseprite_parser.js';

// === Constantes do formato (mesmas do writer antigo) =========================
const ASE_MAGIC = 0xA5E0;
const FRAME_MAGIC = 0xF1FA;
const CHUNK_LAYER = 0x2004;
const CHUNK_CEL = 0x2005;
const CHUNK_COLOR_PROFILE = 0x2007;

const LAYER_FLAG_VISIBLE = 1;
const LAYER_FLAG_EDITABLE = 2;
// LAYER_TYPE: 0 = normal, 1 = group, 2 = tilemap. MVP só lida com normal.
const LAYER_TYPE_NORMAL = 0;
const LAYER_TYPE_GROUP = 1;

const CEL_TYPE_COMPRESSED_IMAGE = 2;

// === ByteWriter (mesmo do writer antigo, copiado pra independência) ==========
class ByteWriter {
  constructor(initialCap = 1024) {
    this.buf = new Uint8Array(initialCap);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
  }
  _ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.pos + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(this.buf.buffer);
  }
  u8(v) { this._ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  u16(v) { this._ensure(2); this.view.setUint16(this.pos, v, true); this.pos += 2; }
  u32(v) { this._ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  i16(v) { this._ensure(2); this.view.setInt16(this.pos, v, true); this.pos += 2; }
  bytes(arr) { this._ensure(arr.length); this.buf.set(arr, this.pos); this.pos += arr.length; }
  zeros(n) { this._ensure(n); this.pos += n; }
  str(s) {
    const enc = new TextEncoder().encode(s);
    this.u16(enc.length);
    this.bytes(enc);
  }
  placeholderU32() { const p = this.pos; this.u32(0); return p; }
  patchU32(at, val) { this.view.setUint32(at, val >>> 0, true); }
  finalize() { return this.buf.slice(0, this.pos); }
}

// === Parser pro Frames Editor ===============================================
//
// Entrada: ArrayBuffer ou Uint8Array de um .aseprite.
// Saída: {
//   largura, altura,
//   camadas: [{ nome, ordem, visivel }, ...],
//   quadros: [{ indice, duracao_ms }, ...],
//   celulas: [{ camada_indice, quadro_indice, pixels_rgba: Uint8Array, largura, altura }, ...]
// }
//
// Princípio do MVP (ver aseprite-io.md §5/§6): grupos e tilemaps são pulados.
// Camadas filhas de grupos sobem pra raiz (achatamento). Tags, slices, paths,
// tween são ignorados pelo parser de baixo. Erros devolvem mensagem genérica.

export function parseAsepriteParaFrameEditor(arrayBufferOrUint8) {
  let parsed;
  try {
    parsed = parseAseprite(arrayBufferOrUint8);
  } catch (err) {
    throw new Error(`falha ao parsear .aseprite: ${err.message || err}`);
  }

  const { width, height, layers, frames } = parsed;

  // Filtra só camadas "normais" (descarta grupos/tilemaps). Mantém o índice
  // original do .aseprite pra resolver os cels que apontam pra ele.
  // O parser de baixo só lê o flags+name das camadas (não expõe layerType
  // explicitamente), mas o writer antigo só emite type=0 implícito (campos
  // após flags são zero). Pra arquivos do Aseprite desktop, grupos têm
  // type=1; tilemaps type=2. O parser atual chama r.u16() pra `type` e
  // descarta — então não dá pra distinguir aqui sem reler. Pragmaticamente,
  // o MVP assume que tudo que o parser entregou é camada normal, e quando
  // tiver fidelidade fina o parser passa a expor type. Por hora fica assim:
  // todas as camadas viram fe_camada.

  const camadas = layers.map((l, idx) => ({
    nome: l.name,
    ordem: idx, // ordem visual = índice no array (maior = mais em cima)
    visivel: !!l.visible,
  }));

  const quadros = frames.map((f, idx) => ({
    indice: idx,
    duracao_ms: f.durationMs || null,
  }));

  // Pra cada interseção (camada × quadro), olha se há cel não-vazio.
  // Composita os cels da mesma camada/quadro num único Uint8Array do tamanho
  // do canvas (largura × altura), porque o modelo do FE é "uma célula = um
  // PNG" — não tem sentido manter múltiplos cels descontíguos por interseção
  // (são compostos no resultado final igual o canvas mostraria).
  const celulas = [];
  for (let qi = 0; qi < frames.length; qi++) {
    const frame = frames[qi];
    for (let ci = 0; ci < layers.length; ci++) {
      const cels = frame.layerCels.get(ci);
      if (!cels || cels.length === 0) continue;
      const composto = compositeCelsDaInterseccao(cels, width, height);
      if (!composto) continue; // ficou todo transparente → trata como vazia
      celulas.push({
        camada_indice: ci,
        quadro_indice: qi,
        pixels_rgba: composto,
        largura: width,
        altura: height,
      });
    }
  }

  return {
    largura: width,
    altura: height,
    camadas,
    quadros,
    celulas,
  };
}

// Composita múltiplos cels numa única superfície do tamanho do canvas.
// Retorna null se não há nenhum pixel não-transparente.
function compositeCelsDaInterseccao(cels, frameW, frameH) {
  const out = new Uint8Array(frameW * frameH * 4); // zerado = transparente
  let temPixel = false;
  for (const cel of cels) {
    if (cel.linked) continue; // o parser já tentou resolver; se sobrou linked, ignora
    if (!cel.rgba) continue;
    const { x, y, w, h, rgba, opacity } = cel;
    const alphaScale = (opacity ?? 255) / 255;
    for (let row = 0; row < h; row++) {
      const dy = y + row;
      if (dy < 0 || dy >= frameH) continue;
      for (let col = 0; col < w; col++) {
        const dx = x + col;
        if (dx < 0 || dx >= frameW) continue;
        const si = (row * w + col) * 4;
        const di = (dy * frameW + dx) * 4;
        const sa = (rgba[si + 3] / 255) * alphaScale;
        if (sa <= 0) continue;
        const da = out[di + 3] / 255;
        const outA = sa + da * (1 - sa);
        if (outA <= 0) continue;
        const sr = rgba[si], sg = rgba[si + 1], sb = rgba[si + 2];
        const dr = out[di], dg = out[di + 1], db = out[di + 2];
        out[di + 0] = Math.round((sr * sa + dr * da * (1 - sa)) / outA);
        out[di + 1] = Math.round((sg * sa + dg * da * (1 - sa)) / outA);
        out[di + 2] = Math.round((sb * sa + db * da * (1 - sa)) / outA);
        out[di + 3] = Math.round(outA * 255);
        temPixel = true;
      }
    }
  }
  return temPixel ? out : null;
}

// === Writer pro Frames Editor ===============================================
//
// Entrada: estrutura no mesmo formato do parser. Pode passar células como
// `{ pixels_rgba: null }` ou simplesmente omiti-las pra interseções vazias.
// Saída: Uint8Array de um .aseprite válido.
//
// Comportamento:
// - Cada camada vira layer chunk (todos type=normal). Nome, ordem (via posição
//   no array) e visibilidade preservados. Layer chunks emitidos no primeiro
//   quadro (convenção do formato).
// - Cada quadro vira frame; sem duração custom (default 100ms no header,
//   mantido pra compatibilidade com o que o desktop espera).
// - Cada célula com pixels_rgba vira cel chunk compressed image (zlib).
// - Células vazias (omitidas ou pixels_rgba null) → nenhum cel chunk emitido.
//   É o mesmo modelo que o Aseprite desktop usa pra "quadro vazio" numa camada.

export function buildAsepriteDoFrameEditor(estrutura) {
  const { largura, altura, camadas, quadros, celulas } = estrutura;
  if (!Number.isInteger(largura) || largura <= 0) throw new Error('largura inválida');
  if (!Number.isInteger(altura) || altura <= 0) throw new Error('altura inválida');
  if (!Array.isArray(camadas)) throw new Error('camadas precisa ser array');
  if (!Array.isArray(quadros)) throw new Error('quadros precisa ser array');
  if (!Array.isArray(celulas)) throw new Error('celulas precisa ser array');

  const numQuadros = quadros.length;
  const numCamadas = camadas.length;
  const defaultDurationMs = 100;

  // Index das células por (camada, quadro) pra lookup rápido na hora de emitir.
  const celulasPorChave = new Map();
  for (const cel of celulas) {
    if (cel.pixels_rgba == null) continue; // vazia → não entra no .aseprite
    const chave = `${cel.camada_indice}_${cel.quadro_indice}`;
    celulasPorChave.set(chave, cel);
  }

  const w = new ByteWriter(largura * altura * Math.max(numQuadros, 1) + 4096);

  // === Header (128 bytes) ===
  const fileSizeAt = w.placeholderU32();
  w.u16(ASE_MAGIC);
  w.u16(numQuadros);
  w.u16(largura);
  w.u16(altura);
  w.u16(32); // color depth: 32bpp RGBA
  w.u32(1); // flags: layer opacity valid
  w.u16(defaultDurationMs);
  w.u32(0); w.u32(0); // reserved
  w.u8(0); w.zeros(3); // transparent index + reserved
  w.u16(0); // num colors (palette)
  w.u8(1); w.u8(1); // pixel w/h
  w.i16(0); w.i16(0); // grid x/y
  w.u16(16); w.u16(16); // grid w/h
  w.zeros(84); // reserved
  if (w.pos !== 128) throw new Error('header size mismatch: ' + w.pos);

  // === Frames ===
  for (let qi = 0; qi < numQuadros; qi++) {
    const frameStart = w.pos;
    const frameSizeAt = w.placeholderU32();
    w.u16(FRAME_MAGIC);
    w.u16(0); // old chunks count (patch depois se couber em u16)
    w.u16(defaultDurationMs);
    w.zeros(2); // reserved
    w.u32(0); // new chunks count (patch depois)

    let chunkCount = 0;

    // Color profile + camadas só no primeiro quadro (convenção do Aseprite).
    if (qi === 0) {
      writeColorProfileChunk(w);
      chunkCount++;
      for (let ci = 0; ci < numCamadas; ci++) {
        const cam = camadas[ci];
        let flags = 0;
        if (cam.visivel !== false) flags |= LAYER_FLAG_VISIBLE;
        flags |= LAYER_FLAG_EDITABLE;
        writeLayerChunk(w, cam.nome ?? `camada ${ci}`, flags);
        chunkCount++;
      }
    }

    // Cels desta interseção (camada × quadro). Emite só os não-vazios.
    for (let ci = 0; ci < numCamadas; ci++) {
      const chave = `${ci}_${qi}`;
      const cel = celulasPorChave.get(chave);
      if (!cel) continue;
      const px = cel.pixels_rgba;
      const cw = cel.largura ?? largura;
      const ch = cel.altura ?? altura;
      if (!(px instanceof Uint8Array) && !(px instanceof Uint8ClampedArray)) {
        throw new Error(`pixels_rgba precisa ser Uint8Array (camada ${ci}, quadro ${qi})`);
      }
      if (px.length !== cw * ch * 4) {
        throw new Error(`tamanho de pixels_rgba não bate com largura×altura×4 (camada ${ci}, quadro ${qi})`);
      }
      writeCelChunk(w, ci, 0, 0, 255, cw, ch, px instanceof Uint8Array ? px : new Uint8Array(px));
      chunkCount++;
    }

    // Patch frame size + chunk counts.
    const frameSize = w.pos - frameStart;
    w.patchU32(frameSizeAt, frameSize);
    w.view.setUint16(frameStart + 6, Math.min(chunkCount, 0xFFFF), true);
    w.view.setUint32(frameStart + 12, chunkCount >>> 0, true);
  }

  w.patchU32(fileSizeAt, w.pos);
  return w.finalize();
}

function writeChunkHeader(w, type) {
  const sizeAt = w.placeholderU32();
  w.u16(type);
  return sizeAt;
}
function patchChunkSize(w, sizeAt) {
  w.patchU32(sizeAt, w.pos - sizeAt);
}
function writeColorProfileChunk(w) {
  const sizeAt = writeChunkHeader(w, CHUNK_COLOR_PROFILE);
  w.u16(1); // type sRGB
  w.u16(0); // flags
  w.u32(0); // fixed gamma
  w.zeros(8);
  patchChunkSize(w, sizeAt);
}
function writeLayerChunk(w, name, flags) {
  const sizeAt = writeChunkHeader(w, CHUNK_LAYER);
  w.u16(flags);
  w.u16(LAYER_TYPE_NORMAL);
  w.u16(0); // child level
  w.u16(0); // default w (ignored)
  w.u16(0); // default h (ignored)
  w.u16(0); // blend mode (normal)
  w.u8(255); // opacity
  w.zeros(3);
  w.str(name);
  patchChunkSize(w, sizeAt);
}
function writeCelChunk(w, layerIndex, x, y, opacity, width, height, rgbaPixels) {
  const sizeAt = writeChunkHeader(w, CHUNK_CEL);
  w.u16(layerIndex);
  w.i16(x);
  w.i16(y);
  w.u8(opacity);
  w.u16(CEL_TYPE_COMPRESSED_IMAGE);
  w.i16(0); // z-index
  w.zeros(5);
  w.u16(width);
  w.u16(height);
  w.bytes(pako.deflate(rgbaPixels));
  patchChunkSize(w, sizeAt);
}

// === Teste manual rápido (round-trip) =======================================
//
// Roda no console: `import('/js/aseprite_io.js').then(m => m._test())`.
// Retorna { ok, falhas: [...] }. Sem framework — só compara estrutura.

export function _test() {
  const falhas = [];
  const ok = (cond, msg) => { if (!cond) falhas.push(msg); };

  // === Caso 1: tirinha sintética com C=3 camadas, Q=4 quadros, células
  // esparsas (algumas vazias). ===
  const largura = 8;
  const altura = 6;
  const camadas = [
    { nome: 'fundo', ordem: 0, visivel: true },
    { nome: 'linha', ordem: 1, visivel: true },
    { nome: 'cor', ordem: 2, visivel: false },
  ];
  const quadros = [
    { indice: 0, duracao_ms: null },
    { indice: 1, duracao_ms: null },
    { indice: 2, duracao_ms: null },
    { indice: 3, duracao_ms: null },
  ];
  const celulas = [];
  // Padrão de células esparsas: (camada, quadro) → cor sólida.
  // Pula propositadamente algumas interseções pra testar células vazias.
  const padrao = [
    [0, 0, [255, 0, 0, 255]],     // fundo, quadro 0 → vermelho
    [0, 1, [0, 255, 0, 255]],     // fundo, quadro 1 → verde
    [1, 0, [0, 0, 255, 255]],     // linha, quadro 0 → azul
    [1, 2, [255, 255, 0, 255]],   // linha, quadro 2 → amarelo
    [2, 3, [128, 128, 128, 255]], // cor, quadro 3 → cinza
    // (todas as outras interseções ficam vazias)
  ];
  for (const [ci, qi, cor] of padrao) {
    const px = new Uint8Array(largura * altura * 4);
    for (let i = 0; i < largura * altura; i++) {
      px[i * 4 + 0] = cor[0];
      px[i * 4 + 1] = cor[1];
      px[i * 4 + 2] = cor[2];
      px[i * 4 + 3] = cor[3];
    }
    celulas.push({
      camada_indice: ci,
      quadro_indice: qi,
      pixels_rgba: px,
      largura,
      altura,
    });
  }

  const original = { largura, altura, camadas, quadros, celulas };

  // === Round-trip: estrutura → .aseprite → estrutura ===
  let bytes;
  try {
    bytes = buildAsepriteDoFrameEditor(original);
  } catch (err) {
    falhas.push(`writer falhou: ${err.message || err}`);
    return { ok: false, falhas };
  }

  let reparsed;
  try {
    reparsed = parseAsepriteParaFrameEditor(bytes.buffer);
  } catch (err) {
    falhas.push(`parser falhou: ${err.message || err}`);
    return { ok: false, falhas };
  }

  ok(reparsed.largura === largura, `largura: esperava ${largura}, veio ${reparsed.largura}`);
  ok(reparsed.altura === altura, `altura: esperava ${altura}, veio ${reparsed.altura}`);
  ok(reparsed.camadas.length === camadas.length,
    `# camadas: esperava ${camadas.length}, veio ${reparsed.camadas.length}`);
  ok(reparsed.quadros.length === quadros.length,
    `# quadros: esperava ${quadros.length}, veio ${reparsed.quadros.length}`);

  // Verifica nomes/visibilidade das camadas.
  for (let i = 0; i < camadas.length; i++) {
    const original = camadas[i];
    const reparseado = reparsed.camadas[i];
    if (!reparseado) { falhas.push(`camada ${i} sumiu`); continue; }
    ok(reparseado.nome === original.nome,
      `camada ${i} nome: esperava "${original.nome}", veio "${reparseado.nome}"`);
    ok(reparseado.visivel === original.visivel,
      `camada ${i} visivel: esperava ${original.visivel}, veio ${reparseado.visivel}`);
    ok(reparseado.ordem === original.ordem,
      `camada ${i} ordem: esperava ${original.ordem}, veio ${reparseado.ordem}`);
  }

  // Verifica que o número de células bate.
  ok(reparsed.celulas.length === celulas.length,
    `# celulas: esperava ${celulas.length}, veio ${reparsed.celulas.length}`);

  // Verifica fidelidade dos pixels célula a célula.
  for (const original of celulas) {
    const match = reparsed.celulas.find(c =>
      c.camada_indice === original.camada_indice &&
      c.quadro_indice === original.quadro_indice
    );
    if (!match) {
      falhas.push(`celula (cam=${original.camada_indice}, q=${original.quadro_indice}) sumiu`);
      continue;
    }
    ok(match.largura === original.largura,
      `celula (${original.camada_indice}, ${original.quadro_indice}) largura`);
    ok(match.altura === original.altura,
      `celula (${original.camada_indice}, ${original.quadro_indice}) altura`);
    if (match.pixels_rgba.length !== original.pixels_rgba.length) {
      falhas.push(`celula (${original.camada_indice}, ${original.quadro_indice}) tamanho de pixels`);
      continue;
    }
    let pxFail = 0;
    for (let i = 0; i < original.pixels_rgba.length; i++) {
      if (match.pixels_rgba[i] !== original.pixels_rgba[i]) pxFail++;
    }
    ok(pxFail === 0,
      `celula (${original.camada_indice}, ${original.quadro_indice}) pixels: ${pxFail} bytes diferentes`);
  }

  // Verifica que interseções vazias continuam vazias após round-trip.
  // Cada (cam, q) que não estava em `padrao` original deve estar ausente.
  const chavesPreenchidas = new Set(padrao.map(([ci, qi]) => `${ci}_${qi}`));
  for (let ci = 0; ci < camadas.length; ci++) {
    for (let qi = 0; qi < quadros.length; qi++) {
      const chave = `${ci}_${qi}`;
      const presente = reparsed.celulas.some(c =>
        c.camada_indice === ci && c.quadro_indice === qi
      );
      if (chavesPreenchidas.has(chave)) {
        ok(presente, `celula (${ci}, ${qi}) deveria existir`);
      } else {
        ok(!presente, `celula (${ci}, ${qi}) deveria estar vazia mas apareceu`);
      }
    }
  }

  // === Caso 2: tirinha mínima (1 camada, 1 quadro, 1 célula) ===
  const minimo = {
    largura: 2,
    altura: 2,
    camadas: [{ nome: 'única', ordem: 0, visivel: true }],
    quadros: [{ indice: 0, duracao_ms: null }],
    celulas: [{
      camada_indice: 0,
      quadro_indice: 0,
      pixels_rgba: new Uint8Array([
        255, 0, 0, 255,    0, 255, 0, 255,
        0, 0, 255, 255,  255, 255, 255, 255,
      ]),
      largura: 2,
      altura: 2,
    }],
  };
  try {
    const b2 = buildAsepriteDoFrameEditor(minimo);
    const r2 = parseAsepriteParaFrameEditor(b2.buffer);
    ok(r2.celulas.length === 1, 'caso mínimo: deve ter 1 celula');
    ok(r2.camadas[0].nome === 'única', 'caso mínimo: nome unicode preservado');
  } catch (err) {
    falhas.push(`caso mínimo: ${err.message || err}`);
  }

  // === Caso 3: tirinha sem células (todas interseções vazias) ===
  const semCelulas = {
    largura: 4,
    altura: 4,
    camadas: [
      { nome: 'a', ordem: 0, visivel: true },
      { nome: 'b', ordem: 1, visivel: true },
    ],
    quadros: [
      { indice: 0, duracao_ms: null },
      { indice: 1, duracao_ms: null },
    ],
    celulas: [],
  };
  try {
    const b3 = buildAsepriteDoFrameEditor(semCelulas);
    const r3 = parseAsepriteParaFrameEditor(b3.buffer);
    ok(r3.celulas.length === 0, 'caso sem células: deve ter 0 celulas no parsed');
    ok(r3.camadas.length === 2, 'caso sem células: 2 camadas preservadas');
    ok(r3.quadros.length === 2, 'caso sem células: 2 quadros preservados');
  } catch (err) {
    falhas.push(`caso sem células: ${err.message || err}`);
  }

  return { ok: falhas.length === 0, falhas };
}
