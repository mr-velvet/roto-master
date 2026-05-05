// Captura de vídeo determinística + resample + overlay + buildTimeline + paintFrameToCanvas.

import { PARAMS, STATE } from './state.js';
import {
  gl, vid, fbo, prevTex,
  resizeCanvasToDims, renderShaderFrame, readPrevTexRGBA, uploadAndDrawTexture,
} from './gl.js';
import * as glmod from './gl.js';

// ========== Captura de vídeo determinística ==========
// Espera frame de vídeo realmente pintável após seek.
export function awaitSeekedWithTimeout(timeoutMs) {
  return new Promise(resolve => {
    let done = false;
    const onSeeked = () => { if (done) return; done = true; vid.removeEventListener('seeked', onSeeked); resolve(); };
    vid.addEventListener('seeked', onSeeked);
    setTimeout(() => { if (done) return; done = true; vid.removeEventListener('seeked', onSeeked); resolve(); }, timeoutMs);
  });
}
export function awaitVideoFrame() {
  const tmo = new Promise(r => setTimeout(r, 80));
  if (typeof vid.requestVideoFrameCallback === 'function') {
    const rvfc = new Promise(r => vid.requestVideoFrameCallback(() => r()));
    return Promise.race([rvfc, tmo]);
  }
  return tmo;
}
export async function seekVideoTo(timeSec) {
  const target = Math.min(Math.max(0, timeSec), Math.max(0, vid.duration - 0.001));
  const seekedP = awaitSeekedWithTimeout(1000);
  vid.currentTime = target;
  await seekedP;
  await awaitVideoFrame();
}

// Resample bilinear simples
export function resampleRGBA(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const dst = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = (y / dh) * sh;
    const y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = (x / dw) * sw;
      const x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), fx = sx - x0;
      const i00 = (y0 * sw + x0) * 4, i01 = (y0 * sw + x1) * 4;
      const i10 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const di = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = src[i00+c]*(1-fx) + src[i01+c]*fx;
        const b = src[i10+c]*(1-fx) + src[i11+c]*fx;
        dst[di+c] = Math.round(a*(1-fy) + b*fy);
      }
    }
  }
  return dst;
}

// ========== Overlay 5×7 bitmap (números 0-9 + "/" + "F") ==========
// Cada glifo é matriz 5 colunas × 7 linhas. 1 = pixel aceso.
const GLYPH_5x7 = {
  '0':[0b01110,0b10001,0b10011,0b10101,0b11001,0b10001,0b01110],
  '1':[0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110],
  '2':[0b01110,0b10001,0b00001,0b00010,0b00100,0b01000,0b11111],
  '3':[0b11111,0b00010,0b00100,0b00010,0b00001,0b10001,0b01110],
  '4':[0b00010,0b00110,0b01010,0b10010,0b11111,0b00010,0b00010],
  '5':[0b11111,0b10000,0b11110,0b00001,0b00001,0b10001,0b01110],
  '6':[0b00110,0b01000,0b10000,0b11110,0b10001,0b10001,0b01110],
  '7':[0b11111,0b00001,0b00010,0b00100,0b01000,0b01000,0b01000],
  '8':[0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110],
  '9':[0b01110,0b10001,0b10001,0b01111,0b00001,0b00010,0b01100],
  '/':[0b00001,0b00010,0b00010,0b00100,0b01000,0b01000,0b10000],
  'F':[0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b10000],
  ' ':[0,0,0,0,0,0,0],
};
// Desenha texto "FRAME k/N" no buffer RGBA in-place. Pixels amarelos com borda preta.
//
// Convenção do buffer: linha 0 = topo visual (top-down). Pra texto aparecer no
// canto superior esquerdo: escrever próximo da linha 0, glifos crescendo PARA
// BAIXO (gy crescente → linhas crescentes do array).
//
// Tamanho discreto: o overlay é só pra validar ordem de frames na edição.
export function drawOverlay(rgba, w, h, text) {
  const SCALE = Math.max(1, Math.round(Math.min(w, h) / 320));
  const charW = 5, charH = 7;
  const padX = 4 * SCALE, padY = 4 * SCALE;
  const setPixel = (x, yArray, r, g, b) => {
    if (x < 0 || yArray < 0 || x >= w || yArray >= h) return;
    const i = (yArray * w + x) * 4;
    rgba[i] = r; rgba[i+1] = g; rgba[i+2] = b; rgba[i+3] = 255;
  };
  let cx = padX;
  const charTop = padY; // topo do char fica próximo da linha 0
  for (let ci = 0; ci < text.length; ci++) {
    const ch = text[ci].toUpperCase();
    const glyph = GLYPH_5x7[ch] || GLYPH_5x7[' '];
    for (let gy = 0; gy < charH; gy++) {
      for (let gx = 0; gx < charW; gx++) {
        const lit = (glyph[gy] >> (charW - 1 - gx)) & 1;
        if (!lit) continue;
        const px0 = cx + gx * SCALE;
        const py0 = charTop + gy * SCALE; // glifo desce no array (top-down)
        for (let dy = -1; dy <= SCALE; dy++) {
          for (let dx = -1; dx <= SCALE; dx++) {
            setPixel(px0 + dx, py0 + dy, 0, 0, 0);
          }
        }
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            setPixel(px0 + dx, py0 + dy, 255, 255, 0);
          }
        }
      }
    }
    cx += (charW + 1) * SCALE;
  }
}

