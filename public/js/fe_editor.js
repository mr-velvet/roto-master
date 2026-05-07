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
  addCamada, patchCamada, deleteCamada, addQuadro, deleteQuadro,
  uploadAseprite, dispararPrompt,
  publicarComoAsset,
} from './fe_api.js';
import { listProjects } from './projects_api.js';
import { openModal, closeModal, showToast, confirmModal } from './modals.js';
import { navigateFeHome } from './router.js';
import { buildAsepriteDoFrameEditor } from './aseprite_io.js';

// === Estado local da tirinha em edição ===
//
// Otimismo: operações da Tela 2 mutam o estado local imediato e disparam
// request em background. Se falhar, revertem via snapshot e mostram toast.
// Polling continua ativo pra reconciliar células `processando`, mas pula
// entidades marcadas como `inFlight` pra não brigar com operações pendentes.
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

// Play (timeline)
const PLAY_DEFAULT_MS = 100;
let isPlaying = false;
let playTimer = null;
let playSavedQuadroIdx = 0;

// === Otimismo: tracking de operações pendentes ===
// Set de "kind:id" (ex: "camada:abc-123", "quadro:xxx", "tirinha:nome",
// "celula:k") marcados como in-flight. Polling ignora reconciliação dessas
// entidades enquanto pendentes (impede que uma resposta antiga sobreponha
// uma operação otimista mais recente que ainda não voltou).
const inFlight = new Set();

// Counter pra IDs provisórios em adições otimistas.
let tmpCounter = 0;
function nextTmpId() { return `tmp-${++tmpCounter}`; }
function isTmpId(id) { return typeof id === 'string' && id.startsWith('tmp-'); }

// Estado do indicador "salvando/erro" por chave (para mostrar dots/ borders).
// kind = 'camada' | 'quadro' | 'tirinha' | 'celula' (chave varia)
const syncState = new Map(); // key → 'syncing' | 'error'
function setSync(key, state) {
  if (state) syncState.set(key, state);
  else syncState.delete(key);
}
function getSync(key) { return syncState.get(key) || null; }

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
const $playBtn = document.querySelector('[data-bind="fe-play-btn"]');
const $playIcon = document.querySelector('[data-bind="fe-play-icon"]');
const $playLabel = document.querySelector('[data-bind="fe-play-label"]');

// === Helper otimista ===
// applyFn: muta estado local imediato. Recebe um obj `ctx` mutável que
//   apply pode preencher (ex: ctx.tmpId pra rollback usar).
// networkFn(ctx): roda o request. Se sucede, aplica `finalizeFn(result, ctx)`.
// rollbackFn(ctx): reverte estado se network falhar.
// flightKey: string única tipo "camada:abc" pra marcar como in-flight.
async function optimistic({ flightKey, label, applyFn, networkFn, finalizeFn, rollbackFn }) {
  const ctx = {};
  applyFn(ctx);
  if (flightKey) {
    inFlight.add(flightKey);
    setSync(flightKey, 'syncing');
  }
  // Re-render pra mostrar estado já + indicador "salvando".
  renderMatrix();
  try {
    const result = await networkFn(ctx);
    if (finalizeFn) finalizeFn(result, ctx);
    if (flightKey) {
      setSync(flightKey, null);
      inFlight.delete(flightKey);
    }
    renderMatrix();
  } catch (err) {
    console.error(`optimistic ${label || flightKey} falhou:`, err);
    if (rollbackFn) rollbackFn(ctx);
    if (flightKey) {
      // Mostra erro brevemente, depois limpa.
      setSync(flightKey, 'error');
      inFlight.delete(flightKey);
      setTimeout(() => {
        if (getSync(flightKey) === 'error') {
          setSync(flightKey, null);
          renderMatrix();
        }
      }, 2500);
    }
    showToast(`falha ao ${label || 'salvar'} — tente de novo`);
    renderMatrix();
    await renderCanvas().catch(() => {});
  }
}

