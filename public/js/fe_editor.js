// Frames Editor · Editor da tirinha — canvas + matriz camadas×quadros.
//
// Ações primárias: prompt pra todos / pros selecionados, +camada, +quadro.
// Read-only no canvas (sem pintura — anti-padrão #1 da ui.md §5).
// Sem histórico/undo (#2). Sem presets nomeados (#3). Sem botão "salvar" (#4).
//
// Live updates: polling leve a cada 3s enquanto houver célula em "processando"
// (api.md §8 deixa o mecanismo concreto pra implementação; SSE/WS fica pra depois).

import {
  getTirinha, patchTirinha,
  addCamada, patchCamada, addQuadro,
  uploadAseprite, dispararPrompt,
  publicarComoAsset,
} from './fe_api.js';
import { listProjects } from './projects_api.js';
import { openModal, closeModal, showToast } from './modals.js';
import { navigateFeHome } from './router.js';
import { buildAsepriteDoFrameEditor } from './aseprite_io.js';

// === Estado local da tirinha em edição ===
let tirinha = null;          // { id, nome, largura, altura, camadas, quadros, celulas }
let celulasMap = new Map();  // chave "camadaId:quadroId" → celula
let camadasOrdenadas = [];   // por ordem desc (visual: maior em cima)
let quadrosOrdenados = [];   // por indice asc

// Seleção: Set de "camadaId:quadroId"
let selecionadas = new Set();
let activeCelKey = null; // pra saber qual quadro mostrar no canvas

// Visualização
let zoom = 4;
let panX = 0;
let panY = 0;
let bgMode = 'checker'; // 'checker' | 'solid'
let activeQuadroIdx = 0;

const ZOOM_MIN = 1;
const ZOOM_MAX = 32;
const ZOOM_FACTOR = 1.15;

// Cache de imagens carregadas pelo canvas
const imgCache = new Map(); // png_url → HTMLImageElement (decoded)

// Polling
let pollTimer = null;

// Interação do canvas (pan/zoom)
let panActive = false;        // está arrastando?
let panTrigger = null;        // 'middle' | 'space'
let panStartX = 0, panStartY = 0;       // ponto inicial do mouse (clientX/Y)
let panStartPanX = 0, panStartPanY = 0; // pan no início do drag
let spaceDown = false;        // espaço segurado?
let canvasResizeObs = null;
let canvasInteractionAttached = false;

// === Refs ===
const $name = document.querySelector('[data-bind="fe-editor-name"]');
const $nameInput = document.querySelector('[data-bind="fe-editor-name-input"]');
const $meta = document.querySelector('[data-bind="fe-editor-meta"]');
const $canvas = document.querySelector('[data-bind="fe-editor-canvas"]');
const $canvasWrap = $canvas?.parentElement || null;
const $canvasEmpty = document.querySelector('[data-bind="fe-editor-canvas-empty"]');
const $matrix = document.querySelector('[data-bind="fe-matrix"]');
const $btnSel = document.querySelector('[data-bind="fe-btn-prompt-selected"]');
const $selCount = document.querySelector('[data-bind="fe-sel-count"]');
const $selSummary = document.querySelector('[data-bind="fe-sel-summary"]');
const $zoomLabel = document.querySelector('[data-bind="fe-zoom-label"]');
const $bgLabel = document.querySelector('[data-bind="fe-bg-label"]');
const $frameInfo = document.querySelector('[data-bind="fe-frame-info"]');

// === Entry point ===
export async function showFeEditor(id) {
  selecionadas.clear();
  activeCelKey = null;
  activeQuadroIdx = 0;
  imgCache.clear();
  stopPolling();
  resetView();
  attachCanvasInteraction();
  $matrix.innerHTML = '';

  let data;
  try {
    data = await getTirinha(id);
  } catch (e) {
    showToast('falha ao carregar tirinha: ' + e.message);
    navigateFeHome();
    return;
  }
  if (!data) {
    showToast('tirinha não encontrada');
    navigateFeHome();
    return;
  }
  await aplicarEstadoTirinha(data, { recenter: true });
}

