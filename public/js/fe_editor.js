// Frames Editor · Editor da tirinha — canvas + matriz camadas×quadros.
//
// Layout enxuto Aseprite-like (rev. 2026-05-08):
//   - 1 botão "prompt" contextual na discoverbar (descobertabilidade).
//   - Tudo o mais (criar/deletar/renomear camada e quadro, prompts contextuais,
//     limpar célula) acessado via menu de contexto custom (botão direito) na matriz.
//   - F2 = renomear camada ativa.
// Read-only no canvas (sem pintura — anti-padrão #1 da ui.md §5).
// Sem histórico/undo (#2). Sem presets nomeados (#3). Sem botão "salvar" (#4).
// Anti-padrão evitado: NUNCA usa o menu de contexto nativo do browser na área
// do produto (preventDefault em contextmenu).
//
// Live updates: polling leve a cada 3s enquanto houver célula em "processando".

import {
  getTirinha, patchTirinha,
  addCamada, patchCamada, deleteCamada,
  addQuadro, deleteQuadro,
  patchCelula,
  uploadAseprite, dispararPrompt,
  publicarComoAsset,
} from './fe_api.js';
import { listProjects } from './projects_api.js';
import { openModal, closeModal, showToast, confirmModal } from './modals.js';
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
let bgMode = 'checker'; // 'checker' | 'solid'
let activeQuadroIdx = 0;

// Cache de imagens carregadas pelo canvas
const imgCache = new Map(); // png_url → HTMLImageElement (decoded)

// Polling
let pollTimer = null;

// === Refs ===
const $name = document.querySelector('[data-bind="fe-editor-name"]');
const $nameInput = document.querySelector('[data-bind="fe-editor-name-input"]');
const $meta = document.querySelector('[data-bind="fe-editor-meta"]');
const $canvas = document.querySelector('[data-bind="fe-editor-canvas"]');
const $canvasEmpty = document.querySelector('[data-bind="fe-editor-canvas-empty"]');
const $matrix = document.querySelector('[data-bind="fe-matrix"]');
const $btnSel = document.querySelector('[data-bind="fe-btn-prompt-selected"]'); // hidden, mantido por compat
const $btnPromptCtx = document.querySelector('[data-bind="fe-btn-prompt-context"]');
const $promptCtxLabel = document.querySelector('[data-bind="fe-prompt-context-label"]');
const $selCount = document.querySelector('[data-bind="fe-sel-count"]');
const $selSummary = document.querySelector('[data-bind="fe-sel-summary"]');
const $zoomLabel = document.querySelector('[data-bind="fe-zoom-label"]');
const $bgLabel = document.querySelector('[data-bind="fe-bg-label"]');
const $frameInfo = document.querySelector('[data-bind="fe-frame-info"]');
const $cm = document.querySelector('[data-bind="fe-context-menu"]');

// === Entry point ===
export async function showFeEditor(id) {
  selecionadas.clear();
  activeCelKey = null;
  activeQuadroIdx = 0;
  imgCache.clear();
  stopPolling();
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
  await aplicarEstadoTirinha(data);
}

async function aplicarEstadoTirinha(data) {
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

  // canto superior esquerdo — área "vazia" da matriz; botão direito abre menu global.
  const corner = document.createElement('div');
  corner.className = 'fe-matrix-corner';
  corner.textContent = '';
  corner.addEventListener('contextmenu', (e) => abrirMenuVazio(e));
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
    head.addEventListener('contextmenu', (e) => abrirMenuQuadro(e, q.id));
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
    rowHead.addEventListener('contextmenu', (e) => abrirMenuCamada(e, cam.id));
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
      $cell.addEventListener('contextmenu', (e) => abrirMenuCelula(e, cam.id, q.id));
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
  if ($selCount) $selCount.textContent = String(n);
  if ($btnSel) $btnSel.disabled = n === 0;
  if ($selSummary) {
    if (n === 0) {
      $selSummary.textContent = 'nenhuma seleção';
    } else if (n === 1) {
      $selSummary.textContent = '1 célula selecionada';
    } else {
      $selSummary.textContent = `${n} células selecionadas`;
    }
  }
  // Botão "prompt" da discoverbar: muda label conforme contexto.
  if ($promptCtxLabel) {
    if (n === 0) {
      $promptCtxLabel.textContent = 'prompt pra todos os quadros';
    } else if (n === 1) {
      $promptCtxLabel.textContent = 'prompt nesta célula';
    } else {
      $promptCtxLabel.textContent = `prompt em ${n} selecionadas`;
    }
  }
}