// Helper: substitui id provisório por id real em todas as estruturas locais.
function remapId(kind, oldId, newId) {
  if (oldId === newId) return;
  if (kind === 'camada') {
    for (const c of camadasOrdenadas) if (c.id === oldId) c.id = newId;
    if (tirinha?.camadas) for (const c of tirinha.camadas) if (c.id === oldId) c.id = newId;
    // Remapeia células que apontam pra essa camada.
    const novoMap = new Map();
    for (const [k, cel] of celulasMap) {
      if (cel.camada_id === oldId) cel.camada_id = newId;
      novoMap.set(keyOf(cel.camada_id, cel.quadro_id), cel);
    }
    celulasMap = novoMap;
    if (tirinha?.celulas) for (const cel of tirinha.celulas) if (cel.camada_id === oldId) cel.camada_id = newId;
  } else if (kind === 'quadro') {
    for (const q of quadrosOrdenados) if (q.id === oldId) q.id = newId;
    if (tirinha?.quadros) for (const q of tirinha.quadros) if (q.id === oldId) q.id = newId;
    const novoMap = new Map();
    for (const [k, cel] of celulasMap) {
      if (cel.quadro_id === oldId) cel.quadro_id = newId;
      novoMap.set(keyOf(cel.camada_id, cel.quadro_id), cel);
    }
    celulasMap = novoMap;
    if (tirinha?.celulas) for (const cel of tirinha.celulas) if (cel.quadro_id === oldId) cel.quadro_id = newId;
  }
  // Atualiza activeCelKey/seleção se estiverem apontando pro id antigo.
  const fixKey = (k) => {
    const [c, q] = k.split(':');
    const nc = (kind === 'camada' && c === oldId) ? newId : c;
    const nq = (kind === 'quadro' && q === oldId) ? newId : q;
    return keyOf(nc, nq);
  };
  if (activeCelKey) activeCelKey = fixKey(activeCelKey);
  const novaSel = new Set();
  for (const k of selecionadas) novaSel.add(fixKey(k));
  selecionadas = novaSel;
}