async function aplicarEstadoTirinha(data, opts = {}) {
  tirinha = data;
  camadasOrdenadas = [...(data.camadas || [])].sort((a, b) => b.ordem - a.ordem);
  quadrosOrdenados = [...(data.quadros || [])].sort((a, b) => a.indice - b.indice);
  celulasMap.clear();
  for (const cel of (data.celulas || [])) {
    celulasMap.set(keyOf(cel.camada_id, cel.quadro_id), cel);
  }
  if (activeQuadroIdx >= quadrosOrdenados.length) activeQuadroIdx = quadrosOrdenados.length - 1;
  if (activeQuadroIdx < 0) activeQuadroIdx = 0;
  $name.textContent = data.nome;
  $meta.textContent = `${data.largura}×${data.altura}px · ${camadasOrdenadas.length} camada${camadasOrdenadas.length === 1 ? '' : 's'} · ${quadrosOrdenados.length} quadro${quadrosOrdenados.length === 1 ? '' : 's'}`;
  renderMatrix();
  // Recentralizar só na primeira carga (entrada na tirinha). Polling/refresh
  // preservam pan/zoom escolhidos pelo user.
  if (opts.recenter) centerCanvas();
  await renderCanvas();
  atualizarSelecaoUI();
  agendarPollingSeNecessario();
}

// === Render matriz ===
function renderMatrix() {
  $matrix.innerHTML = '';

  // grid: 1ª col = headers de linha (camada). Restante = quadros (1 col cada).
  const cols = quadrosOrdenados.length;
  $matrix.style.gridTemplateColumns = `200px repeat(${cols}, 96px)`;
  $matrix.style.gridTemplateRows = `36px repeat(${camadasOrdenadas.length}, 96px)`;

  // canto superior esquerdo
  const corner = document.createElement('div');
  corner.className = 'fe-matrix-corner';
  corner.textContent = '';
  $matrix.appendChild(corner);

  // headers de coluna (quadros)
  for (let qi = 0; qi < quadrosOrdenados.length; qi++) {
    const q = quadrosOrdenados[qi];
    const head = document.createElement('button');
    head.className = 'fe-matrix-col-head';
    head.type = 'button';
    head.textContent = String(q.indice + 1);
    if (qi === activeQuadroIdx) head.classList.add('is-active');
    head.addEventListener('click', (e) => selecionarColuna(q.id, e));
    $matrix.appendChild(head);
  }

  // cada linha (camada)
  for (const cam of camadasOrdenadas) {
    // header de linha
    const rowHead = document.createElement('div');
    rowHead.className = 'fe-matrix-row-head';
    rowHead.innerHTML = `
      <button class="fe-cam-vis" data-cam-id="${cam.id}" type="button" title="alternar visibilidade">${cam.visivel ? '◉' : '○'}</button>
      <button class="fe-cam-name" data-cam-id="${cam.id}" type="button" title="clique pra selecionar linha · duplo-clique pra renomear">${escapeHtml(cam.nome)}</button>
    `;
    rowHead.querySelector('.fe-cam-vis').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const updated = await patchCamada(cam.id, { visivel: !cam.visivel });
        cam.visivel = updated.visivel;
        renderMatrix();
        await renderCanvas();
      } catch (err) {
        showToast('falha ao alternar visibilidade: ' + err.message);
      }
    });
    const $camNameBtn = rowHead.querySelector('.fe-cam-name');
    $camNameBtn.addEventListener('click', (e) => selecionarLinha(cam.id, e));
    $camNameBtn.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      iniciarRenameCamada(cam, $camNameBtn);
    });
    $matrix.appendChild(rowHead);

    // células dessa linha
    for (let qi = 0; qi < quadrosOrdenados.length; qi++) {
      const q = quadrosOrdenados[qi];
      const cel = celulasMap.get(keyOf(cam.id, q.id));
      const $cell = document.createElement('button');
      $cell.className = 'fe-matrix-cell';
      $cell.type = 'button';
      $cell.dataset.camId = cam.id;
      $cell.dataset.quadroId = q.id;
      const k = keyOf(cam.id, q.id);
      if (selecionadas.has(k)) $cell.classList.add('is-selected');
      if (k === activeCelKey) $cell.classList.add('is-active');

      const png = cel?.png_url;
      if (png) {
        $cell.style.backgroundImage = `url('${png}')`;
        $cell.classList.add('has-png');
      } else {
        $cell.classList.add('is-empty');
      }
      if (cel?.estado === 'processando') {
        $cell.classList.add('is-processing');
        const overlay = document.createElement('span');
        overlay.className = 'fe-cell-processing';
        overlay.textContent = '…';
        $cell.appendChild(overlay);
      }
      $cell.addEventListener('click', (e) => onClickCelula(cam.id, q.id, e));
      $matrix.appendChild($cell);
    }
  }

  // status do quadro
  if (quadrosOrdenados.length) {
    $frameInfo.textContent = `quadro ${activeQuadroIdx + 1} / ${quadrosOrdenados.length}`;
  } else {
    $frameInfo.textContent = '— / —';
  }
}

