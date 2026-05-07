// Parser .aseprite minimalista. Extrai o que a galeria precisa pra animar a
// camada de rotoscopia: dimensões, número de frames, duração por frame, e os
// pixels RGBA da camada de cima (rotoscopia) por frame.
//
// Suporta os arquivos gerados pelo nosso writer (RGBA 32bpp, 2 layers, cels
// CEL_TYPE_COMPRESSED_IMAGE) e tolera variações típicas que o Aseprite desktop
// produz após o user editar (chunks adicionais, ordem diferente). Ignora
// chunks desconhecidos. Não lida com indexed/grayscale por enquanto — se o
// user salvar nesses modos, retorna erro claro.
//
// Depende de `window.pako` (já carregado via CDN no index.html).

const ASE_MAGIC = 0xA5E0;
const FRAME_MAGIC = 0xF1FA;
const CHUNK_LAYER  = 0x2004;
const CHUNK_CEL    = 0x2005;
const CEL_TYPE_RAW             = 0;
const CEL_TYPE_LINKED          = 1;
const CEL_TYPE_COMPRESSED_IMAGE = 2;

class ByteReader {
  constructor(buf) {
    this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    this.pos = 0;
  }
  u8()  { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  bytes(n) { const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  skip(n) { this.pos += n; }
  str() { const n = this.u16(); const v = this.bytes(n); return new TextDecoder().decode(v); }
}

// Composição de cel sobre o canvas do frame. cel é {x, y, w, h, rgba}.
// canvas é Uint8ClampedArray (frameW*frameH*4) já alocado.
function compositeCel(canvas, frameW, frameH, cel, opacity) {
  const { x, y, w, h, rgba } = cel;
  const alphaScale = opacity / 255;
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
      // alpha-over (source-over) sobre o canvas
      const da = canvas[di + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA <= 0) continue;
      const sr = rgba[si], sg = rgba[si + 1], sb = rgba[si + 2];
      const dr = canvas[di], dg = canvas[di + 1], db = canvas[di + 2];
      canvas[di + 0] = (sr * sa + dr * da * (1 - sa)) / outA;
      canvas[di + 1] = (sg * sa + dg * da * (1 - sa)) / outA;
      canvas[di + 2] = (sb * sa + db * da * (1 - sa)) / outA;
      canvas[di + 3] = outA * 255;
    }
  }
}

// Decodifica cel comprimido (zlib) → RGBA Uint8Array. Assume 32bpp.
function decodeCompressedCelRGBA(deflated, expectedBytes) {
  const inflated = pako.inflate(deflated);
  if (inflated.length < expectedBytes) {
    throw new Error(`cel descomprimido menor que esperado (${inflated.length} < ${expectedBytes})`);
  }
  return inflated.subarray(0, expectedBytes);
}