// === Entry point ===
export async function showFeEditor(id) {
  selecionadas.clear();
  activeCelKey = null;
  activeQuadroIdx = 0;
  imgCache.clear();
  inFlight.clear();
  syncState.clear();
  stopPolling();
  stopPlay({ restore: false });
  $matrix.innerHTML = '';

  let data;
  try {
    data = await getTirinha(id);
  } catch (e) {
    showToast('falha ao carregar tirinha');
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
  // Guarda o estado do play pra restaurar depois (re-aplica vinda do polling não pode parar play)
  const wasPlaying = isPlaying;
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }

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
  atualizarPlayUI();
  agendarPollingSeNecessario();

  // Se estava tocando, retoma do quadro atual (não interrompe)
  if (wasPlaying && quadrosOrdenados.length) {
    isPlaying = true;
    atualizarPlayUI();
    atualizarColHeadAtivo();
    const q = quadrosOrdenados[activeQuadroIdx];
    playTimer = setTimeout(tickPlay, duracaoDoQuadro(q));
  }
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
    const sync = getSync(`quadro:${q.id}`);
    if (sync === 'syncing') head.classList.add('is-syncing');
    if (sync === 'error') head.classList.add('is-sync-error');
    head.addEventListener('click', (e) => selecionarColuna(q.id, e));
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      pedirDeleteQuadro(q);
    });
    if (sync) {
      const dot = document.createElement('span');
      dot.className = 'fe-sync-dot';
      if (sync === 'error') dot.dataset.state = 'error';
      head.appendChild(dot);
    }
    $matrix.appendChild(head);
  }

  // cada linha (camada)
  for (const cam of camadasOrdenadas) {
    // header de linha
    const rowHead = document.createElement('div');
    rowHead.className = 'fe-matrix-row-head';
    const camSync = getSync(`camada:${cam.id}`);
    if (camSync === 'syncing') rowHead.classList.add('is-syncing');
    if (camSync === 'error') rowHead.classList.add('is-sync-error');
    rowHead.innerHTML = `
      <button class="fe-cam-vis" data-cam-id="${cam.id}" type="button" title="alternar visibilidade">${cam.visivel ? '◉' : '○'}</button>
      <button class="fe-cam-name" data-cam-id="${cam.id}" type="button" title="clique pra selecionar linha · duplo-clique pra renomear · botão direito pra apagar">${escapeHtml(cam.nome)}</button>
    `;
    if (camSync) {
      const dot = document.createElement('span');
      dot.className = 'fe-sync-dot';
      if (camSync === 'error') dot.dataset.state = 'error';
      rowHead.appendChild(dot);
    }
    rowHead.querySelector('.fe-cam-vis').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleVisibilidadeCamada(cam);
    });
    const $camNameBtn = rowHead.querySelector('.fe-cam-name');
    $camNameBtn.addEventListener('click', (e) => selecionarLinha(cam.id, e));
    $camNameBtn.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      iniciarRenameCamada(cam, $camNameBtn);
    });
    $camNameBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pedirDeleteCamada(cam);
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
      // Sync state da célula (raro, mas o slot existe).
      const celSync = cel ? getSync(`celula:${cel.id || k}`) : null;
      if (celSync === 'syncing') $cell.classList.add('is-syncing');
      if (celSync === 'error') $cell.classList.add('is-sync-error');
      if (celSync) {
        const dot = document.createElement('span');
        dot.className = 'fe-sync-dot';
        if (celSync === 'error') dot.dataset.state = 'error';
        $cell.appendChild(dot);
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
  if (isPlaying) stopPlay({ restore: false });
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
  if (isPlaying) stopPlay({ restore: false });
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
  if (isPlaying) stopPlay({ restore: false });
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
  // O botão secundário já comunica a contagem — só mostra summary detalhado
  // quando há seleção, pra reforçar a hierarquia (primário sempre no comando).
  if (n === 0) {
    $selSummary.textContent = '';
    $selSummary.classList.add('is-empty');
  } else if (n === 1) {
    $selSummary.textContent = '1 célula selecionada';
    $selSummary.classList.remove('is-empty');
  } else {
    $selSummary.textContent = `${n} células selecionadas`;
    $selSummary.classList.remove('is-empty');
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

// === Rename de camada (otimista) ===
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
  const finalize = (commit) => {
    if (settled) return;
    settled = true;
    const novo = $input.value.trim();
    if (commit && novo && novo !== original) {
      // Otimista: aplica nome novo agora, request em background.
      // Não esperamos o request — UI já mostra novo nome.
      // ID provisório? Não — rename de camada existente, ID é real.
      // Mas pulamos se for tmp- (camada ainda não confirmada no servidor): nesse
      // caso, esperamos a confirmação da criação primeiro pra evitar PATCHar id
      // inexistente. Para simplificar: se camada ainda é tmp, só muta local
      // (será gravado quando der createCamada — que envia o nome inicial; renomes
      // posteriores enquanto pendente serão perdidos. Vivível pro MVP.)
      if (isTmpId(cam.id)) {
        cam.nome = novo;
        renderMatrix();
        return;
      }
      optimistic({
        flightKey: `camada:${cam.id}`,
        label: 'renomear camada',
        applyFn: () => { cam.nome = novo; },
        networkFn: () => patchCamada(cam.id, { nome: novo }),
        finalizeFn: (updated) => { if (updated?.nome) cam.nome = updated.nome; },
        rollbackFn: () => { cam.nome = original; },
      });
    } else {
      renderMatrix();
    }
  };
  $input.addEventListener('blur', () => finalize(true));
  $input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finalize(true);
    if (e.key === 'Escape') finalize(false);
  });
}

// === Toggle visibilidade da camada (otimista) ===
function toggleVisibilidadeCamada(cam) {
  if (isTmpId(cam.id)) {
    // Aguarda criação concluir; toggle local + re-render mas sem network.
    cam.visivel = !cam.visivel;
    renderMatrix();
    renderCanvas();
    return;
  }
  const original = cam.visivel;
  optimistic({
    flightKey: `camada:${cam.id}`,
    label: 'alternar visibilidade',
    applyFn: () => { cam.visivel = !original; },
    networkFn: () => patchCamada(cam.id, { visivel: !original }),
    finalizeFn: (updated) => { if (typeof updated?.visivel === 'boolean') cam.visivel = updated.visivel; },
    rollbackFn: () => { cam.visivel = original; },
  });
  renderCanvas();
}

