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

// Interação do canvas (pan/zoom). Espaço é exclusivo de pan.
// Toggle do play migrou pra tecla K (Espaço deixou de ser atalho).
let panX = 0, panY = 0;
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
const $btnAll = document.querySelector('[data-action="fe-prompt-all"]');
const $btnConfirmPrompt = document.querySelector('[data-action="fe-confirm-prompt"]');
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

// Estado do disparo em curso. Usado pra evitar clique duplo enquanto a request
// pra /api/fe/prompts ainda não voltou (200-800ms no túnel IAP).
let dispararEmCurso = false;

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
  resetView();
  attachCanvasInteraction();
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
  await aplicarEstadoTirinha(data, { recenter: true });
}

async function aplicarEstadoTirinha(data, opts = {}) {
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
  // Recentralizar só na primeira carga (entrada na tirinha). Polling/refresh
  // preservam pan/zoom escolhidos pelo user.
  if (opts.recenter) centerCanvas();
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
  $btnSel.disabled = n === 0 || dispararEmCurso;
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

// Liga/desliga os botoes que disparam prompt enquanto a request esta em curso.
// Cobre o "prompt pra todos", "prompt pros selecionados" e o "aplicar prompt"
// do modal de confirmacao — evita clique duplo em qualquer um dos tres.
function setBotoesDispararEnabled(enabled) {
  dispararEmCurso = !enabled;
  if ($btnAll) $btnAll.disabled = !enabled;
  if ($btnConfirmPrompt) $btnConfirmPrompt.disabled = !enabled;
  // $btnSel respeita a seleção também: re-aplica o estado correto via
  // atualizarSelecaoUI, que já leva dispararEmCurso em conta.
  atualizarSelecaoUI();
}

// Marca célula localmente como processando, antes do 202 chegar. Devolve a
// lista de ids que efetivamente mudaram de estado (ja eram idle), pra que o
// caller saiba exatamente o que reverter em caso de falha.
function marcarLocalProcessando(idsAlvo) {
  const idsSet = new Set(idsAlvo);
  const idsMarcados = [];
  for (const cel of celulasMap.values()) {
    if (!idsSet.has(cel.id)) continue;
    if (cel.estado === 'processando') continue;
    cel.estado = 'processando';
    cel.estado_erro = null;
    cel.estado_atualizado_em = new Date().toISOString();
    idsMarcados.push(cel.id);
  }
  return idsMarcados;
}

// Reverte célula que tinha sido marcada otimisticamente como processando.
// Usado quando o disparo falha (rede, 500 etc.) — devolve o estado pra idle
// pra que o user possa tentar de novo sem precisar recarregar a pagina.
function reverterLocalProcessando(idsRevertir) {
  const idsSet = new Set(idsRevertir);
  for (const cel of celulasMap.values()) {
    if (!idsSet.has(cel.id)) continue;
    if (cel.estado !== 'processando') continue;
    cel.estado = 'idle';
    cel.estado_erro = null;
    cel.estado_atualizado_em = new Date().toISOString();
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
  stopCanvasInteraction();
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
  // Toggle play em K (Espaço fica reservado pra pan do canvas — ver
  // attachCanvasInteraction). Botão visível continua sendo o caminho principal.
  if (e.key === 'k' || e.key === 'K') {
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
  if (dispararEmCurso) return; // disparo anterior ainda em voo
  abrirModalPrompt({ tipo: 'all' });
});

// Prompt: pros selecionados
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fe-prompt-selected"]')) return;
  if (!tirinha || !selecionadas.size) return;
  if (dispararEmCurso) return;
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
  if (dispararEmCurso) return; // belt-and-suspenders: botão já fica disabled.
  const m = document.querySelector('[data-modal="fe-prompt"]');
  const $err = m.querySelector('[data-bind="fe-prompt-err"]');
  const $text = m.querySelector('[data-bind="fe-prompt-text"]');
  const prompt = $text.value.trim();
  $err.textContent = '';
  if (!prompt) { $err.textContent = 'escreva um prompt'; return; }

  // Critério de alvos espelha o backend: pega ids das células elegíveis
  // (em estado != processando). "all" usa todas as celulas da tirinha; o
  // backend filtra silenciosamente as que ja estao processando — como
  // fazemos o mesmo filtro aqui, a contagem mostrada pro user bate com a
  // que vai voltar em `celulas_marcadas`.
  let alvosIds;
  if (promptModoAtual === 'all') {
    alvosIds = [];
    for (const cel of celulasMap.values()) {
      if (cel.estado !== 'processando' && !isTmpId(cel.id)) alvosIds.push(cel.id);
    }
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

  // === Feedback otimista, ANTES de await ===
  // 1. Marca localmente, 2. re-render pinta processando, 3. fecha modal,
  // 4. toast imediato. Tudo no mesmo tick — user vê reação no clique.
  const idsMarcadosLocal = marcarLocalProcessando(alvosIds);
  setBotoesDispararEnabled(false);
  renderMatrix();
  closeModal();
  showToast(`prompt enviado em ${idsMarcadosLocal.length} célula${idsMarcadosLocal.length === 1 ? '' : 's'}…`);

  try {
    await dispararPrompt({ tirinhaId: tirinha.id, prompt, celulasIds: alvosIds });
    // Sucesso: backend marcou de verdade. Diferenca entre `idsMarcadosLocal`
    // e `celulas_marcadas` (resposta) e' tolerada — polling de 3s reconcilia
    // o estado real (ex: race em que outra sessao marcou alguma alem da nossa).
    agendarPollingSeNecessario();
  } catch (err) {
    // Falha: reverte localmente e avisa o user. Copy neutro (sem mensagem
    // tecnica do err.message — regra global).
    console.warn('disparar prompt falhou:', err);
    reverterLocalProcessando(idsMarcadosLocal);
    renderMatrix();
    showToast('falha ao enviar prompt — tente de novo');
  } finally {
    setBotoesDispararEnabled(true);
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
