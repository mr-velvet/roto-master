// =============================================================
//  ROTOSCOPE PoC — TRANSPORT ÚNICO (princípio WYSIWYG)
//  -----------------------------------------------------------
//  Não existe RAF contínuo a 60fps. Existe um array `frames[]` de
//  N RGBA buffers que é regenerado quando duração ou fps mudam.
//  Play, scrub e export consomem EXATAMENTE o mesmo array.
// =============================================================

import { STATE } from './state.js';
import { bindUI as bindPlaybackUI, bootMode } from './playback.js';
import {
  buildUI, wireHandlers, setProgress, initRangeUI, refreshRangeUI, updateInfo, dom,
} from './ui.js';
import { initFileLoader, bindFileLoader } from './file_loader.js';

// Body começa em estado "sem vídeo" — esconde canvas/transport até user carregar.
document.body.classList.add('no-video');

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

// 4) File loader: quando vídeo carrega, (re)inicializa transport e modo source
bindFileLoader({
  onLoaded: () => {
    initRangeUI();
    refreshRangeUI();
    setProgress('<span class="stage">Vídeo carregado.</span> Use os marcadores pra delimitar trecho, depois mude pra "rotoscopia" e exporte.', 0);
    updateInfo();
    bootMode('source');
  },
});
initFileLoader();
