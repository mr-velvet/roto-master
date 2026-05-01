// =============================================================
//  ROTOSCOPE PoC — TRANSPORT ÚNICO (princípio WYSIWYG)
//  -----------------------------------------------------------
//  Não existe RAF contínuo a 60fps. Existe um array `frames[]` de
//  N RGBA buffers que é regenerado quando duração ou fps mudam.
//  Play, scrub e export consomem EXATAMENTE o mesmo array.
// =============================================================

import { STATE } from './state.js';
import { vid, resizeCanvasToDims } from './gl.js';
import { bindUI as bindPlaybackUI, bootMode } from './playback.js';
import {
  buildUI, wireHandlers, setProgress, initRangeUI, refreshRangeUI, updateInfo, dom,
} from './ui.js';

// 1) Construir UI (presets + sliders)
buildUI();

// 2) Injetar callbacks de UI no playback (evita import circular)
bindPlaybackUI({
  setProgress, updateInfo,
  $btnPlay: dom.$btnPlay,
  $btnExport: dom.$btnExport,
  $modeTabs: dom.$modeTabs,
});

// 3) Wire de event handlers (play, range, export, resize)
wireHandlers();

// 4) Inicializar quando metadata do vídeo estiver pronta
function onMetadataReady() {
  STATE.videoDurS = vid.duration;
  // defaults razoáveis: in=0, out=min(3, duração total)
  STATE.inS = 0;
  STATE.outS = Math.min(3, vid.duration);
  resizeCanvasToDims(vid.videoWidth, vid.videoHeight);
  initRangeUI();
  refreshRangeUI();
  setProgress('<span class="stage">Vídeo carregado.</span> Use os marcadores pra delimitar trecho, depois mude pra "rotoscopia" e exporte.', 0);
  updateInfo();
  bootMode('source');
}
if (vid.readyState >= 1 && isFinite(vid.duration) && vid.duration > 0) {
  onMetadataReady();
} else {
  vid.addEventListener('loadedmetadata', onMetadataReady);
}