// === Seleção ===
function onClickCelula(camId, quadroId, ev) {
  const k = keyOf(camId, quadroId);
  if (ev.shiftKey) {
    selecionadas.add(k);
  } else if (ev.ctrlKey || ev.metaKey) {
    if (selecionadas.has(k)) selecionadas.delete(k); else selecionadas.add(k);
  } else {
    selecionadas.clear();
    selecionadas.add(k);
  }
  activeCelKey = k;
  // sincroniza quadro ativo no canvas
  const qIdx = quadrosOrdenados.findIndex((q) => q.id === quadroId);
  if (qIdx >= 0) activeQuadroIdx = qIdx;
  atualizarSelecaoUI();
  renderMatrix();
  renderCanvas();
}

function selecionarColuna(quadroId, ev) {
  const append = ev.shiftKey || ev.ctrlKey || ev.metaKey;
  if (!append) selecionadas.clear();
  for (const cam of camadasOrdenadas) {
    selecionadas.add(keyOf(cam.id, quadroId));
  }
  activeCelKey = camadasOrdenadas.length ? keyOf(camadasOrdenadas[0].id, quadroId) : null;
  const qIdx = quadrosOrdenados.findIndex((q) => q.id === quadroId);
  if (qIdx >= 0) activeQuadroIdx = qIdx;
  atualizarSelecaoUI();
  renderMatrix();
  renderCanvas();
}

function selecionarLinha(camId, ev) {
  const append = ev.shiftKey || ev.ctrlKey || ev.metaKey;
  if (!append) selecionadas.clear();
  for (const q of quadrosOrdenados) {
    selecionadas.add(keyOf(camId, q.id));
  }
  if (quadrosOrdenados.length) {
    activeCelKey = keyOf(camId, quadrosOrdenados[activeQuadroIdx]?.id || quadrosOrdenados[0].id);
  }
  atualizarSelecaoUI();
  renderMatrix();
  renderCanvas();
}

function atualizarSelecaoUI() {
  const n = selecionadas.size;
  $selCount.textContent = String(n);
  $btnSel.disabled = n === 0;
  if (n === 0) {
    $selSummary.textContent = 'nenhuma seleção';
  } else if (n === 1) {
    $selSummary.textContent = '1 célula selecionada';
  } else {
    $selSummary.textContent = `${n} células selecionadas`;
  }
}

// === Canvas ===
//
// Modelo de coordenadas:
//   - canvas.width/height = tamanho do contêiner em px (preenche o wrap).
//   - panX/panY: offset em px do canto sup. esquerdo da imagem dentro do canvas.
//   - zoom: fator de ampliação (px de canvas por px de imagem).
//   - Transform: ctx.translate(panX, panY); ctx.scale(zoom, zoom).
//   - drawImage(img, 0, 0, w, h) usa coords lógicas (px de imagem).
function ajustarCanvasParaWrap() {
  if (!$canvas || !$canvasWrap) return false;
  const r = $canvasWrap.getBoundingClientRect();
  const w = Math.max(1, Math.floor(r.width));
  const h = Math.max(1, Math.floor(r.height));
  if ($canvas.width !== w) $canvas.width = w;
  if ($canvas.height !== h) $canvas.height = h;
  // CSS: canvas preenche o wrap inteiro (sem escala extra do CSS).
  $canvas.style.width = '100%';
  $canvas.style.height = '100%';
  return true;
}

function centerCanvas() {
  if (!tirinha || !$canvas) return;
  ajustarCanvasParaWrap();
  const w = tirinha.largura;
  const h = tirinha.altura;
  panX = ($canvas.width - w * zoom) / 2;
  panY = ($canvas.height - h * zoom) / 2;
  $zoomLabel.textContent = formatZoom(zoom);
}

function resetView() {
  zoom = 4;
  panX = 0;
  panY = 0;
  if ($zoomLabel) $zoomLabel.textContent = formatZoom(zoom);
}

function formatZoom(z) {
  if (Number.isInteger(z)) return `${z}×`;
  return `${z.toFixed(1)}×`;
}