// === Canvas ===
async function renderCanvas() {
  if (!tirinha || !quadrosOrdenados.length) {
    $canvas.width = $canvas.height = 0;
    $canvasEmpty.removeAttribute('hidden');
    return;
  }
  $canvasEmpty.setAttribute('hidden', '');

  const w = tirinha.largura;
  const h = tirinha.altura;
  $canvas.width = w * zoom;
  $canvas.height = h * zoom;
  $canvas.style.width = `${w * zoom}px`;
  $canvas.style.height = `${h * zoom}px`;

  const ctx = $canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // fundo
  if (bgMode === 'checker') {
    desenharXadrez(ctx, w * zoom, h * zoom);
  } else {
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, w * zoom, h * zoom);
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
      // desenha em w*zoom
      ctx.drawImage(img, 0, 0, w * zoom, h * zoom);
    } catch (e) {
      // imagem ainda carregando ou cors; ignora
    }
  }
}

function desenharXadrez(ctx, w, h) {
  const sq = 8;
  for (let y = 0; y < h; y += sq) {
    for (let x = 0; x < w; x += sq) {
      const claro = ((x / sq) + (y / sq)) % 2 === 0;
      ctx.fillStyle = claro ? '#23272f' : '#181b22';
      ctx.fillRect(x, y, sq, sq);
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

// =====================================================================
// Menu de contexto (Aseprite-like). Custom — nunca usa o menu nativo.
// =====================================================================

function fecharMenuCtx() {
  if ($cm) { $cm.setAttribute('hidden', ''); $cm.innerHTML = ''; }
}

function montarMenuCtx(ev, items) {
  // items: [{ label, shortcut?, danger?, disabled?, onClick }] | { sep: true }
  if (!$cm) return;
  ev.preventDefault();
  ev.stopPropagation();
  $cm.innerHTML = '';
  for (const it of items) {
    if (it && it.sep) {
      const sep = document.createElement('div');
      sep.className = 'fe-cm-sep';
      $cm.appendChild(sep);
      continue;
    }
    if (!it) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fe-cm-item' + (it.danger ? ' fe-cm-item-danger' : '');
    if (it.disabled) b.disabled = true;
    const lbl = document.createElement('span');
    lbl.textContent = it.label;
    b.appendChild(lbl);
    if (it.shortcut) {
      const sc = document.createElement('span');
      sc.className = 'fe-cm-shortcut';
      sc.textContent = it.shortcut;
      b.appendChild(sc);
    }
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      fecharMenuCtx();
      try { await it.onClick?.(); }
      catch (err) { showToast('falhou: ' + err.message); }
    });
    $cm.appendChild(b);
  }
  // Posicionamento: ajusta pra caber dentro do viewport.
  $cm.style.left = '0px';
  $cm.style.top = '0px';
  $cm.removeAttribute('hidden');
  const rect = $cm.getBoundingClientRect();
  const margem = 8;
  let x = ev.clientX, y = ev.clientY;
  if (x + rect.width + margem > window.innerWidth) x = Math.max(margem, window.innerWidth - rect.width - margem);
  if (y + rect.height + margem > window.innerHeight) y = Math.max(margem, window.innerHeight - rect.height - margem);
  $cm.style.left = `${x}px`;
  $cm.style.top = `${y}px`;
}

// Menu de área vazia da matriz (canto superior esquerdo).
function abrirMenuVazio(ev) {
  if (!tirinha) return;
  montarMenuCtx(ev, [
    { label: '+ camada (no topo)', onClick: () => addCamadaTopo() },
    { label: '+ quadro (no fim)', onClick: () => addQuadroFim() },
    { sep: true },
    { label: 'prompt pra todos os quadros', onClick: () => abrirModalPrompt({ tipo: 'all' }) },
  ]);
}

function abrirMenuCamada(ev, camadaId) {
  if (!tirinha) return;
  // Se a linha clicada não estiver totalmente selecionada, seleciona ela.
  const todasNaSelecao = quadrosOrdenados.every((q) => selecionadas.has(keyOf(camadaId, q.id)));
  if (!todasNaSelecao) {
    selecionadas.clear();
    for (const q of quadrosOrdenados) selecionadas.add(keyOf(camadaId, q.id));
    atualizarSelecaoUI();
    renderMatrix();
    renderCanvas();
  }
  const cam = camadasOrdenadas.find((c) => c.id === camadaId);
  if (!cam) return;
  // Seleção atual envolve outras camadas além desta?
  const outrasCamadasNaSel = [...selecionadas].some((k) => k.split(':')[0] !== camadaId);
  const idsCamada = (tirinha.celulas || []).filter((c) => c.camada_id === camadaId).map((c) => c.id);
  const idsSelecionados = [];
  for (const k of selecionadas) {
    const cel = celulasMap.get(k);
    if (cel) idsSelecionados.push(cel.id);
  }

  const items = [
    { label: '+ camada acima', onClick: () => addCamadaRelativa(camadaId, 'acima') },
    { label: '+ camada abaixo', onClick: () => addCamadaRelativa(camadaId, 'abaixo') },
    { sep: true },
    { label: 'renomear', shortcut: 'F2', onClick: () => renomearCamadaPorId(camadaId) },
    { label: cam.visivel ? 'ocultar' : 'mostrar', onClick: () => alternarVisibilidade(camadaId) },
    { sep: true },
    { label: 'prompt pra todos os quadros desta camada', onClick: () => abrirModalPrompt({ tipo: 'camada', ids: idsCamada, contexto: `vai aplicar em ${idsCamada.length} célula${idsCamada.length === 1 ? '' : 's'} (camada "${cam.nome}" × todos os quadros)` }) },
  ];
  if (outrasCamadasNaSel) {
    items.push({ label: `prompt pros selecionados (${idsSelecionados.length})`, onClick: () => abrirModalPrompt({ tipo: 'selected' }) });
  }
  items.push({ sep: true });
  items.push({ label: 'deletar camada', danger: true, disabled: camadasOrdenadas.length <= 1, onClick: () => deletarCamadaConfirm(camadaId) });
  montarMenuCtx(ev, items);
}

function abrirMenuQuadro(ev, quadroId) {
  if (!tirinha) return;
  // Seleciona a coluna inteira se não estava selecionada.
  const todasNaSelecao = camadasOrdenadas.every((c) => selecionadas.has(keyOf(c.id, quadroId)));
  if (!todasNaSelecao) {
    selecionadas.clear();
    for (const c of camadasOrdenadas) selecionadas.add(keyOf(c.id, quadroId));
    const qIdx = quadrosOrdenados.findIndex((q) => q.id === quadroId);
    if (qIdx >= 0) activeQuadroIdx = qIdx;
    atualizarSelecaoUI();
    renderMatrix();
    renderCanvas();
  }
  const outrosQuadrosNaSel = [...selecionadas].some((k) => k.split(':')[1] !== quadroId);
  const idsQuadro = (tirinha.celulas || []).filter((c) => c.quadro_id === quadroId).map((c) => c.id);
  const q = quadrosOrdenados.find((qq) => qq.id === quadroId);
  if (!q) return;
  const items = [
    { label: '+ quadro à esquerda', onClick: () => addQuadroRelativo(quadroId, 'esquerda') },
    { label: '+ quadro à direita', onClick: () => addQuadroRelativo(quadroId, 'direita') },
    { sep: true },
    { label: 'prompt pra todas as camadas deste quadro', onClick: () => abrirModalPrompt({ tipo: 'quadro', ids: idsQuadro, contexto: `vai aplicar em ${idsQuadro.length} célula${idsQuadro.length === 1 ? '' : 's'} (quadro ${q.indice + 1} × todas as camadas)` }) },
  ];
  if (outrosQuadrosNaSel) {
    const n = selecionadas.size;
    items.push({ label: `prompt pros selecionados (${n})`, onClick: () => abrirModalPrompt({ tipo: 'selected' }) });
  }
  items.push({ sep: true });
  items.push({ label: 'deletar quadro', danger: true, disabled: quadrosOrdenados.length <= 1, onClick: () => deletarQuadroConfirm(quadroId) });
  montarMenuCtx(ev, items);
}

function abrirMenuCelula(ev, camadaId, quadroId) {
  if (!tirinha) return;
  const k = keyOf(camadaId, quadroId);
  // Se a célula não está selecionada, seleciona só ela.
  if (!selecionadas.has(k)) {
    selecionadas.clear();
    selecionadas.add(k);
    activeCelKey = k;
    const qIdx = quadrosOrdenados.findIndex((q) => q.id === quadroId);
    if (qIdx >= 0) activeQuadroIdx = qIdx;
    atualizarSelecaoUI();
    renderMatrix();
    renderCanvas();
  }
  const cel = celulasMap.get(k);
  const temPng = !!(cel && cel.png_url);
  const items = [
    { label: 'prompt nesta célula', disabled: !cel || cel.estado === 'processando', onClick: () => abrirModalPrompt({ tipo: 'cell', ids: cel ? [cel.id] : [], contexto: `vai aplicar em 1 célula` }) },
  ];
  if (selecionadas.size > 1) {
    items.push({ label: `prompt pros selecionados (${selecionadas.size})`, onClick: () => abrirModalPrompt({ tipo: 'selected' }) });
  }
  if (temPng) {
    items.push({ sep: true });
    items.push({ label: 'limpar célula', danger: true, disabled: cel.estado === 'processando', onClick: () => limparCelulaConfirm(cel.id) });
  }
  montarMenuCtx(ev, items);
}

// Fecha menu ao clicar fora ou pressionar Esc.
document.addEventListener('click', (e) => {
  if (!$cm || $cm.hasAttribute('hidden')) return;
  if (e.target.closest('.fe-context-menu')) return;
  fecharMenuCtx();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $cm && !$cm.hasAttribute('hidden')) {
    e.stopPropagation();
    e.preventDefault();
    fecharMenuCtx();
  }
}, true);
// Anti-padrão: cancela o menu nativo do browser em qualquer área do editor.
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.screen-fe-editor')) {
    // Só permite o nativo dentro de campos de texto/inputs (rename inline, prompt textarea).
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    e.preventDefault();
  }
});

