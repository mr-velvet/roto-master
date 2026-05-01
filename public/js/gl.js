// Bootstrap WebGL + render path + plain shader + pixel IO.
// Único dono dos recursos GL. Carregado uma vez (top-level side effects).

import { PARAMS } from './state.js';
import { VS_SRC, FS_SRC } from './shaders.js';

export const canvas = document.getElementById('gl');
export const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
if (!gl) { alert('WebGL não suportado'); }

export function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
  return s;
}
const vs = compile(gl.VERTEX_SHADER, VS_SRC);
const fs = compile(gl.FRAGMENT_SHADER, FS_SRC);
export const prog = gl.createProgram();
gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);

export const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'a_pos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

export const vid = document.getElementById('vid');
export const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

export let prevTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, prevTex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));

export let fbTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, fbTex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

export const fbo = gl.createFramebuffer();

export const U = {};
['u_tex','u_prev','u_time','u_res','u_wave','u_chroma','u_scan','u_bulge','u_glitch','u_feedback','u_invert','u_pixelate','u_vignette','u_noise','u_hue','u_tint_r','u_tint_g','u_tint_b']
  .forEach(n => U[n] = gl.getUniformLocation(prog, n));

export function resizeCanvasToDims(w, h) {
  const wrap = canvas.parentElement;
  const aspect = w / h;
  const maxW = wrap.clientWidth;
  const maxH = wrap.clientHeight;
  let dispW = maxW, dispH = dispW / aspect;
  if (dispH > maxH) { dispH = maxH; dispW = dispH * aspect; }
  canvas.style.width = dispW + 'px';
  canvas.style.height = dispH + 'px';
  canvas.width = w;
  canvas.height = h;
  gl.bindTexture(gl.TEXTURE_2D, fbTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
}

// Renderiza um frame específico do shader.
// `<video>` em alguns browsers entra invertido vertical em texImage2D sem flip
// (vs canvas 2D que entra natural). Forçamos UNPACK_FLIP_Y_WEBGL=true só pro
// upload do vídeo pra orientação ficar consistente com o resto do pipeline.
export function renderShaderFrame(frameIndex, fps) {
  if (vid.readyState >= 2) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.u_tex, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prevTex); gl.uniform1i(U.u_prev, 1);

  gl.uniform1f(U.u_time, frameIndex / fps);
  gl.uniform2f(U.u_res, canvas.width, canvas.height);
  gl.uniform1f(U.u_wave,     PARAMS.wave);
  gl.uniform1f(U.u_chroma,   PARAMS.chroma);
  gl.uniform1f(U.u_scan,     PARAMS.scan);
  gl.uniform1f(U.u_bulge,    PARAMS.bulge);
  gl.uniform1f(U.u_glitch,   PARAMS.glitch);
  gl.uniform1f(U.u_feedback, PARAMS.feedback);
  gl.uniform1f(U.u_invert,   PARAMS.invert);
  gl.uniform1f(U.u_pixelate, PARAMS.pixelate);
  gl.uniform1f(U.u_vignette, PARAMS.vignette);
  gl.uniform1f(U.u_noise,    PARAMS.noise);
  gl.uniform1f(U.u_hue,      PARAMS.hue);
  gl.uniform1f(U.u_tint_r,   PARAMS.tint_r);
  gl.uniform1f(U.u_tint_g,   PARAMS.tint_g);
  gl.uniform1f(U.u_tint_b,   PARAMS.tint_b);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  // swap pra prev pra próximo frame ter feedback
  [prevTex, fbTex] = [fbTex, prevTex];
}

// Lê o último FBO renderizado (que após swap ficou em prevTex).
// Mantém Y nativo do GL (bottom-up). Pintura na tela usa UNPACK_FLIP_Y_WEBGL
// pra mostrar correto. Flip pra top-down só acontece no momento de escrever
// o cel chunk do .aseprite (em buildAseprite).
export function readPrevTexRGBA(w, h) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, prevTex, 0);
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}
// Flip vertical de buffer RGBA WxH (pra hora de escrever no .aseprite).
export function flipYRGBA(src, w, h) {
  const dst = new Uint8Array(src.length);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const sy = (h - 1 - y) * stride;
    const dy = y * stride;
    dst.set(src.subarray(sy, sy + stride), dy);
  }
  return dst;
}

// ========== Plain shader (passthrough sem efeito) ==========
// O RGBA chega bottom-up (linha 0 = base visual da imagem) — é o que `readPrevTexRGBA`
// retorna após o pipeline efeito (validado pelo test-orientation.html).
// Pra mostrar correto: VS sem flip de v_uv.y, e upload SEM UNPACK_FLIP_Y_WEBGL —
// linha 0 do buffer (base visual) vai pra texture y=0 (bottom da textura), shader
// sample em v_uv.y=0 (bottom canvas) → tex y=0 → base visual. Identidade.
export let plainProg = null;
export let plainTex = null;
export function ensurePlainProg() {
  if (plainProg) return;
  const pvs = compile(gl.VERTEX_SHADER, `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }
  `);
  const pfs = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    void main() { gl_FragColor = texture2D(u_tex, v_uv); }
  `);
  plainProg = gl.createProgram();
  gl.attachShader(plainProg, pvs); gl.attachShader(plainProg, pfs); gl.linkProgram(plainProg);
  plainTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, plainTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}
export function uploadAndDrawTexture(rgba, w, h) {
  ensurePlainProg();
  gl.useProgram(plainProg);
  const aPos2 = gl.getAttribLocation(plainProg, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(aPos2);
  gl.vertexAttribPointer(aPos2, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, plainTex);
  // RGBA está em GL natural (bottom-up): linha 0 = base visual. Sem flip no upload.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  gl.uniform1i(gl.getUniformLocation(plainProg, 'u_tex'), 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.useProgram(prog);
}