async function renderCanvas() {
  if (!$canvas) return;
  if (!tirinha || !quadrosOrdenados.length) {
    // canvas zera; mostra placeholder
    ajustarCanvasParaWrap();
    const ctx0 = $canvas.getContext('2d');
    ctx0.setTransform(1, 0, 0, 1, 0, 0);
    ctx0.clearRect(0, 0, $canvas.width, $canvas.height);
    $canvasEmpty.removeAttribute('hidden');
    return;
  }
  $canvasEmpty.setAttribute('hidden', '');
  ajustarCanvasParaWrap();

  const w = tirinha.largura;
  const h = tirinha.altura;
  const cw = $canvas.width;
  const ch = $canvas.height;

  const ctx = $canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // limpa toda a área do canvas (em coords nativas)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#07080b';
  ctx.fillRect(0, 0, cw, ch);

  // aplica pan + zoom: tudo abaixo desenha em coords da imagem
  ctx.setTransform(zoom, 0, 0, zoom, panX, panY);

  // fundo (apenas área da tirinha)
  if (bgMode === 'checker') {
    desenharXadrez(ctx, w, h);
  } else {
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, w, h);
  }

  const quadroAtivo = quadrosOrdenados[activeQuadroIdx];
  if (!quadroAtivo) return;

  // ordena camadas por ordem ASC (em baixo primeiro), pinta em cima
  const camadasParaPintar = [...camadasOrdenadas].sort((a, b) => a.ordem - b.ordem);
  for (const cam of camadasParaPintar) {
    if (!cam.visivel) continue;
    const cel = celulasMap.get(keyOf(cam.id, quadroAtivo.id));
    if (!cel || !cel.png_url) continue;
    try {
      const img = await loadImage(cel.png_url);
      ctx.drawImage(img, 0, 0, w, h);
    } catch (e) {
      // imagem ainda carregando ou cors; ignora
    }
  }
}

function desenharXadrez(ctx, w, h) {
  // w/h em px de imagem. Quadradinho de 8px lógicos.
  const sq = 8;
  for (let y = 0; y < h; y += sq) {
    for (let x = 0; x < w; x += sq) {
      const claro = ((x / sq) + (y / sq)) % 2 === 0;
      ctx.fillStyle = claro ? '#23272f' : '#181b22';
      ctx.fillRect(x, y, Math.min(sq, w - x), Math.min(sq, h - y));
    }
  }
}

function loadImage(url) {
  if (imgCache.has(url)) {
    const cached = imgCache.get(url);
    if (cached.complete && cached.naturalWidth) return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgCache.set(url, img); resolve(img); };
    img.onerror = (e) => reject(new Error('img load failed: ' + url));
    img.src = url;
  });
}

// === Rename de camada ===
function iniciarRenameCamada(cam, $btn) {
  const original = cam.nome;
  const $input = document.createElement('input');
  $input.type = 'text';
  $input.value = original;
  $input.className = 'fe-cam-name-input';
  $input.maxLength = 100;
  $btn.replaceWith($input);
  $input.focus();
  $input.select();
  let settled = false;
  const finalize = async (commit) => {
    if (settled) return;
    settled = true;
    const novo = $input.value.trim();
    if (commit && novo && novo !== original) {
      try {
        const updated = await patchCamada(cam.id, { nome: novo });
        cam.nome = updated.nome;
      } catch (err) {
        showToast('falha ao renomear camada: ' + err.message);
      }
    }
    renderMatrix();
  };
  $input.addEventListener('blur', () => finalize(true));
  $input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finalize(true);
    if (e.key === 'Escape') finalize(false);
  });
}

// === Helpers ===
function keyOf(camId, quadroId) { return `${camId}:${quadroId}`; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// === Polling de processamento ===
function temCelulaProcessando() {
  for (const c of celulasMap.values()) if (c.estado === 'processando') return true;
  return false;
}
function agendarPollingSeNecessario() {
  if (pollTimer) return;
  if (!temCelulaProcessando()) return;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    if (!tirinha) return;
    try {
      const data = await getTirinha(tirinha.id);
      if (!data || data.id !== tirinha.id) return;
      // mantém zoom/seleção/activeQuadro
      await aplicarEstadoTirinha(data);
    } catch (e) {
      console.warn('polling falhou:', e);
      agendarPollingSeNecessario();
    }
  }, 3000);
}
function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

// === Handlers globais ===

