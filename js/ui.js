// UI: presets, sliders, range slider, info, handlers, export.

import { buildAseprite } from './aseprite.js';
import { PARAMS, PRESETS, SLIDERS, STATE } from './state.js';
import { vid, flipYRGBA } from './gl.js';
import {
  setMode, stopPlay, stopRotoscopePlay,
  startRotoscopePlay, ensureBuilt,
} from './playback.js';

// ----- DOM refs -----
const $btnPlay = document.getElementById('btn-play');
const $btnExport = document.getElementById('btn-export');
const $info = document.getElementById('frame-info');
const $progress = document.getElementById('progress');
const $pbar = document.getElementById('pbar');
const $inRange = document.getElementById('in-range');
const $outRange = document.getElementById('out-range');
const $trackActive = document.getElementById('track-active');
const $inVal = document.getElementById('in-val');
const $outVal = document.getElementById('out-val');
const $playheadInfo = document.getElementById('playhead-info');
const $startInput = document.getElementById('cap-start');
const $endInput = document.getElementById('cap-end');
const $modeTabs = document.querySelectorAll('.mode-tab');

export const dom = { $btnPlay, $btnExport, $info, $progress, $pbar, $modeTabs };

export function setProgress(html, pct) {
  $progress.innerHTML = html;
  if (pct != null) $pbar.style.setProperty('--p', pct + '%');
}

// Setup uma vez do dual-range — max/step só mudam quando vídeo carrega (videoDurS)
export function initRangeUI() {
  const dur = STATE.videoDurS || 1;
  $inRange.min = '0'; $inRange.max = String(dur); $inRange.step = '0.01';
  $outRange.min = '0'; $outRange.max = String(dur); $outRange.step = '0.01';
  $inRange.value = STATE.inS;
  $outRange.value = STATE.outS;
}

// Sincroniza marcadores e campos numéricos quando in/out mudam.
// `originSlider`: se a chamada veio de drag de um <input range>, NÃO escrever
// .value de volta nele (cancela o drag em alguns browsers). Idem pra inputs numéricos.
export function refreshRangeUI(originSlider /* 'in' | 'out' | 'num' | undefined */) {
  const dur = STATE.videoDurS || 1;
  if (originSlider !== 'in')  $inRange.value = STATE.inS;
  if (originSlider !== 'out') $outRange.value = STATE.outS;
  // posicionamento da barra ativa via calc() — alinha com o range que tem inset 6px
  // de cada lado (CSS .range-wrap input: left 6px, right 6px). Sem ler clientWidth.
  const inFrac = STATE.inS / dur;
  const outFrac = STATE.outS / dur;
  $trackActive.style.left = `calc(6px + (100% - 12px) * ${inFrac})`;
  $trackActive.style.width = `calc((100% - 12px) * ${outFrac - inFrac})`;
  $inVal.textContent = STATE.inS.toFixed(2) + 's';
  $outVal.textContent = STATE.outS.toFixed(2) + 's';
  if (originSlider !== 'num') {
    if (parseFloat($startInput.value) !== STATE.inS) $startInput.value = STATE.inS.toFixed(2);
    if (parseFloat($endInput.value) !== STATE.outS) $endInput.value = STATE.outS.toFixed(2);
  }
}

export function updateInfo() {
  if (STATE.mode === 'source') {
    const cur = vid.currentTime || 0;
    const dur = STATE.videoDurS || 0;
    $info.innerHTML = `<b>vídeo</b> · ${cur.toFixed(2)}s / ${dur.toFixed(2)}s`;
    $playheadInfo.innerHTML = `cursor: <b>${cur.toFixed(2)}s</b>`;
  } else {
    const N = STATE.frames.length;
    const t = N ? (STATE.playIdx / STATE.fps) : 0;
    $info.innerHTML = `frame <b>${N ? STATE.playIdx + 1 : 0}</b> / <b>${N}</b> · t=<b>${t.toFixed(2)}s</b> · ${STATE.fps}fps`;
    $playheadInfo.innerHTML = `frame <b>${N ? STATE.playIdx + 1 : 0}</b>/${N}`;
  }
}

export function markDirty() {
  STATE.dirty = true;
  if (STATE.mode === 'rotoscope') {
    stopPlay();
    $btnPlay.textContent = '▶ build & play';
    setProgress('<span class="stage">Mudou</span> — clique play pra reconstruir frames.', 0);
  }
}

