// Transport / mode loops.
// Dependências de UI (setProgress, updateInfo) e DOM ($btnPlay) são injetadas via bindUI()
// pra evitar import circular com ui.js.

import { STATE } from './state.js';
import { gl, vid, buf, canvas, ensurePlainProg, resizeCanvasToDims, renderShaderFrame } from './gl.js';
import * as glmod from './gl.js';
import { buildTimeline, paintFrameToCanvas } from './capture.js';

let _setProgress = () => {};
let _updateInfo = () => {};
let _btnPlay = null;
let _btnExport = null;
let _modeTabs = null;

export function bindUI(deps) {
  _setProgress = deps.setProgress;
  _updateInfo = deps.updateInfo;
  _btnPlay = deps.$btnPlay;
  _btnExport = deps.$btnExport;
  _modeTabs = deps.$modeTabs;
}

// ---- Modo source: preview com shader principal em tempo real ----
// Mesma lógica do build (`renderShaderFrame` aplica PARAMS no FBO e faz swap
// prevTex↔fbTex pra alimentar feedback temporal), mas a cada tick blita o
// resultado pro canvas via plainProg lendo `prevTex` (que após o swap contém
// o frame recém-renderizado). Sliders/presets/feedback refletem ao vivo.
let sourceRAF = 0;
let sourceFrameIdx = 0;
let sourcePrevCleared = false;
export function startSourceLoop() {
  cancelAnimationFrame(sourceRAF);
  sourceFrameIdx = 0;
  sourcePrevCleared = false;
  const tick = () => {
    if (STATE.mode !== 'source') return;
    if (vid.currentTime >= STATE.outS) {
      try { vid.currentTime = STATE.inS; } catch(e) {}
    }
    if (vid.readyState >= 2 && vid.videoWidth > 0) {
      // Sincroniza dimensões do canvas/FBO/prev com o vídeo. Idempotente.
      if (canvas.width !== vid.videoWidth || canvas.height !== vid.videoHeight) {
        resizeCanvasToDims(vid.videoWidth, vid.videoHeight);
        sourcePrevCleared = false;
      }
      // Limpa prev/fb texture conteúdo lixo na primeira iteração depois de
      // resize. Sem isso, feedback>0 amostra random ↦ tela cinza/colorida.
      if (!sourcePrevCleared) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, glmod.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, glmod.prevTex, 0);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, glmod.fbTex, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        sourcePrevCleared = true;
      }

      // 1) Render do shader principal no FBO (feedback ativo via prevTex).
      // renderShaderFrame faz: useProgram(prog), upload do <video>, render em
      // fbTex, e swap [prevTex,fbTex] = [fbTex,prevTex] no fim.
      renderShaderFrame(sourceFrameIdx, 30);

      // 2) Blit pro canvas (FBO=null) via plainProgFlipped lendo prevTex.
      // Por que flippado: o render principal (renderShaderFrame) já escreve
      // no FBO com orientação visual correta (FLIP_Y=true no upload + flip
      // no VS principal). Ler com VS plain "comum" inverteria de volta. O
      // VS flippado neutraliza esse efeito apenas no caminho FBO→canvas.
      ensurePlainProg();
      gl.useProgram(glmod.plainProgFlipped);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const aPos2 = gl.getAttribLocation(glmod.plainProgFlipped, 'a_pos');
      gl.enableVertexAttribArray(aPos2);
      gl.vertexAttribPointer(aPos2, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glmod.prevTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.uniform1i(gl.getUniformLocation(glmod.plainProgFlipped, 'u_tex'), 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      sourceFrameIdx++;
    }
    _updateInfo();
    sourceRAF = requestAnimationFrame(tick);
  };
  sourceRAF = requestAnimationFrame(tick);
}
export function stopSourceLoop() {
  cancelAnimationFrame(sourceRAF);
  sourceRAF = 0;
}

