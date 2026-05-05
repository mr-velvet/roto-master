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
// Pra evitar leak de estado global pra outras chamadas que dependem de
// FLIP_Y=false (ex.: `uploadAndDrawTexture`), fechamos o ciclo set→reset
// EM TODA chamada e também forçamos useProgram(prog) na entrada — caller pode
// ter deixado plainProg ativo.
export function renderShaderFrame(frameIndex, fps) {
  gl.useProgram(prog);
  // re-bind do attribute do quad — outros programs podem ter mudado o vertex pointer
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const aPosLoc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPosLoc);
  gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

  // defesa: começa em FLIP_Y=false antes de tocar em qualquer textura
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

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
// Convenção do array retornado: TOP-DOWN (linha 0 = topo visual). Resultado
// do conjunto pipeline: upload do <video> com UNPACK_FLIP_Y=true coloca a
// linha 0 da textura como bottom visual; o VS principal flippa v_uv.y; o
// quad é renderizado de tal forma que pixels do topo visual ficam em
// y_FBO=0 (que é o que readPixels lê primeiro). Esse é o formato direto
// que .aseprite espera — não precisa de flip extra.
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
// Existem dois variants:
//   plainProg        — VS sem flip de v_uv.y. Não usado pelo pipeline atual.
//                      Mantido caso alguém queira blit "raw" de uma textura.
//   plainProgFlipped — VS com `v_uv.y = 1.0 - v_uv.y`. Usado em:
//                        - paintFrameToCanvas (rotoscope): texImage2D do
//                          array TOP-DOWN, blit pro canvas.
//                        - source loop (preview): blit FBO→canvas após
//                          renderShaderFrame.
// Os dois caminhos têm dado em "top-down do conteúdo visual" e precisam do
// flip pra mostrar com topo visual no topo da tela.
export let plainProg = null;
export let plainTex = null;
export let plainProgFlipped = null;
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

  const pvsFlip = compile(gl.VERTEX_SHADER, `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() { v_uv = a_pos * 0.5 + 0.5; v_uv.y = 1.0 - v_uv.y; gl_Position = vec4(a_pos, 0.0, 1.0); }
  `);
  plainProgFlipped = gl.createProgram();
  gl.attachShader(plainProgFlipped, pvsFlip); gl.attachShader(plainProgFlipped, pfs); gl.linkProgram(plainProgFlipped);

  plainTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, plainTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}
export function uploadAndDrawTexture(rgba, w, h) {
  ensurePlainProg();
  // Usa o plain shader FLIPPADO pra render no canvas. O array RGBA chega de
  // readPixels (linha 0 = bottom-left do FBO = topo visual no caso do nosso
  // pipeline). Sem flip o canvas mostraria de cabeça pra baixo.
  // O export pra .aseprite continua flipando o array pq o formato espera
  // top-down — flip aqui é só pra tela.
  gl.useProgram(plainProgFlipped);
  const aPos2 = gl.getAttribLocation(plainProgFlipped, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(aPos2);
  gl.vertexAttribPointer(aPos2, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, plainTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  gl.uniform1i(gl.getUniformLocation(plainProgFlipped, 'u_tex'), 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.useProgram(prog);
}