// =====================================================================
// Operações otimistas — mutam estado local e disparam request em background.
// Em caso de falha, recarregam o estado real do servidor.
// =====================================================================

async function reloadAndRender() {
  if (!tirinha) return;
  const data = await getTirinha(tirinha.id);
  if (!data) return;
  await aplicarEstadoTirinha(data);
}

async function addCamadaTopo() {
  // "topo" = maior `ordem` (em cima visualmente).
  const ordemMax = camadasOrdenadas.length ? Math.max(...camadasOrdenadas.map((c) => c.ordem)) : -1;
  try {
    await addCamada(tirinha.id, { nome: `camada ${camadasOrdenadas.length + 1}`, ordem: ordemMax + 1 });
    await reloadAndRender();
  } catch (err) { showToast('falha ao adicionar camada: ' + err.message); }
}

async function addQuadroFim() {
  try {
    await addQuadro(tirinha.id, {});
    const data = await getTirinha(tirinha.id);
    activeQuadroIdx = data.quadros.length - 1;
    await aplicarEstadoTirinha(data);
  } catch (err) { showToast('falha ao adicionar quadro: ' + err.message); }
}

async function addCamadaRelativa(refCamadaId, posicao) {
  // posicao: 'acima' | 'abaixo' (visual). Camada com ordem maior aparece em cima.
  const ref = camadasOrdenadas.find((c) => c.id === refCamadaId);
  if (!ref) return;
  const novaOrdem = posicao === 'acima' ? ref.ordem + 1 : ref.ordem;
  // A rota POST com `ordem` empurra os existentes >= ordem em +1, então:
  // - "acima": insere com ordem = ref.ordem + 1 (acima da ref).
  // - "abaixo": insere com ordem = ref.ordem (que vira ref.ordem+1, então ela sobe; nova fica embaixo).
  try {
    await addCamada(tirinha.id, { nome: `camada ${camadasOrdenadas.length + 1}`, ordem: novaOrdem });
    await reloadAndRender();
  } catch (err) { showToast('falha ao adicionar camada: ' + err.message); }
}

