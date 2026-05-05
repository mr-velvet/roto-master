// Carregamento de vídeo via file picker / drag-drop.
// Substitui o <video src=...> fixo por URL.createObjectURL.

import { STATE } from './state.js';
import { vid, resizeCanvasToDims } from './gl.js';

let currentObjectUrl = null;
let onLoadedCb = null;

const $btnLoad = document.getElementById('btn-load');
const $fileInput = document.getElementById('file-input');
const $canvasWrap = document.getElementById('canvas-wrap');
const $dropOverlay = document.getElementById('drop-overlay');

let onFileSelectedCb = null;

export function bindFileLoader(deps) {
  onLoadedCb = deps.onLoaded;
  onFileSelectedCb = deps.onFileSelected;
}

function setLoaded() {
  document.body.classList.remove('no-video');
}

function loadFile(file) {
  if (!file || !file.type.startsWith('video/')) {
    console.warn('arquivo inválido — use um vídeo');
    return;
  }
  if (onFileSelectedCb) onFileSelectedCb(file);

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  currentObjectUrl = URL.createObjectURL(file);

  // Reset state mínimo do trecho — frames serão regenerados via dirty.
  STATE.frames = [];
  STATE.dirty = true;
  STATE.playIdx = 0;

  const onMeta = () => {
    vid.removeEventListener('loadedmetadata', onMeta);
    STATE.videoDurS = vid.duration;
    applyInOutWithRestore(vid.duration);
    resizeCanvasToDims(vid.videoWidth, vid.videoHeight);
    setLoaded();
    if (onLoadedCb) onLoadedCb();
  };
  vid.addEventListener('loadedmetadata', onMeta);
  vid.src = currentObjectUrl;
  vid.load();
}

// Se in/out já foram restaurados de edit_state, mantém (clampando ao novo
// duration). Senão, defaults: in=0, out=min(3, duration).
function applyInOutWithRestore(duration) {
  if (!STATE.restoredFromState) {
    STATE.inS = 0;
    STATE.outS = Math.min(3, duration);
    return;
  }
  STATE.inS = Math.max(0, Math.min(STATE.inS, duration - 0.1));
  STATE.outS = Math.max(STATE.inS + 0.1, Math.min(STATE.outS, duration));
  // consumiu o restore — próximo loadFromUrl sem novo openEditor usa defaults
  STATE.restoredFromState = false;
}

// Carrega vídeo direto de uma URL (ex: gcs_url). Não precisa de file picker.
export function loadFromUrl(url) {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  STATE.frames = [];
  STATE.dirty = true;
  STATE.playIdx = 0;

  // mostra loading: empty-hint vai sumir (no-video continua, mas video-loading sobrepõe)
  const $loading = document.getElementById('video-loading');
  if ($loading) $loading.removeAttribute('hidden');

  const onMeta = () => {
    vid.removeEventListener('loadedmetadata', onMeta);
    if (onErr) vid.removeEventListener('error', onErr);
    if ($loading) $loading.setAttribute('hidden', '');
    STATE.videoDurS = vid.duration;
    applyInOutWithRestore(vid.duration);
    resizeCanvasToDims(vid.videoWidth, vid.videoHeight);
    setLoaded();
    if (onLoadedCb) onLoadedCb();
  };
  const onErr = () => {
    vid.removeEventListener('loadedmetadata', onMeta);
    vid.removeEventListener('error', onErr);
    if ($loading) {
      $loading.querySelector('.video-loading-msg').textContent = 'falha ao carregar vídeo do storage';
      $loading.classList.add('is-error');
    }
  };
  vid.addEventListener('loadedmetadata', onMeta);
  vid.addEventListener('error', onErr);
  vid.src = url;
  vid.load();
}

export function initFileLoader() {
  $btnLoad.addEventListener('click', () => $fileInput.click());
  $fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
    e.target.value = ''; // permite recarregar mesmo arquivo
  });

  // Drag & drop em qualquer lugar da área de canvas.
  let dragDepth = 0;
  $canvasWrap.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    $dropOverlay.classList.add('active');
  });
  $canvasWrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  $canvasWrap.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) $dropOverlay.classList.remove('active');
  });
  $canvasWrap.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $dropOverlay.classList.remove('active');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  // Bloquear drop fora do canvas-wrap pra não navegar pro vídeo.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}