// Voltar
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fe-back"]')) return;
  stopPolling();
  stopCanvasInteraction();
  navigateFeHome();
});

// Rename inline da tirinha
$name?.addEventListener('click', () => {
  if (!tirinha) return;
  $nameInput.value = tirinha.nome;
  $nameInput.removeAttribute('hidden');
  $name.setAttribute('hidden', '');
  $nameInput.focus();
  $nameInput.select();
});
$nameInput?.addEventListener('blur', async () => finalizarRenameTirinha(true));
$nameInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') finalizarRenameTirinha(true);
  if (e.key === 'Escape') finalizarRenameTirinha(false);
});
async function finalizarRenameTirinha(commit) {
  if ($nameInput.hasAttribute('hidden')) return;
  const novo = $nameInput.value.trim();
  $nameInput.setAttribute('hidden', '');
  $name.removeAttribute('hidden');
  if (commit && novo && tirinha && novo !== tirinha.nome) {
    try {
      const data = await patchTirinha(tirinha.id, { nome: novo });
      tirinha.nome = data.tirinha.nome;
      $name.textContent = tirinha.nome;
    } catch (err) {
      showToast('falha ao renomear: ' + err.message);
    }
  }
}

// Zoom (botões -/+): preserva o ponto central do canvas.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="fe-zoom-in"]')) {
    aplicarZoomNoPonto($canvas.width / 2, $canvas.height / 2, zoom * 2);
  } else if (e.target.closest('[data-action="fe-zoom-out"]')) {
    aplicarZoomNoPonto($canvas.width / 2, $canvas.height / 2, zoom / 2);
  }
});

// === Pan / zoom interativos ===

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

// Aplica zoom mantendo o ponto (cx, cy) — em coords do canvas — fixo.
function aplicarZoomNoPonto(cx, cy, alvoZoom) {
  if (!tirinha) return;
  const oldZoom = zoom;
  const newZoom = clamp(alvoZoom, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === oldZoom) return;
  // ponto da imagem (px de imagem) sob o cursor
  const imgX = (cx - panX) / oldZoom;
  const imgY = (cy - panY) / oldZoom;
  // ajusta pan pra manter o ponto fixo
  panX = cx - imgX * newZoom;
  panY = cy - imgY * newZoom;
  zoom = newZoom;
  if ($zoomLabel) $zoomLabel.textContent = formatZoom(zoom);
  renderCanvas();
}

function onWheel(ev) {
  if (!tirinha) return;
  ev.preventDefault();
  const rect = $canvas.getBoundingClientRect();
  const cx = ev.clientX - rect.left;
  const cy = ev.clientY - rect.top;
  // deltaY < 0 → aproxima (zoom in); > 0 → afasta (zoom out)
  const factor = ev.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  aplicarZoomNoPonto(cx, cy, zoom * factor);
}

function comecarPan(ev, trigger) {
  panActive = true;
  panTrigger = trigger;
  panStartX = ev.clientX;
  panStartY = ev.clientY;
  panStartPanX = panX;
  panStartPanY = panY;
  atualizarCursor();
}

function atualizarPan(ev) {
  if (!panActive) return;
  const dx = ev.clientX - panStartX;
  const dy = ev.clientY - panStartY;
  panX = panStartPanX + dx;
  panY = panStartPanY + dy;
  renderCanvas();
}

function terminarPan() {
  if (!panActive) return;
  panActive = false;
  panTrigger = null;
  atualizarCursor();
}

function atualizarCursor() {
  if (!$canvas) return;
  if (panActive) $canvas.style.cursor = 'grabbing';
  else if (spaceDown) $canvas.style.cursor = 'grab';
  else $canvas.style.cursor = '';
}

function focoEmCampoTexto() {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (a.isContentEditable) return true;
  return false;
}

function onMouseDown(ev) {
  if (!tirinha) return;
  // Botão do meio sempre arrasta.
  if (ev.button === 1) {
    ev.preventDefault();
    comecarPan(ev, 'middle');
    return;
  }
  // Espaço + botão esquerdo arrasta.
  if (ev.button === 0 && spaceDown) {
    ev.preventDefault();
    comecarPan(ev, 'space');
  }
}

function onMouseMove(ev) {
  if (panActive) atualizarPan(ev);
}

function onMouseUp(ev) {
  if (!panActive) return;
  // Solta na liberação do botão correspondente.
  if (panTrigger === 'middle' && ev.button === 1) terminarPan();
  else if (panTrigger === 'space' && ev.button === 0) terminarPan();
}