async function addQuadroRelativo(refQuadroId, lado) {
  // lado: 'esquerda' | 'direita'
  const ref = quadrosOrdenados.find((q) => q.id === refQuadroId);
  if (!ref) return;
  const novoIndice = lado === 'esquerda' ? ref.indice : ref.indice + 1;
  try {
    await addQuadro(tirinha.id, { indice: novoIndice });
    const data = await getTirinha(tirinha.id);
    activeQuadroIdx = novoIndice;
    await aplicarEstadoTirinha(data);
  } catch (err) { showToast('falha ao adicionar quadro: ' + err.message); }
}

async function alternarVisibilidade(camadaId) {
  const cam = camadasOrdenadas.find((c) => c.id === camadaId);
  if (!cam) return;
  // Otimista.
  cam.visivel = !cam.visivel;
  renderMatrix();
  renderCanvas();
  try {
    const updated = await patchCamada(camadaId, { visivel: cam.visivel });
    cam.visivel = updated.visivel;
  } catch (err) {
    showToast('falha: ' + err.message);
    cam.visivel = !cam.visivel;
    renderMatrix();
    renderCanvas();
  }
}

function renomearCamadaPorId(camadaId) {
  const cam = camadasOrdenadas.find((c) => c.id === camadaId);
  if (!cam) return;
  // Acha o botão de nome e dispara rename.
  const $btn = $matrix.querySelector(`.fe-cam-name[data-cam-id="${camadaId}"]`);
  if ($btn) iniciarRenameCamada(cam, $btn);
}