// === Delete de camada (otimista, com confirm) ===
async function pedirDeleteCamada(cam) {
  if (camadasOrdenadas.length <= 1) {
    showToast('a tirinha precisa de ao menos 1 camada');
    return;
  }
  const ok = await confirmModal({
    title: 'apagar camada',
    message: `apagar "${cam.nome}" e todas as suas células?`,
    danger: true,
    confirmLabel: 'apagar',
  });
  if (!ok) return;
  if (isTmpId(cam.id)) {
    showToast('aguarde a camada ser criada antes de apagar');
    return;
  }
  // Snapshot pra rollback.
  const snap = {
    cam: { ...cam },
    celulas: [],
  };
  for (const [k, cel] of celulasMap) {
    if (cel.camada_id === cam.id) snap.celulas.push({ key: k, cel });
  }
  optimistic({
    flightKey: `camada:${cam.id}`,
    label: 'apagar camada',
    applyFn: () => {
      camadasOrdenadas = camadasOrdenadas.filter((c) => c.id !== cam.id);
      if (tirinha?.camadas) tirinha.camadas = tirinha.camadas.filter((c) => c.id !== cam.id);
      for (const { key } of snap.celulas) celulasMap.delete(key);
      if (tirinha?.celulas) tirinha.celulas = tirinha.celulas.filter((c) => c.camada_id !== cam.id);
      // Limpa seleção/active que apontavam pra essa camada.
      const novaSel = new Set();
      for (const k of selecionadas) if (k.split(':')[0] !== cam.id) novaSel.add(k);
      selecionadas = novaSel;
      if (activeCelKey && activeCelKey.split(':')[0] === cam.id) activeCelKey = null;
      atualizarSelecaoUI();
    },
    networkFn: () => deleteCamada(cam.id),
    rollbackFn: () => {
      // Restaura camada e células.
      camadasOrdenadas.push(snap.cam);
      camadasOrdenadas.sort((a, b) => b.ordem - a.ordem);
      if (tirinha) tirinha.camadas = [...(tirinha.camadas || []), snap.cam];
      for (const { key, cel } of snap.celulas) celulasMap.set(key, cel);
      if (tirinha) tirinha.celulas = [...(tirinha.celulas || []), ...snap.celulas.map((s) => s.cel)];
    },
  });
  renderCanvas();
}