function onMouseLeaveDoc() {
  // Se o cursor sai da janela, encerra o drag (evita ficar preso).
  if (panActive) terminarPan();
}

function onContextMenu(ev) {
  // Suprime o menu de contexto durante drag pra não interromper interação.
  if (panActive) ev.preventDefault();
}

function onKeyDown(ev) {
  if (ev.code !== 'Space') return;
  if (focoEmCampoTexto()) return;
  // só responde se a tela do editor está visível
  if (document.body.dataset.space !== 'frame-editor') return;
  if (document.body.dataset.screen !== 'fe-editor') return;
  if (ev.repeat) { ev.preventDefault(); return; }
  spaceDown = true;
  ev.preventDefault();
  atualizarCursor();
}

function onKeyUp(ev) {
  if (ev.code !== 'Space') return;
  spaceDown = false;
  // se o drag por espaço estava ativo, interrompe (mouseup pode chegar antes ou depois).
  if (panActive && panTrigger === 'space') terminarPan();
  else atualizarCursor();
}

function onBlurWindow() {
  // Perda de foco = solta espaço e drag (evita estado preso).
  spaceDown = false;
  if (panActive) terminarPan();
  else atualizarCursor();
}

function attachCanvasInteraction() {
  if (canvasInteractionAttached || !$canvas) return;
  $canvas.addEventListener('wheel', onWheel, { passive: false });
  $canvas.addEventListener('mousedown', onMouseDown);
  $canvas.addEventListener('contextmenu', onContextMenu);
  // mousemove/up no document pra não perder o drag se sair do canvas
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mouseleave', onMouseLeaveDoc);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlurWindow);
  // Resize do contêiner: re-render preservando pan/zoom.
  if (typeof ResizeObserver !== 'undefined' && $canvasWrap) {
    canvasResizeObs = new ResizeObserver(() => { renderCanvas(); });
    canvasResizeObs.observe($canvasWrap);
  }
  canvasInteractionAttached = true;
}

export function stopCanvasInteraction() {
  if (!canvasInteractionAttached) return;
  $canvas.removeEventListener('wheel', onWheel);
  $canvas.removeEventListener('mousedown', onMouseDown);
  $canvas.removeEventListener('contextmenu', onContextMenu);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('mouseleave', onMouseLeaveDoc);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlurWindow);
  if (canvasResizeObs) { canvasResizeObs.disconnect(); canvasResizeObs = null; }
  canvasInteractionAttached = false;
  spaceDown = false;
  panActive = false;
  panTrigger = null;
  if ($canvas) $canvas.style.cursor = '';
}

// BG toggle
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fe-bg-toggle"]')) return;
  bgMode = bgMode === 'checker' ? 'solid' : 'checker';
  $bgLabel.textContent = bgMode === 'checker' ? 'xadrez' : 'sólido';
  renderCanvas();
});

// Navegação de quadros
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="fe-prev-quadro"]')) {
    if (activeQuadroIdx > 0) { activeQuadroIdx--; renderMatrix(); renderCanvas(); }
  } else if (e.target.closest('[data-action="fe-next-quadro"]')) {
    if (activeQuadroIdx < quadrosOrdenados.length - 1) { activeQuadroIdx++; renderMatrix(); renderCanvas(); }
  }
});

// + Camada
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="fe-add-camada"]')) return;
  if (!tirinha) return;
  try {
    await addCamada(tirinha.id, { nome: `camada ${camadasOrdenadas.length + 1}` });
    const data = await getTirinha(tirinha.id);
    await aplicarEstadoTirinha(data);
  } catch (err) {
    showToast('falha ao adicionar camada: ' + err.message);
  }
});

// + Quadro
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="fe-add-quadro"]')) return;
  if (!tirinha) return;
  try {
    await addQuadro(tirinha.id, {});
    const data = await getTirinha(tirinha.id);
    activeQuadroIdx = data.quadros.length - 1;
    await aplicarEstadoTirinha(data);
  } catch (err) {
    showToast('falha ao adicionar quadro: ' + err.message);
  }
});

// Prompt: pra todos
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fe-prompt-all"]')) return;
  if (!tirinha) return;
  abrirModalPrompt({ tipo: 'all' });
});

// Prompt: pros selecionados
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fe-prompt-selected"]')) return;
  if (!tirinha || !selecionadas.size) return;
  abrirModalPrompt({ tipo: 'selected' });
});