export function parseAseprite(arrayBufferOrUint8) {
  const r = new ByteReader(arrayBufferOrUint8);
  // Header (128 bytes).
  if (r.buf.length < 128) throw new Error('arquivo curto demais pra ser .aseprite');
  /* fileSize */ r.u32();
  const magic = r.u16();
  if (magic !== ASE_MAGIC) throw new Error('não é um .aseprite (magic inválido)');
  const numFrames = r.u16();
  const width = r.u16();
  const height = r.u16();
  const colorDepth = r.u16(); // 32=RGBA, 16=Grayscale, 8=Indexed
  if (colorDepth !== 32) {
    throw new Error(`color depth ${colorDepth} não suportado (precisa ser RGBA 32bpp)`);
  }
  /* flags  */ r.u32();
  const defaultDurationMs = r.u16();
  /* zero    */ r.u32(); r.u32();
  /* transparent index */ r.u8();
  r.skip(3);
  /* numColors */ r.u16();
  /* pixel w/h */ r.u8(); r.u8();
  /* grid x/y  */ r.i16(); r.i16();
  /* grid w/h  */ r.u16(); r.u16();
  r.skip(84); // reserved

  if (r.pos !== 128) throw new Error('header position drift: ' + r.pos);

  const layers = []; // [{name, flags, visible}]
  const frames = []; // [{durationMs, layerCels: Map<layerIndex, cel[]>}]

  for (let f = 0; f < numFrames; f++) {
    const frameStart = r.pos;
    const frameSize = r.u32();
    const frameMagic = r.u16();
    if (frameMagic !== FRAME_MAGIC) throw new Error(`frame ${f} magic inválido`);
    const oldChunks = r.u16();
    const frameDuration = r.u16() || defaultDurationMs || 100;
    r.skip(2);
    const newChunks = r.u32();
    const totalChunks = newChunks || oldChunks;

    const layerCels = new Map();
    for (let c = 0; c < totalChunks; c++) {
      const chunkStart = r.pos;
      const chunkSize = r.u32();
      const chunkType = r.u16();
      const chunkEnd = chunkStart + chunkSize;

      if (chunkType === CHUNK_LAYER) {
        const flags = r.u16();
        /* type */ r.u16();
        /* child level */ r.u16();
        /* default w */ r.u16();
        /* default h */ r.u16();
        /* blend */ r.u16();
        /* opacity */ r.u8();
        r.skip(3);
        const name = r.str();
        layers.push({ name, flags, visible: !!(flags & 1) });
      } else if (chunkType === CHUNK_CEL) {
        const layerIndex = r.u16();
        const x = r.i16();
        const y = r.i16();
        const opacity = r.u8();
        const celType = r.u16();
        /* z-index */ r.i16();
        r.skip(5);
        let cel = null;
        if (celType === CEL_TYPE_COMPRESSED_IMAGE) {
          const w = r.u16();
          const h = r.u16();
          const dataLen = chunkEnd - r.pos;
          const compressed = r.bytes(dataLen);
          const rgba = decodeCompressedCelRGBA(compressed, w * h * 4);
          cel = { x, y, w, h, rgba, opacity };
        } else if (celType === CEL_TYPE_RAW) {
          const w = r.u16();
          const h = r.u16();
          const rgba = r.bytes(w * h * 4);
          cel = { x, y, w, h, rgba: new Uint8Array(rgba), opacity };
        } else if (celType === CEL_TYPE_LINKED) {
          // Linked cel aponta pra outro frame; armazenamos a referência e
          // resolvemos depois.
          const linkFrame = r.u16();
          cel = { linked: true, linkFrame, opacity };
        } else {
          // tile/etc — ignora
        }
        if (cel) {
          if (!layerCels.has(layerIndex)) layerCels.set(layerIndex, []);
          layerCels.get(layerIndex).push(cel);
        }
      }

      // pula pro fim do chunk independente do que leu
      r.pos = chunkEnd;
    }

    frames.push({ durationMs: frameDuration, layerCels });
    r.pos = frameStart + frameSize;
  }

  // Resolve linked cels (copiam de outro frame, mesma layer).
  for (let f = 0; f < frames.length; f++) {
    for (const [layerIndex, cels] of frames[f].layerCels) {
      for (let i = 0; i < cels.length; i++) {
        if (!cels[i].linked) continue;
        const src = frames[cels[i].linkFrame]?.layerCels.get(layerIndex)?.[0];
        if (src && !src.linked) cels[i] = { ...src, opacity: cels[i].opacity };
      }
    }
  }

  return { width, height, numFrames, defaultDurationMs, layers, frames };
}

// Renderiza UMA layer específica em todos os frames. Retorna [{durationMs, imageData}].
// imageData é Uint8ClampedArray pronto pra <canvas> putImageData.
// Se layerIndex não tiver cel naquele frame, frame fica transparente.
export function renderLayerFrames(parsed, layerIndex) {
  const { width, height, frames } = parsed;
  const out = [];
  for (const frame of frames) {
    const canvas = new Uint8ClampedArray(width * height * 4); // zerado = transparente
    const cels = frame.layerCels.get(layerIndex);
    if (cels) {
      for (const cel of cels) {
        if (cel.linked || !cel.rgba) continue;
        compositeCel(canvas, width, height, cel, cel.opacity);
      }
    }
    out.push({ durationMs: frame.durationMs, imageData: canvas });
  }
  return out;
}

// Heurística pra escolher a layer "rotoscopia": a de índice mais alto que tem
// pelo menos um cel não-vazio em algum frame. Se nenhuma tiver pixels,
// retorna o último índice (a de cima).
export function pickRotoscopyLayer(parsed) {
  const { layers, frames } = parsed;
  for (let i = layers.length - 1; i >= 0; i--) {
    let hasContent = false;
    for (const frame of frames) {
      const cels = frame.layerCels.get(i);
      if (!cels) continue;
      for (const cel of cels) {
        if (cel.linked) continue;
        if (!cel.rgba) continue;
        // checa se existe ao menos um pixel não-transparente
        for (let p = 3; p < cel.rgba.length; p += 4) {
          if (cel.rgba[p] !== 0) { hasContent = true; break; }
        }
        if (hasContent) break;
      }
      if (hasContent) break;
    }
    if (hasContent) return i;
  }
  return layers.length - 1;
}
