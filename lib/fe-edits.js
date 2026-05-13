// Frames Editor — edicoes locais (sem provider de IA).
//
// Espelha lib/fe-prompts.js mas a transformacao roda CPU local em vez de
// chamar Fal. Tudo o resto eh igual: marca celula 'processando', grava
// versao anterior em fe_celula_versao (op_type='dither'|'adjust'), sobe
// PNG novo no GCS, atualiza fe_celula. Erros voltam estado pra idle com
// estado_erro preenchido.
//
// Algoritmos:
//   - Pixelate (resize-down nearest + resize-up nearest)
//   - Dithering: Floyd-Steinberg, Atkinson, Bayer 4x4, Bayer 8x8, quantize-only
//   - Ajustes: brilho, contraste, saturacao
//
// Concorrencia maior que IA — sao operacoes CPU puras, ~50-500ms cada.

const crypto = require('crypto');
const { decodeRGBA, encodeRGBA } = require('./png-resize');
const { uploadBuffer } = require('./gcs');
const { resolverPaleta, PALETTES_LIST } = require('./fe-palettes');

const CONCURRENCY = 8;

// Operacoes expostas pro frontend popular o dropdown.
const FE_EDIT_OPS = [
  {
    key: 'dither',
    label: 'Dithering / Pixel art',
    sub: 'reduz cor, opcionalmente pixeliza antes',
    hint: 'local, instantaneo, ideal pra estetica retro',
  },
  {
    key: 'adjust',
    label: 'Ajustes basicos',
    sub: 'brilho, contraste, saturacao',
    hint: 'local, instantaneo',
  },
];

function gcsPathParaCelula(tirinhaId, celulaId) {
  const dia = new Date().toISOString().slice(0, 10);
  const hash = crypto.randomBytes(3).toString('hex');
  return `frame-editor/tirinhas/${tirinhaId}/celulas/${celulaId}/${dia}-${hash}.png`;
}

// ====== Algoritmos ======

// Pixelate por reducao nearest. Volta no mesmo tamanho — apenas perde detalhe.
// tamanho = lado do bloco em pixels. Ex: tamanho=8 num PNG 1920x1080 simula
// como se fosse 240x135 escalado de volta.
function aplicarPixelate(rgba, w, h, tamanho) {
  const t = Math.max(2, Math.min(64, Math.floor(tamanho)));
  const out = Buffer.alloc(rgba.length);
  for (let blockY = 0; blockY < h; blockY += t) {
    for (let blockX = 0; blockX < w; blockX += t) {
      // amostra centro do bloco
      const sx = Math.min(blockX + (t >> 1), w - 1);
      const sy = Math.min(blockY + (t >> 1), h - 1);
      const si = (sy * w + sx) * 4;
      const r = rgba[si], g = rgba[si + 1], b = rgba[si + 2], a = rgba[si + 3];
      const yMax = Math.min(blockY + t, h);
      const xMax = Math.min(blockX + t, w);
      for (let y = blockY; y < yMax; y++) {
        for (let x = blockX; x < xMax; x++) {
          const di = (y * w + x) * 4;
          out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = a;
        }
      }
    }
  }
  return out;
}

function corMaisProxima(r, g, b, paleta) {
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < paleta.length; i++) {
    const c = paleta[i];
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return paleta[bestIdx];
}

// Floyd-Steinberg: erro propagado em padrao
//   *   7/16
// 3/16 5/16 1/16
function ditherFloydSteinberg(rgba, w, h, paleta) {
  const out = Buffer.from(rgba); // copia mutavel
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const oldR = out[i], oldG = out[i + 1], oldB = out[i + 2];
      const nc = corMaisProxima(oldR, oldG, oldB, paleta);
      out[i] = nc[0]; out[i + 1] = nc[1]; out[i + 2] = nc[2];
      const errR = oldR - nc[0], errG = oldG - nc[1], errB = oldB - nc[2];
      propagar(out, w, h, x + 1, y,     errR, errG, errB, 7 / 16);
      propagar(out, w, h, x - 1, y + 1, errR, errG, errB, 3 / 16);
      propagar(out, w, h, x,     y + 1, errR, errG, errB, 5 / 16);
      propagar(out, w, h, x + 1, y + 1, errR, errG, errB, 1 / 16);
    }
  }
  return out;
}