// === Delete de quadro (otimista, com confirm) ===
async function pedirDeleteQuadro(q) {
  if (quadrosOrdenados.length <= 1) {
    showToast('a tirinha precisa de ao menos 1 quadro');
    return;
  }
  const ok = await confirmModal({
    title: 'apagar quadro',
    message: `apagar quadro ${q.indice + 1} e todas as suas células?`,
    danger: true,
    confirmLabel: 'apagar',
  });
  if (!ok) return;
  if (isTmpId(q.id)) {
    showToast('aguarde o quadro ser criado antes de apagar');
    return;
  }
  const snap = {
    q: { ...q },
    celulas: [],
    indicesAjustados: [], // quadros que terão indice reajustado pra refletir reindex do servidor
  };
  for (const [k, cel] of celulasMap) {
    if (cel.quadro_id === q.id) snap.celulas.push({ key: k, cel });
  }
  // Captura snapshot dos indices originais (rollback restaura).
  const snapIndices = quadrosOrdenados.map((qq) => ({ id: qq.id, indice: qq.indice }));
  optimistic({
    flightKey: `quadro:${q.id}`,
    label: 'apagar quadro',
    applyFn: () => {
      quadrosOrdenados = quadrosOrdenados.filter((qq) => qq.id !== q.id);
      // Reindexa locais (espelha o que o servidor faz).
      quadrosOrdenados.sort((a, b) => a.indice - b.indice);
      quadrosOrdenados.forEach((qq, i) => { qq.indice = i; });
      if (tirinha?.quadros) {
        tirinha.quadros = tirinha.quadros.filter((qq) => qq.id !== q.id);
        for (const qq of tirinha.quadros) {
          const found = quadrosOrdenados.find((x) => x.id === qq.id);
          if (found) qq.indice = found.indice;
        }
      }
      for (const { key } of snap.celulas) celulasMap.delete(key);
      if (tirinha?.celulas) tirinha.celulas = tirinha.celulas.filter((c) => c.quadro_id !== q.id);
      const novaSel = new Set();
      for (const k of selecionadas) if (k.split(':')[1] !== q.id) novaSel.add(k);
      selecionadas = novaSel;
      if (activeCelKey && activeCelKey.split(':')[1] === q.id) activeCelKey = null;
      if (activeQuadroIdx >= quadrosOrdenados.length) activeQuadroIdx = quadrosOrdenados.length - 1;
      atualizarSelecaoUI();
    },
    networkFn: () => deleteQuadro(q.id),
    rollbackFn: () => {
      // Restaura quadro e indices originais.
      quadrosOrdenados.push(snap.q);
      // Restaura indices conforme snapshot.
      for (const qq of quadrosOrdenados) {
        const orig = snapIndices.find((x) => x.id === qq.id);
        if (orig) qq.indice = orig.indice;
      }
      quadrosOrdenados.sort((a, b) => a.indice - b.indice);
      if (tirinha) {
        tirinha.quadros = [...(tirinha.quadros || []), snap.q];
        for (const qq of tirinha.quadros) {
          const orig = snapIndices.find((x) => x.id === qq.id);
          if (orig) qq.indice = orig.indice;
        }
      }
      for (const { key, cel } of snap.celulas) celulasMap.set(key, cel);
      if (tirinha) tirinha.celulas = [...(tirinha.celulas || []), ...snap.celulas.map((s) => s.cel)];
    },
  });
  renderCanvas();
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
    // Conflito polling × otimismo: se há operação otimista pendente, adiar o
    // poll. Caso contrário, o reload via aplicarEstadoTirinha sobrescreveria
    // a mutação local que ainda nem chegou no banco.
    if (inFlight.size > 0) {
      agendarPollingSeNecessario();
      return;
    }
    try {
      const data = await getTirinha(tirinha.id);
      if (!data || data.id !== tirinha.id) return;
      // Re-checa: pode ter chegado uma operação otimista entre a chamada e
      // a resposta. Se chegou, descarta esse snapshot e tenta de novo depois.
      if (inFlight.size > 0) {
        agendarPollingSeNecessario();
        return;
      }
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

// === Play (timeline) ===
// Toca quadro-a-quadro estilo Aseprite. Loop infinito. Não persiste nada.
// Compósito de cada quadro = camadas visíveis em ordem ASC (já feito por renderCanvas).
function duracaoDoQuadro(q) {
  const d = q && typeof q.duracao_ms === 'number' ? q.duracao_ms : null;
  if (d && d > 0) return d;
  return PLAY_DEFAULT_MS;
}

async function precarregarQuadrosVisiveis() {
  // Pré-carrega todos os PNGs visíveis pra o play não engasgar no primeiro ciclo.
  const urls = new Set();
  for (const cam of camadasOrdenadas) {
    if (!cam.visivel) continue;
    for (const q of quadrosOrdenados) {
      const cel = celulasMap.get(keyOf(cam.id, q.id));
      if (cel && cel.png_url) urls.add(cel.png_url);
    }
  }
  await Promise.all([...urls].map((u) => loadImage(u).catch(() => null)));
}

function atualizarPlayUI() {
  if (!$playBtn) return;
  if (isPlaying) {
    $playBtn.classList.add('is-playing');
    if ($playIcon) $playIcon.textContent = '⏸';
    if ($playLabel) $playLabel.textContent = 'pause';
    $playBtn.title = 'pausar (espaço)';
  } else {
    $playBtn.classList.remove('is-playing');
    if ($playIcon) $playIcon.textContent = '▶';
    if ($playLabel) $playLabel.textContent = 'play';
    $playBtn.title = 'tocar animação quadro a quadro (espaço)';
  }
}

function atualizarColHeadAtivo() {
  // Sem rebuild da matriz inteira — só troca a classe is-active dos col-heads.
  const heads = $matrix.querySelectorAll('.fe-matrix-col-head');
  heads.forEach((h, i) => h.classList.toggle('is-active', i === activeQuadroIdx));
}

async function startPlay() {
  if (isPlaying) return;
  if (!quadrosOrdenados.length) return;
  isPlaying = true;
  playSavedQuadroIdx = activeQuadroIdx;
  atualizarPlayUI();
  await precarregarQuadrosVisiveis();
  if (!isPlaying) return; // pausou enquanto carregava
  if (playTimer) return;  // já agendado por outra origem (re-aplica estado)
  // primeiro tick imediato pra dar feedback
  tickPlay();
}

function tickPlay() {
  if (!isPlaying) return;
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  const total = quadrosOrdenados.length;
  if (!total) { stopPlay({ restore: true }); return; }
  // avança pro próximo quadro (com wrap)
  activeQuadroIdx = (activeQuadroIdx + 1) % total;
  // info textual + col-head ativo, sem rebuild
  if ($frameInfo) $frameInfo.textContent = `quadro ${activeQuadroIdx + 1} / ${total}`;
  atualizarColHeadAtivo();
  // re-render só do canvas
  renderCanvas();
  const q = quadrosOrdenados[activeQuadroIdx];
  const ms = duracaoDoQuadro(q);
  playTimer = setTimeout(tickPlay, ms);
}

function stopPlay({ restore = true } = {}) {
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  if (!isPlaying) {
    atualizarPlayUI();
    return;
  }
  isPlaying = false;
  atualizarPlayUI();
  if (restore && quadrosOrdenados.length) {
    if (playSavedQuadroIdx >= quadrosOrdenados.length) playSavedQuadroIdx = quadrosOrdenados.length - 1;
    if (playSavedQuadroIdx < 0) playSavedQuadroIdx = 0;
    activeQuadroIdx = playSavedQuadroIdx;
    if ($frameInfo) $frameInfo.textContent = `quadro ${activeQuadroIdx + 1} / ${quadrosOrdenados.length}`;
    atualizarColHeadAtivo();
    renderCanvas();
  }
}

function togglePlay() {
  if (isPlaying) stopPlay({ restore: true }); else startPlay();
}

// === Handlers globais ===

// Voltar
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fe-back"]')) return;
  stopPolling();
  stopPlay({ restore: false });
  navigateFeHome();
});