export function buildUI() {
  const presetsEl = document.getElementById('presets');
  Object.keys(PRESETS).forEach((name) => {
    const b = document.createElement('button');
    b.className = 'preset-btn' + (name === 'puro' ? ' active' : '');
    b.textContent = name;
    b.dataset.name = name;
    b.onclick = () => applyPreset(name);
    presetsEl.appendChild(b);
  });
  const sl = document.getElementById('sliders');
  SLIDERS.forEach(([key, label, min, max, step]) => {
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    wrap.innerHTML = `
      <label>${label}<span class="val" id="val-${key}">${PARAMS[key].toFixed(2)}</span></label>
      <input type="range" id="in-${key}" min="${min}" max="${max}" step="${step}" value="${PARAMS[key]}">
    `;
    sl.appendChild(wrap);
    wrap.querySelector('input').addEventListener('input', (e) => {
      PARAMS[key] = parseFloat(e.target.value);
      document.getElementById('val-' + key).textContent = PARAMS[key].toFixed(2);
      markDirty();
    });
  });
}
export function applyPreset(name) {
  const p = PRESETS[name];
  Object.keys(p).forEach(k => {
    PARAMS[k] = p[k];
    const inp = document.getElementById('in-' + k);
    const val = document.getElementById('val-' + k);
    if (inp) inp.value = p[k];
    if (val) val.textContent = p[k].toFixed(2);
  });
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b.dataset.name === name));
  markDirty();
}

function onRangeInput(which) {
  let inV = parseFloat($inRange.value);
  let outV = parseFloat($outRange.value);
  const minGap = 0.1; // mínimo 100ms
  if (which === 'in' && inV > outV - minGap) inV = outV - minGap;
  if (which === 'out' && outV < inV + minGap) outV = inV + minGap;
  inV = Math.max(0, Math.min(STATE.videoDurS, inV));
  outV = Math.max(0, Math.min(STATE.videoDurS, outV));
  STATE.inS = inV;
  STATE.outS = outV;
  refreshRangeUI(which); // 'in' ou 'out' — não escrever .value de volta no slider em drag
  // se modo source e cursor caiu fora, ajusta
  if (STATE.mode === 'source' && (vid.currentTime < STATE.inS || vid.currentTime > STATE.outS)) {
    try { vid.currentTime = STATE.inS; } catch(e) {}
  }
  markDirty();
}

function onNumInput() {
  let s = parseFloat($startInput.value);
  let e = parseFloat($endInput.value);
  if (!isFinite(s)) s = 0;
  if (!isFinite(e)) e = STATE.videoDurS;
  s = Math.max(0, Math.min(STATE.videoDurS, s));
  e = Math.max(0, Math.min(STATE.videoDurS, e));
  if (e <= s) e = Math.min(STATE.videoDurS, s + 0.1);
  STATE.inS = s; STATE.outS = e;
  refreshRangeUI('num');
  markDirty();
}

export function wireHandlers() {
  // Botão play (despacha por modo)
  $btnPlay.addEventListener('click', async () => {
    if (STATE.mode === 'source') {
      if (vid.paused) {
        // se cursor está fora do trecho, pular pro in
        if (vid.currentTime < STATE.inS || vid.currentTime >= STATE.outS) {
          try { vid.currentTime = STATE.inS; } catch(e) {}
        }
        try { await vid.play(); $btnPlay.classList.add('playing'); $btnPlay.textContent = '■ pause'; }
        catch(e) { console.warn(e); }
      } else {
        vid.pause();
        $btnPlay.classList.remove('playing');
        $btnPlay.textContent = '▶ play';
      }
    } else {
      if (STATE.playing) { stopRotoscopePlay(); return; }
      await ensureBuilt();
      if (STATE.frames.length) startRotoscopePlay();
    }
  });

  // Trocar modo
  $modeTabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

  // Dual range in/out
  $inRange.addEventListener('input', () => onRangeInput('in'));
  $outRange.addEventListener('input', () => onRangeInput('out'));

  // Inputs numéricos in/out
  $startInput.addEventListener('change', onNumInput);
  $endInput.addEventListener('change', onNumInput);

  // Outros parâmetros que afetam só o build
  ['cap-fps','cap-scale','cap-overlay'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => markDirty());
  });

  // Export
  $btnExport.addEventListener('click', async () => {
    try {
      stopPlay();
      await ensureBuilt();
      const N = STATE.frames.length;
      if (!N) throw new Error('sem frames');
      setProgress('<span class="stage">Empacotando .aseprite…</span>', 100);
      await new Promise(r => setTimeout(r, 16));
      // Frames estão em Y nativo do GL (bottom-up). Aseprite quer top-down.
      const flipped = STATE.frames.map(f => flipYRGBA(f, STATE.dw, STATE.dh));
      const aseBytes = buildAseprite(flipped, STATE.dw, STATE.dh, STATE.frameDurationMs);
      const blob = new Blob([aseBytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url; a.download = `rotoscope-${ts}.aseprite`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const sizeKB = (aseBytes.length / 1024).toFixed(1);
      setProgress(`<span class="ok">✓ Baixado</span> · ${N} frames · ${STATE.dw}×${STATE.dh} · ${sizeKB} KB · abrir no Aseprite e validar paridade`, 100);
    } catch (e) {
      console.error(e);
      setProgress(`<span class="err">Erro:</span> ${e.message}`, 0);
    }
  });

  // Resize
  window.addEventListener('resize', () => refreshRangeUI());
}