// ========== Geração da timeline (modo rotoscope) ==========
// Constrói o array `STATE.frames[]` discreto sobre o trecho [STATE.inS, STATE.outS].
// N = (out - in) × fps. Cada frame i corresponde ao tempo `in + i/fps` no vídeo.
export async function buildTimeline(onProgress) {
  if (!isFinite(vid.duration) || vid.duration <= 0) {
    throw new Error('vídeo ainda não carregou');
  }
  // Tudo vindo de STATE — UI atualiza STATE em listeners; restore via
  // applyEditState também escreve em STATE *e* sincroniza DOM.
  const fps = STATE.fps;
  const scale = STATE.scale;
  const overlay = STATE.overlay;
  const inS = STATE.inS;
  const outS = STATE.outS;
  if (!(fps > 0) || !(scale > 0)) throw new Error('parâmetros inválidos');
  if (!(outS > inS)) throw new Error('marcador out deve estar depois do in');

  const totalDur = outS - inS;
  const N = Math.max(1, Math.round(totalDur * fps));
  const sw = vid.videoWidth || 960;
  const sh = vid.videoHeight || 528;
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const frameDurationMs = Math.max(1, Math.round(1000 / fps));

  resizeCanvasToDims(sw, sh);
  vid.pause();

  // Limpar prevTex pra captura ser determinística (feedback parte de zero)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, glmod.prevTex, 0);
  gl.viewport(0, 0, sw, sh);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Limpar TAMBÉM o fbTex (não só prevTex) — a 2ª build começa com swap em
  // estado X residual da 1ª, e a textura agora-fbTex pode ter conteúdo antigo.
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, glmod.fbTex, 0);
  gl.viewport(0, 0, sw, sh);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const frames = new Array(N);
  for (let i = 0; i < N; i++) {
    const tVid = inS + i / fps;
    await seekVideoTo(tVid);
    // Cada chamada de renderShaderFrame faz swap [prevTex,fbTex] — uma chamada
    // por frame: lê prev (resultado anterior, ou clear no frame 0), escreve em
    // fb, swap, e a leitura via readPrevTexRGBA pega o último escrito.
    renderShaderFrame(i, fps);
    const raw = readPrevTexRGBA(sw, sh);
    const out = (sw === dw && sh === dh) ? raw : resampleRGBA(raw, sw, sh, dw, dh);
    if (overlay) drawOverlay(out, dw, dh, `FRAME ${i+1}/${N}`);
    frames[i] = out;
    if (onProgress) onProgress(i + 1, N);
    if ((i & 3) === 3) await new Promise(r => setTimeout(r, 0));
  }

  STATE.frames = frames;
  STATE.fps = fps;
  STATE.scale = scale;
  STATE.overlay = overlay;
  STATE.dw = dw;
  STATE.dh = dh;
  STATE.frameDurationMs = frameDurationMs;
  STATE.paramsAtBuild = JSON.stringify(PARAMS);
  STATE.dirty = false;
  STATE.playIdx = 0;

  resizeCanvasToDims(dw, dh);

  return { N, dw, dh, frameDurationMs };
}

// Pinta um frame do array no canvas (via plain shader).
let blitCanvas = null;
let blitCtx = null;
export function paintFrameToCanvas(idx) {
  if (!STATE.frames.length) return;
  const f = STATE.frames[idx];
  const w = STATE.dw, h = STATE.dh;
  if (!blitCanvas || blitCanvas.width !== w || blitCanvas.height !== h) {
    blitCanvas = document.createElement('canvas');
    blitCanvas.width = w; blitCanvas.height = h;
    blitCtx = blitCanvas.getContext('2d');
  }
  const imageData = blitCtx.createImageData(w, h);
  imageData.data.set(f);
  blitCtx.putImageData(imageData, 0, 0);
  uploadAndDrawTexture(f, w, h);
}