// Atkinson: 6 vizinhos, 1/8 cada (perde 25% do erro — aspecto classico Mac)
//        *    1/8  1/8
//  1/8  1/8  1/8
//        1/8
function ditherAtkinson(rgba, w, h, paleta) {
  const out = Buffer.from(rgba);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const oldR = out[i], oldG = out[i + 1], oldB = out[i + 2];
      const nc = corMaisProxima(oldR, oldG, oldB, paleta);
      out[i] = nc[0]; out[i + 1] = nc[1]; out[i + 2] = nc[2];
      const errR = oldR - nc[0], errG = oldG - nc[1], errB = oldB - nc[2];
      const f = 1 / 8;
      propagar(out, w, h, x + 1, y,     errR, errG, errB, f);
      propagar(out, w, h, x + 2, y,     errR, errG, errB, f);
      propagar(out, w, h, x - 1, y + 1, errR, errG, errB, f);
      propagar(out, w, h, x,     y + 1, errR, errG, errB, f);
      propagar(out, w, h, x + 1, y + 1, errR, errG, errB, f);
      propagar(out, w, h, x,     y + 2, errR, errG, errB, f);
    }
  }
  return out;
}

function propagar(buf, w, h, x, y, errR, errG, errB, fator) {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i]     = clamp255(buf[i]     + errR * fator);
  buf[i + 1] = clamp255(buf[i + 1] + errG * fator);
  buf[i + 2] = clamp255(buf[i + 2] + errB * fator);
}

function clamp255(v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v | 0;
}