// ---- Modo rotoscope: build + play frame-a-frame ----
export async function ensureBuilt() {
  if (!STATE.dirty && STATE.frames.length) return;
  _setProgress('<span class="stage">Construindo timeline…</span>', 0);
  _btnPlay.disabled = true;
  _btnExport.disabled = true;
  try {
    const info = await buildTimeline((i, n) => {
      _setProgress(`<span class="stage">Construindo</span> ${i}/${n}`, (i / n) * 100);
    });
    _setProgress(`<span class="ok">✓ Timeline pronta</span> · ${info.N} frames · ${info.dw}×${info.dh} · ${info.frameDurationMs}ms cada`, 100);
    paintFrameToCanvas(0);
    _updateInfo();
    const $rotoEmpty = document.getElementById('rotoscope-empty');
    if ($rotoEmpty) $rotoEmpty.setAttribute('hidden', '');
  } finally {
    _btnPlay.disabled = false;
    _btnExport.disabled = false;
  }
}

let playRAF = 0;
export function startRotoscopePlay() {
  if (!STATE.frames.length) return;
  STATE.playing = true;
  STATE.playStartMs = performance.now() - (STATE.playIdx * STATE.frameDurationMs);
  _btnPlay.classList.add('playing');
  _btnPlay.textContent = '■ pause';
  const tick = () => {
    if (!STATE.playing) return;
    const elapsed = performance.now() - STATE.playStartMs;
    const idx = Math.floor(elapsed / STATE.frameDurationMs) % STATE.frames.length;
    if (idx !== STATE.playIdx) {
      STATE.playIdx = idx;
      paintFrameToCanvas(idx);
      _updateInfo();
    }
    playRAF = requestAnimationFrame(tick);
  };
  playRAF = requestAnimationFrame(tick);
}
export function stopRotoscopePlay() {
  STATE.playing = false;
  cancelAnimationFrame(playRAF);
  playRAF = 0;
  _btnPlay.classList.remove('playing');
  _btnPlay.textContent = STATE.dirty ? '▶ build & play' : '▶ play';
}
export function stopPlay() {
  if (STATE.mode === 'source') {
    try { vid.pause(); } catch(e) {}
    _btnPlay.classList.remove('playing');
    _btnPlay.textContent = '▶ play';
  } else {
    stopRotoscopePlay();
  }
}

// Aplica o modo SEM checar se mudou. Usado pelo boot e pelo setMode.
function applyMode(mode) {
  STATE.mode = mode;
  _modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  const $rotoEmpty = document.getElementById('rotoscope-empty');
  if (mode === 'source') {
    stopRotoscopePlay();
    resizeCanvasToDims(vid.videoWidth || 960, vid.videoHeight || 528);
    try { vid.currentTime = Math.max(STATE.inS, Math.min(vid.currentTime, STATE.outS)); } catch(e) {}
    _btnPlay.textContent = '▶ play';
    _setProgress('<span class="stage">Modo vídeo original.</span> Use os marcadores in/out pra delimitar trecho.', 0);
    if ($rotoEmpty) $rotoEmpty.setAttribute('hidden', '');
    startSourceLoop();
  } else {
    stopSourceLoop();
    try { vid.pause(); } catch(e) {}
    if (STATE.frames.length && !STATE.dirty) {
      resizeCanvasToDims(STATE.dw, STATE.dh);
      paintFrameToCanvas(STATE.playIdx);
      if ($rotoEmpty) $rotoEmpty.setAttribute('hidden', '');
    } else if ($rotoEmpty) {
      $rotoEmpty.removeAttribute('hidden');
    }
    _btnPlay.textContent = STATE.dirty || !STATE.frames.length ? '▶ build & play' : '▶ play';
    _setProgress(STATE.dirty || !STATE.frames.length
      ? '<span class="stage">Modo rotoscopia.</span> Clique play pra construir frames discretos.'
      : '<span class="ok">✓ Timeline pronta.</span> Play pra reproduzir, exportar pro .aseprite.', 0);
  }
  _updateInfo();
}

// API pública: troca de modo via UI (idempotente — não-op se já no modo).
export function setMode(mode) {
  if (STATE.mode === mode) return;
  stopPlay();
  applyMode(mode);
}

// Boot: força aplicação do modo no startup, mesmo se igual ao default do STATE.
export function bootMode(mode) {
  applyMode(mode);
}