async function deletarCamadaConfirm(camadaId) {
  const cam = camadasOrdenadas.find((c) => c.id === camadaId);
  if (!cam) return;
  if (camadasOrdenadas.length <= 1) {
    showToast('a tirinha precisa ter pelo menos uma camada');
    return;
  }
  const ok = await confirmModal({
    title: 'deletar camada',
    message: `apagar a camada "${cam.nome}" e todas as suas células? não dá pra desfazer.`,
    confirmLabel: 'apagar',
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteCamada(camadaId);
    selecionadas.clear();
    activeCelKey = null;
    await reloadAndRender();
    showToast('camada apagada');
  } catch (err) { showToast('falha ao apagar: ' + err.message); }
}

async function deletarQuadroConfirm(quadroId) {
  const q = quadrosOrdenados.find((qq) => qq.id === quadroId);
  if (!q) return;
  if (quadrosOrdenados.length <= 1) {
    showToast('a tirinha precisa ter pelo menos um quadro');
    return;
  }
  const ok = await confirmModal({
    title: 'deletar quadro',
    message: `apagar o quadro ${q.indice + 1} e todas as suas células? não dá pra desfazer.`,
    confirmLabel: 'apagar',
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteQuadro(quadroId);
    selecionadas.clear();
    activeCelKey = null;
    if (activeQuadroIdx >= quadrosOrdenados.length - 1) activeQuadroIdx = Math.max(0, activeQuadroIdx - 1);
    await reloadAndRender();
    showToast('quadro apagado');
  } catch (err) { showToast('falha ao apagar: ' + err.message); }
}

async function limparCelulaConfirm(celulaId) {
  const ok = await confirmModal({
    title: 'limpar célula',
    message: `apagar o PNG desta célula (volta a ficar vazia)? não dá pra desfazer.`,
    confirmLabel: 'limpar',
    danger: true,
  });
  if (!ok) return;
  try {
    await patchCelula(celulaId, { png_url: null });
    await reloadAndRender();
    showToast('célula limpa');
  } catch (err) { showToast('falha: ' + err.message); }
}

// F2 = renomear camada ativa (a que tem a célula ativa, ou a primeira da seleção).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'F2') return;
  // Só age se o foco não está num input/textarea.
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  // Só na tela do editor (chrome.js seta data-screen no body).
  if (document.body.getAttribute('data-screen') !== 'fe-editor') return;
  if (!tirinha || !camadasOrdenadas.length) return;
  let camadaId = null;
  if (activeCelKey) camadaId = activeCelKey.split(':')[0];
  else if (selecionadas.size) camadaId = [...selecionadas][0].split(':')[0];
  else camadaId = camadasOrdenadas[0].id;
  e.preventDefault();
  renomearCamadaPorId(camadaId);
});

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
  fecharMenuCtx();
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