let promptModoAtual = 'selected';
function abrirModalPrompt({ tipo }) {
  promptModoAtual = tipo;
  const m = document.querySelector('[data-modal="fe-prompt"]');
  m.querySelector('[data-bind="fe-prompt-text"]').value = '';
  m.querySelector('[data-bind="fe-prompt-err"]').textContent = '';
  if (tipo === 'all') {
    const total = camadasOrdenadas.length * quadrosOrdenados.length;
    m.querySelector('[data-bind="fe-prompt-title"]').textContent = 'Prompt pra todos os quadros';
    m.querySelector('[data-bind="fe-prompt-target"]').textContent = `vai aplicar em ${total} célula${total === 1 ? '' : 's'} (todas as camadas × todos os quadros)`;
  } else {
    const n = selecionadas.size;
    m.querySelector('[data-bind="fe-prompt-title"]').textContent = 'Prompt pros selecionados';
    m.querySelector('[data-bind="fe-prompt-target"]').textContent = `vai aplicar em ${n} célula${n === 1 ? '' : 's'} selecionada${n === 1 ? '' : 's'}`;
  }
  openModal('fe-prompt');
}

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="fe-confirm-prompt"]')) return;
  if (!tirinha) return;
  const m = document.querySelector('[data-modal="fe-prompt"]');
  const $err = m.querySelector('[data-bind="fe-prompt-err"]');
  const $text = m.querySelector('[data-bind="fe-prompt-text"]');
  const prompt = $text.value.trim();
  $err.textContent = '';
  if (!prompt) { $err.textContent = 'escreva um prompt'; return; }

  let alvosIds;
  if (promptModoAtual === 'all') {
    alvosIds = (tirinha.celulas || []).map((c) => c.id);
  } else {
    alvosIds = [];
    for (const k of selecionadas) {
      const cel = celulasMap.get(k);
      if (cel && cel.estado !== 'processando') alvosIds.push(cel.id);
    }
  }
  if (!alvosIds.length) { $err.textContent = 'nenhuma célula alvo válida'; return; }

  try {
    await dispararPrompt({ tirinhaId: tirinha.id, prompt, celulasIds: alvosIds });
    closeModal();
    showToast(`prompt disparado em ${alvosIds.length} célula${alvosIds.length === 1 ? '' : 's'}`);
    // marca localmente como processando enquanto não vem update
    const idsSet = new Set(alvosIds);
    for (const cel of celulasMap.values()) {
      if (idsSet.has(cel.id)) cel.estado = 'processando';
    }
    renderMatrix();
    agendarPollingSeNecessario();
  } catch (err) {
    $err.textContent = err.message;
  }
});

