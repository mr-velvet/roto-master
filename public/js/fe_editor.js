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
    img.onload = () => { imgCache.set(url, img); resolve(img); };
    img.onerror = (e) => reject(new Error('img load failed: ' + url));
    img.src = url;
  });
}

// Variante que carrega via /api/fe/proxy-png para liberar getImageData no canvas.
// O bucket GCS não responde CORS, então a imagem direta tainta o canvas.
async function loadImageForPixels(url) {
  const proxied = '/api/fe/proxy-png?url=' + encodeURIComponent(url);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('proxy img load failed: ' + url));
    img.src = proxied;
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
  // Reescala pro tamanho do canvas da tirinha — PNG da IA pode vir num tamanho
  // qualquer (1024×1024 etc.), mas o cel chunk precisa bater com a header do
  // .aseprite (largura/altura da tirinha). Carrega via proxy pra contornar CORS
  // do GCS (canvas tainted = getImageData lança SecurityError).
  const W = tirinha.largura;
  const H = tirinha.altura;
  const celulasOut = [];
  for (let ci = 0; ci < camadasAsc.length; ci++) {
    for (let qi = 0; qi < quadrosAsc.length; qi++) {
      const cel = celulasMap.get(keyOf(camadasAsc[ci].id, quadrosAsc[qi].id));
      if (!cel || !cel.png_url) continue;
      try {
        const img = await loadImageForPixels(cel.png_url);
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
        const id = ctx.getImageData(0, 0, W, H);
        celulasOut.push({
          camada_indice: ci,
          quadro_indice: qi,
          pixels_rgba: new Uint8Array(id.data.buffer.slice(0)),
          largura: W,
          altura: H,
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