// Sair da tela (header alternador, etc.) também pausa o play.
window.addEventListener('hashchange', () => {
  const h = window.location.hash || '';
  if (!/^#\/fe\/t\//.test(h) && isPlaying) {
    stopPlay({ restore: false });
  }
});

// Play / Pause (botão)
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fe-toggle-play"]')) return;
  if (!tirinha) return;
  togglePlay();
});

// Atalhos de teclado: espaço (play/pause), ← / → (navegar quadros).
// Só ativa se a tela do editor está visível e o foco não está num campo de texto.
document.addEventListener('keydown', (e) => {
  if (!tirinha) return;
  if (document.body.getAttribute('data-screen') !== 'fe-editor') return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    togglePlay();
    return;
  }
  if (isPlaying) return; // setas só navegam quando pausado
  if (e.key === 'ArrowLeft') {
    if (activeQuadroIdx > 0) {
      activeQuadroIdx--;
      renderMatrix();
      renderCanvas();
    }
  } else if (e.key === 'ArrowRight') {
    if (activeQuadroIdx < quadrosOrdenados.length - 1) {
      activeQuadroIdx++;
      renderMatrix();
      renderCanvas();
    }
  }
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
function finalizarRenameTirinha(commit) {
  if ($nameInput.hasAttribute('hidden')) return;
  const novo = $nameInput.value.trim();
  $nameInput.setAttribute('hidden', '');
  $name.removeAttribute('hidden');
  if (!commit || !novo || !tirinha || novo === tirinha.nome) return;
  // Otimista: nome novo na UI imediato; request em background.
  const original = tirinha.nome;
  tirinha.nome = novo;
  $name.textContent = novo;
  $name.classList.add('is-syncing');
  patchTirinha(tirinha.id, { nome: novo })
    .then((data) => {
      if (data?.tirinha?.nome) {
        tirinha.nome = data.tirinha.nome;
        $name.textContent = tirinha.nome;
      }
      $name.classList.remove('is-syncing');
    })
    .catch((err) => {
      tirinha.nome = original;
      $name.textContent = original;
      $name.classList.remove('is-syncing');
      $name.classList.add('is-sync-error');
      setTimeout(() => $name.classList.remove('is-sync-error'), 2500);
      showToast('falha ao renomear — tente de novo');
    });
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
    if (isPlaying) stopPlay({ restore: false });
    if (activeQuadroIdx > 0) { activeQuadroIdx--; renderMatrix(); renderCanvas(); }
  } else if (e.target.closest('[data-action="fe-next-quadro"]')) {
    if (isPlaying) stopPlay({ restore: false });
    if (activeQuadroIdx < quadrosOrdenados.length - 1) { activeQuadroIdx++; renderMatrix(); renderCanvas(); }
  }
});