// Download .aseprite
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="fe-download"]')) return;
  if (!tirinha) return;
  try {
    showToast('gerando .aseprite…');
    const blob = await gerarAsepriteBlob();
    // sobe (atualiza last_aseprite_url) e dispara download
    let asepriteUrl = null;
    try {
      const out = await uploadAseprite({ tirinhaId: tirinha.id, blob, filename: `${slugify(tirinha.nome)}.aseprite` });
      asepriteUrl = out.aseprite_url;
    } catch (err) {
      console.warn('upload-aseprite falhou (segue download local):', err);
    }
    // download local: prefere blob direto pra evitar CORS
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(tirinha.nome)}.aseprite`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('download iniciado');
  } catch (err) {
    console.error('download:', err);
    showToast('falha no download: ' + err.message);
  }
});

// Publicar como novo asset (Frames Editor → Galeria).
// Cópia consciente — sem vínculo (integracao-com-assets.md §4.4).
let publishProjectId = null;

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="fe-publish-asset"]')) return;
  if (!tirinha) return;
  // Reset estado.
  publishProjectId = null;
  document.querySelector('[data-bind="fe-publish-project-label"]').textContent = '— escolher —';
  document.querySelector('[data-bind="fe-publish-asset-name"]').value = tirinha.nome || '';
  document.querySelector('[data-bind="fe-publish-err"]').textContent = '';
  // Carrega projetos.
  try {
    const projetos = await listProjects();
    const $menu = document.querySelector('[data-bind="fe-publish-project-menu"]');
    $menu.innerHTML = '';
    if (!projetos.length) {
      $menu.innerHTML = '<li class="custom-select-empty">nenhum projeto — crie um na Galeria primeiro</li>';
    } else {
      for (const p of projetos) {
        const li = document.createElement('li');
        li.className = 'custom-select-item';
        li.textContent = p.name;
        li.dataset.projectId = p.id;
        li.dataset.projectName = p.name;
        $menu.appendChild(li);
      }
    }
    openModal('fe-publish-asset');
  } catch (err) {
    showToast('falha ao listar projetos: ' + err.message);
  }
});

document.addEventListener('click', (e) => {
  // Toggle do dropdown
  if (e.target.closest('[data-action="fe-toggle-project-select"]')) {
    const $menu = document.querySelector('[data-bind="fe-publish-project-menu"]');
    if ($menu) $menu.toggleAttribute('hidden');
    return;
  }
  // Escolha de item
  const item = e.target.closest('[data-bind="fe-publish-project-menu"] .custom-select-item');
  if (item) {
    publishProjectId = item.dataset.projectId;
    document.querySelector('[data-bind="fe-publish-project-label"]').textContent = item.dataset.projectName;
    document.querySelector('[data-bind="fe-publish-project-menu"]').setAttribute('hidden', '');
  }
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="fe-confirm-publish-asset"]')) return;
  const $err = document.querySelector('[data-bind="fe-publish-err"]');
  $err.textContent = '';
  if (!publishProjectId) { $err.textContent = 'escolha um projeto'; return; }
  const nome = (document.querySelector('[data-bind="fe-publish-asset-name"]').value || '').trim() || tirinha.nome || 'sem nome';
  const $btn = e.target.closest('[data-action="fe-confirm-publish-asset"]');
  $btn.disabled = true;
  try {
    showToast('gerando .aseprite…', 1500);
    const blob = await gerarAsepriteBlob();
    showToast('subindo arquivo…', 1500);
    await uploadAseprite({ tirinhaId: tirinha.id, blob, filename: `${slugify(nome)}.aseprite` });
    // last_aseprite_url agora está gravada no banco; chama publicar-asset.
    showToast('criando asset…', 1500);
    const out = await publicarComoAsset({ tirinhaId: tirinha.id, projectId: publishProjectId, name: nome });
    closeModal();
    showToast(`asset criado · ${nome}`, 3000);
    // Não navegamos pro asset — princípio de cópia consciente, user fica na tirinha.
  } catch (err) {
    console.error('publish-asset:', err);
    $err.textContent = err.message || 'falhou';
  } finally {
    $btn.disabled = false;
  }
});

async function gerarAsepriteBlob() {
  // Monta estrutura no formato que buildAsepriteDoFrameEditor espera.
  // Camadas: ordem == índice no array enviado; usamos ordem ASC (de baixo pra cima).
  const camadasAsc = [...camadasOrdenadas].sort((a, b) => a.ordem - b.ordem);
  const quadrosAsc = [...quadrosOrdenados]; // já ordenado por indice asc

  const camadasOut = camadasAsc.map((c, i) => ({ nome: c.nome, ordem: i, visivel: c.visivel }));
  const quadrosOut = quadrosAsc.map((q, i) => ({ indice: i, duracao_ms: null }));

  // Carrega PNGs e converte pra RGBA. Cada cel não-vazia vira pixels_rgba.
  const celulasOut = [];
  for (let ci = 0; ci < camadasAsc.length; ci++) {
    for (let qi = 0; qi < quadrosAsc.length; qi++) {
      const cel = celulasMap.get(keyOf(camadasAsc[ci].id, quadrosAsc[qi].id));
      if (!cel || !cel.png_url) continue;
      try {
        const img = await loadImage(cel.png_url);
        const w = cel.largura || img.naturalWidth;
        const h = cel.altura || img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, w, h);
        const id = ctx.getImageData(0, 0, w, h);
        celulasOut.push({
          camada_indice: ci,
          quadro_indice: qi,
          pixels_rgba: new Uint8Array(id.data.buffer.slice(0)),
          largura: w,
          altura: h,
        });
      } catch (e) {
        console.warn('falha ao carregar PNG da célula:', e);
      }
    }
  }

  const bytes = buildAsepriteDoFrameEditor({
    largura: tirinha.largura,
    altura: tirinha.altura,
    camadas: camadasOut,
    quadros: quadrosOut,
    celulas: celulasOut,
  });
  return new Blob([bytes], { type: 'application/octet-stream' });
}

function slugify(s) {
  return String(s || 'tirinha').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tirinha';
}
