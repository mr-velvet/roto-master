// Auto-save de edit_state. Debounce 1s + flush no beforeunload.

import { PARAMS, STATE } from './state.js';
import { patchVideo } from './videos_api.js';

let currentVideoId = null;
let timer = null;
let pending = false;
let lastSaved = null;
let activePresetName = null;

function snapshot() {
  return {
    params: { ...PARAMS },
    in_s: STATE.inS,
    out_s: STATE.outS,
    fps: STATE.fps,
    overlay: STATE.overlay,
    preset: activePresetName,
    saved_at: new Date().toISOString(),
  };
}

function shallowEqual(a, b) {
  if (!a || !b) return false;
  const k1 = Object.keys(a);
  const k2 = Object.keys(b);
  if (k1.length !== k2.length) return false;
  for (const k of k1) {
    if (k === 'saved_at') continue;
    if (typeof a[k] === 'object' && a[k] !== null) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
    } else if (a[k] !== b[k]) return false;
  }
  return true;
}

async function flush() {
  if (!currentVideoId) return;
  const snap = snapshot();
  if (lastSaved && shallowEqual(snap, lastSaved)) return;
  try {
    await patchVideo(currentVideoId, { edit_state: snap });
    lastSaved = snap;
    pending = false;
  } catch (e) {
    console.warn('autosave falhou:', e.message);
  }
}

function schedule() {
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(flush, 1000);
}

export function startAutosave(videoId, initialState) {
  currentVideoId = videoId;
  lastSaved = initialState && Object.keys(initialState).length ? initialState : null;
  pending = false;
}

export function stopAutosave() {
  if (pending) flush();
  currentVideoId = null;
  clearTimeout(timer);
  timer = null;
}

export function notifyChange(presetName) {
  if (presetName !== undefined) activePresetName = presetName;
  schedule();
}

// flush sincronicamente ao sair da página (sendBeacon)
window.addEventListener('beforeunload', () => {
  if (!currentVideoId || !pending) return;
  const snap = snapshot();
  // sendBeacon não tem auth header — fallback: fetch sem await (best-effort)
  // Como precisamos do token Logto, simplesmente disparamos fetch — pode não chegar.
  try {
    flush();
  } catch (e) {}
});

// Restaurar estado salvo num vídeo, antes do primeiro render.
export function applyEditState(state) {
  if (!state || typeof state !== 'object') return;
  if (state.params && typeof state.params === 'object') {
    Object.keys(PARAMS).forEach((k) => {
      if (typeof state.params[k] === 'number') PARAMS[k] = state.params[k];
    });
  }
  if (typeof state.in_s === 'number') STATE.inS = state.in_s;
  if (typeof state.out_s === 'number') STATE.outS = state.out_s;
  if (typeof state.fps === 'number') STATE.fps = state.fps;
  if (typeof state.overlay === 'boolean') STATE.overlay = state.overlay;
  if (typeof state.preset === 'string') activePresetName = state.preset;
  lastSaved = state;
}

export function getActivePreset() {
  return activePresetName;
}