// + Camada (otimista)
//
// Cria camada nova com id provisório `tmp-X` e células vazias provisórias
// cruzando com todos os quadros. Quando o request volta, troca os ids tmp
// pelos reais. Se falhar, remove tudo.
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fe-add-camada"]')) return;
  if (!tirinha) return;
  const nomeNovo = `camada ${camadasOrdenadas.length + 1}`;
  const novaOrdem = (camadasOrdenadas.length
    ? Math.max(...camadasOrdenadas.map((c) => c.ordem)) + 1
    : 0);
  const tmpCamId = nextTmpId();
  const novaCam = { id: tmpCamId, tirinha_id: tirinha.id, nome: nomeNovo, ordem: novaOrdem, visivel: true };
  // Células provisórias pra cada quadro existente.
  const novasCels = [];
  for (const q of quadrosOrdenados) {
    const c = { id: nextTmpId(), tirinha_id: tirinha.id, camada_id: tmpCamId, quadro_id: q.id, png_url: null, largura: null, altura: null, estado: 'idle' };
    novasCels.push(c);
  }
  optimistic({
    flightKey: `camada:${tmpCamId}`,
    label: 'adicionar camada',
    applyFn: () => {
      camadasOrdenadas.push(novaCam);
      camadasOrdenadas.sort((a, b) => b.ordem - a.ordem);
      if (tirinha.camadas) tirinha.camadas.push(novaCam);
      for (const c of novasCels) {
        celulasMap.set(keyOf(c.camada_id, c.quadro_id), c);
        if (tirinha.celulas) tirinha.celulas.push(c);
      }
    },
    networkFn: () => addCamada(tirinha.id, { nome: nomeNovo, ordem: novaOrdem }),
    finalizeFn: (camadaReal) => {
      if (!camadaReal?.id) return;
      remapId('camada', tmpCamId, camadaReal.id);
      // Atualiza a in-flight key (era tmp, agora real). Não precisa renomear:
      // o flightKey original do optimistic já foi limpo por sucesso.
      // Atualiza ordem se servidor devolveu valor diferente.
      const cam = camadasOrdenadas.find((c) => c.id === camadaReal.id);
      if (cam) {
        cam.ordem = camadaReal.ordem;
        cam.visivel = camadaReal.visivel;
        cam.nome = camadaReal.nome;
      }
      camadasOrdenadas.sort((a, b) => b.ordem - a.ordem);
      // OBSERVAÇÃO: as células provisórias dessa camada ficam com id tmp-
      // até o próximo getTirinha() (depois de polling ou reload). Isso é
      // aceitável — não há operação por-célula com id ainda exposta na UI
      // exceto a inclusão delas no payload do prompt (que usa cel.id) — e
      // ali já filtramos `cel.estado !== 'processando'` mas não filtramos
      // ids tmp. Garantia: ao disparar prompt, ignoramos cels tmp- pra não
      // mandar ids inválidos pro servidor (vê handler do prompt).
    },
    rollbackFn: () => {
      camadasOrdenadas = camadasOrdenadas.filter((c) => c.id !== tmpCamId);
      if (tirinha.camadas) tirinha.camadas = tirinha.camadas.filter((c) => c.id !== tmpCamId);
      for (const c of novasCels) celulasMap.delete(keyOf(c.camada_id, c.quadro_id));
      if (tirinha.celulas) tirinha.celulas = tirinha.celulas.filter((c) => c.camada_id !== tmpCamId);
    },
  });
});