// Zoom
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="fe-zoom-in"]')) {
    zoom = Math.min(zoom * 2, 32);
    $zoomLabel.textContent = `${zoom}×`;
    renderCanvas();
  } else if (e.target.closest('[data-action="fe-zoom-out"]')) {
    zoom = Math.max(zoom / 2, 1);
    $zoomLabel.textContent = `${zoom}×`;
    renderCanvas();
  }
});

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

// Botão "prompt" da discoverbar: contextual.
// - sem seleção → prompt em todos os quadros
// - com seleção → prompt nas células selecionadas
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fe-prompt-context"]')) return;
  if (!tirinha) return;
  if (selecionadas.size === 0) abrirModalPrompt({ tipo: 'all' });
  else abrirModalPrompt({ tipo: 'selected' });
});

// Modal de prompt — alvos resolvidos antes de abrir, salvos em `promptAlvosIds`.
let promptAlvosIds = [];
function abrirModalPrompt({ tipo, ids = null, contexto = null }) {
  // tipo: 'all' | 'selected' | 'cell' | 'camada' | 'quadro'
  let titulo, alvo;
  if (tipo === 'all') {
    promptAlvosIds = (tirinha.celulas || []).map((c) => c.id);
    const total = camadasOrdenadas.length * quadrosOrdenados.length;
    titulo = 'Prompt pra todos os quadros';
    alvo = `vai aplicar em ${total} célula${total === 1 ? '' : 's'} (todas as camadas × todos os quadros)`;
  } else if (tipo === 'selected') {
    promptAlvosIds = [];
    for (const k of selecionadas) {
      const cel = celulasMap.get(k);
      if (cel && cel.estado !== 'processando') promptAlvosIds.push(cel.id);
    }
    const n = promptAlvosIds.length;
    titulo = 'Prompt pros selecionados';
    alvo = `vai aplicar em ${n} célula${n === 1 ? '' : 's'} selecionada${n === 1 ? '' : 's'}`;
  } else if (tipo === 'cell') {
    promptAlvosIds = ids || [];
    titulo = 'Prompt nesta célula';
    alvo = contexto || `vai aplicar em 1 célula`;
  } else if (tipo === 'camada') {
    promptAlvosIds = ids || [];
    titulo = 'Prompt pra camada inteira';
    alvo = contexto || `vai aplicar em ${promptAlvosIds.length} célula${promptAlvosIds.length === 1 ? '' : 's'} desta camada`;
  } else if (tipo === 'quadro') {
    promptAlvosIds = ids || [];
    titulo = 'Prompt pro quadro inteiro';
    alvo = contexto || `vai aplicar em ${promptAlvosIds.length} célula${promptAlvosIds.length === 1 ? '' : 's'} deste quadro`;
  } else {
    promptAlvosIds = ids || [];
    titulo = 'Prompt';
    alvo = contexto || `vai aplicar em ${promptAlvosIds.length} célula${promptAlvosIds.length === 1 ? '' : 's'}`;
  }
  const m = document.querySelector('[data-modal="fe-prompt"]');
  m.querySelector('[data-bind="fe-prompt-text"]').value = '';
  m.querySelector('[data-bind="fe-prompt-err"]').textContent = '';
  m.querySelector('[data-bind="fe-prompt-title"]').textContent = titulo;
  m.querySelector('[data-bind="fe-prompt-target"]').textContent = alvo;
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

  // Filtra IDs pra ignorar células já em processamento.
  const alvosIds = promptAlvosIds.filter((id) => {
    for (const cel of celulasMap.values()) {
      if (cel.id === id) return cel.estado !== 'processando';
    }
    return true;
  });
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