// Bayer ordered dithering — usa matriz de threshold fixa, sem propagacao.
// Cada celula da matriz indica um offset (-0.5..+0.5) somado ao pixel antes
// de quantizar. Resultado eh um padrao de pontos regular, sem ruido.
const BAYER_4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];
const BAYER_8 = [
  [ 0, 32,  8, 40,  2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44,  4, 36, 14, 46,  6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [ 3, 35, 11, 43,  1, 33,  9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47,  7, 39, 13, 45,  5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

function ditherBayer(rgba, w, h, paleta, matriz) {
  const out = Buffer.from(rgba);
  const tam = matriz.length;
  // Normaliza pra ganho ~ 32 (em escala 0-255). Quanto maior o ganho, mais
  // visivel o padrao; 32 funciona bem pra paletas tipicas.
  const ganho = 32;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const threshold = matriz[y % tam][x % tam] / (tam * tam) - 0.5; // -0.5..+0.5
      const adj = threshold * ganho;
      const nc = corMaisProxima(
        clamp255(out[i] + adj),
        clamp255(out[i + 1] + adj),
        clamp255(out[i + 2] + adj),
        paleta
      );
      out[i] = nc[0]; out[i + 1] = nc[1]; out[i + 2] = nc[2];
    }
  }
  return out;
}

// Quantize sem dithering — so mapeia cada pixel pra cor mais proxima da paleta.
function quantizeOnly(rgba, w, h, paleta) {
  const out = Buffer.from(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const nc = corMaisProxima(out[i], out[i + 1], out[i + 2], paleta);
    out[i] = nc[0]; out[i + 1] = nc[1]; out[i + 2] = nc[2];
  }
  return out;
}

// Ajustes basicos. Brilho, contraste e saturacao tipo Photoshop — escalas -100..+100.
//   brilho:    soma offset (-128..+128) em cada canal
//   contraste: aplica fator em torno do meio (128)
//   saturacao: interpola entre cor e luma (-100 = grayscale, +100 = saturado x2)
function aplicarAjustes(rgba, w, h, { brilho = 0, contraste = 0, saturacao = 0 } = {}) {
  const out = Buffer.from(rgba);
  // Pre-calcula fatores
  const b = (brilho / 100) * 128;       // -128..+128
  const c = (contraste / 100);          // -1..+1
  const fatorContraste = (1.0157 * (c * 255 + 255)) / (255 * (1.0157 - c)); // formula Photoshop-ish
  const s = 1 + (saturacao / 100);      // 0..2
  for (let i = 0; i < out.length; i += 4) {
    let r = out[i], g = out[i + 1], bl = out[i + 2];
    // brilho
    r += b; g += b; bl += b;
    // contraste em torno de 128
    r = (r - 128) * fatorContraste + 128;
    g = (g - 128) * fatorContraste + 128;
    bl = (bl - 128) * fatorContraste + 128;
    // saturacao via luma
    const luma = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = luma + (r - luma) * s;
    g = luma + (g - luma) * s;
    bl = luma + (bl - luma) * s;
    out[i] = clamp255(r); out[i + 1] = clamp255(g); out[i + 2] = clamp255(bl);
  }
  return out;
}

// ====== Orquestracao ======

async function baixarPng(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`png GET ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function processarEdicao(pool, celulaId, opType, opParams, usarOriginal = false) {
  // Carrega estado atual da celula.
  const { rows } = await pool.query(
    `SELECT id, tirinha_id, png_url, png_url_original, largura, altura
       FROM fe_celula WHERE id = $1`,
    [celulaId]
  );
  if (!rows.length) return { ok: false, error: 'célula sumiu' };
  const cel = rows[0];

  try {
    const refUrl = usarOriginal ? (cel.png_url_original || cel.png_url) : cel.png_url;
    if (!refUrl) throw new Error('célula sem imagem — nada pra editar');

    const inputBuf = await baixarPng(refUrl);
    const decoded = decodeRGBA(inputBuf);
    if (!decoded) throw new Error('PNG em formato n~ao suportado (precisa RGBA 8bpp, sem interlace)');
    const { width, height, rgba } = decoded;

    let outRgba = rgba;
    if (opType === 'dither') {
      // 1) pixelate opcional
      if (opParams.pixelate && opParams.pixelate.tamanho) {
        outRgba = aplicarPixelate(outRgba, width, height, opParams.pixelate.tamanho);
      }
      // 2) resolve paleta (k-means usa o rgba pre-quantizado pra escolher cores)
      const paletaObj = resolverPaleta(opParams.paleta || 'bw', opParams.niveis, outRgba);
      const paleta = paletaObj.cores;
      // 3) escolhe algoritmo
      const algo = opParams.algoritmo || 'floyd-steinberg';
      if (algo === 'floyd-steinberg') outRgba = ditherFloydSteinberg(outRgba, width, height, paleta);
      else if (algo === 'atkinson') outRgba = ditherAtkinson(outRgba, width, height, paleta);
      else if (algo === 'bayer4') outRgba = ditherBayer(outRgba, width, height, paleta, BAYER_4);
      else if (algo === 'bayer8') outRgba = ditherBayer(outRgba, width, height, paleta, BAYER_8);
      else if (algo === 'none') outRgba = quantizeOnly(outRgba, width, height, paleta);
      else throw new Error(`algoritmo '${algo}' desconhecido`);
    } else if (opType === 'adjust') {
      outRgba = aplicarAjustes(outRgba, width, height, opParams || {});
    } else {
      throw new Error(`op_type '${opType}' n~ao suportado`);
    }

    const outBuf = encodeRGBA(width, height, outRgba);
    const dstPath = gcsPathParaCelula(cel.tirinha_id, cel.id);
    const stored = await uploadBuffer(dstPath, outBuf, 'image/png');

    // Versao anterior vai pro historico antes de sobrescrever png_url.
    await pool.query(
      `INSERT INTO fe_celula_versao (celula_id, png_url, largura, altura, prompt, model_key, op_type, op_params)
       VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6)`,
      [cel.id, cel.png_url, cel.largura, cel.altura, opType, { ...opParams, usar_original: usarOriginal }]
    );

    await pool.query(
      `UPDATE fe_celula
          SET png_url = $1,
              largura = $2,
              altura = $3,
              estado = 'idle',
              estado_erro = NULL,
              estado_atualizado_em = NOW(),
              updated_at = NOW()
        WHERE id = $4`,
      [stored.gcs_url, width, height, cel.id]
    );

    await pool.query(`UPDATE fe_tirinha SET updated_at = NOW() WHERE id = $1`, [cel.tirinha_id]);
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) ? e.message.slice(0, 500) : 'erro desconhecido';
    console.error(`fe-edit celula ${celulaId}:`, msg);
    await pool.query(
      `UPDATE fe_celula
          SET estado = 'idle',
              estado_erro = $1,
              estado_atualizado_em = NOW()
        WHERE id = $2`,
      [msg, celulaId]
    );
    return { ok: false, error: msg };
  }
}

async function processarEdicaoLote(pool, celulasIds, opType, opParams, usarOriginal = false) {
  console.log(`[fe-edits] lote ${celulasIds.length} celulas · op=${opType} · concorrencia=${CONCURRENCY}`);
  const fila = [...celulasIds];
  const workers = Array.from({ length: Math.min(CONCURRENCY, fila.length) }, async () => {
    while (fila.length > 0) {
      const id = fila.shift();
      if (!id) break;
      await processarEdicao(pool, id, opType, opParams, usarOriginal);
    }
  });
  await Promise.allSettled(workers);
}

module.exports = {
  processarEdicaoLote,
  FE_EDIT_OPS,
  PALETTES_LIST,
};