// + Quadro (otimista)
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fe-add-quadro"]')) return;
  if (!tirinha) return;
  const novoIndice = (quadrosOrdenados.length
    ? Math.max(...quadrosOrdenados.map((q) => q.indice)) + 1
    : 0);
  const tmpQId = nextTmpId();
  const novoQ = { id: tmpQId, tirinha_id: tirinha.id, indice: novoIndice, duracao_ms: null };
  const novasCels = [];
  for (const cam of camadasOrdenadas) {
    const c = { id: nextTmpId(), tirinha_id: tirinha.id, camada_id: cam.id, quadro_id: tmpQId, png_url: null, largura: null, altura: null, estado: 'idle' };
    novasCels.push(c);
  }
  optimistic({
    flightKey: `quadro:${tmpQId}`,
    label: 'adicionar quadro',
    applyFn: () => {
      quadrosOrdenados.push(novoQ);
      quadrosOrdenados.sort((a, b) => a.indice - b.indice);
      if (tirinha.quadros) tirinha.quadros.push(novoQ);
      for (const c of novasCels) {
        celulasMap.set(keyOf(c.camada_id, c.quadro_id), c);
        if (tirinha.celulas) tirinha.celulas.push(c);
      }
      activeQuadroIdx = quadrosOrdenados.findIndex((q) => q.id === tmpQId);
    },
    networkFn: () => addQuadro(tirinha.id, {}),
    finalizeFn: (quadroReal) => {
      if (!quadroReal?.id) return;
      remapId('quadro', tmpQId, quadroReal.id);
      const q = quadrosOrdenados.find((qq) => qq.id === quadroReal.id);
      if (q) { q.indice = quadroReal.indice; q.duracao_ms = quadroReal.duracao_ms; }
      quadrosOrdenados.sort((a, b) => a.indice - b.indice);
      activeQuadroIdx = quadrosOrdenados.findIndex((qq) => qq.id === quadroReal.id);
    },
    rollbackFn: () => {
      quadrosOrdenados = quadrosOrdenados.filter((q) => q.id !== tmpQId);
      if (tirinha.quadros) tirinha.quadros = tirinha.quadros.filter((q) => q.id !== tmpQId);
      for (const c of novasCels) celulasMap.delete(keyOf(c.camada_id, c.quadro_id));
      if (tirinha.celulas) tirinha.celulas = tirinha.celulas.filter((c) => c.quadro_id !== tmpQId);
      if (activeQuadroIdx >= quadrosOrdenados.length) activeQuadroIdx = quadrosOrdenados.length - 1;
      if (activeQuadroIdx < 0) activeQuadroIdx = 0;
    },
  });
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
    alvosIds = (tirinha.celulas || []).map((c) => c.id).filter((id) => !isTmpId(id));
  } else {
    alvosIds = [];
    for (const k of selecionadas) {
      const cel = celulasMap.get(k);
      if (cel && cel.estado !== 'processando' && !isTmpId(cel.id)) alvosIds.push(cel.id);
    }
  }
  if (!alvosIds.length) {
    $err.textContent = 'nenhuma célula alvo válida (aguarde camadas/quadros novas serem confirmadas)';
    return;
  }

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
    showToast('falha no download — tente de novo');
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
    showToast('falha ao listar projetos');
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
