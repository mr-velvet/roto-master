// Bandeja de notificações global no header.
// Sino com badge de contador. Click abre dropdown.
// Polling 3s quando: bandeja aberta OU há job running OU há job queued.
// Para de pollar quando todos os jobs ativos terminam E a bandeja está fechada.

import { listJobs, dismissJob, dismissJobs } from './jobs_api.js';
import { deleteVideo, getVideo } from './videos_api.js';
import { openModal, closeModal, showToast } from './modals.js';
import { navigateEditor } from './router.js';

const POLL_MS = 3000;

let $bell, $badge, $panel, $list, $empty, $clearBtn, $tray;
let jobs = [];               // último snapshot
let knownJobsById = new Map();
let pollTimer = null;
let panelOpen = false;
let lastUpdatedAt = null;
let videoCache = new Map();  // video_id → { gcs_url, name, generation_meta }
let registered = false;

export function initNotifTray() {
  if (registered) return;
  registered = true;

  $tray = document.querySelector('[data-bind="notif-tray"]');
  $bell = document.querySelector('[data-action="toggle-notif-tray"]');
  $badge = document.querySelector('[data-bind="notif-badge"]');
  $panel = document.querySelector('[data-bind="notif-panel"]');
  $list = document.querySelector('[data-bind="notif-list"]');
  $empty = document.querySelector('[data-bind="notif-empty"]');
  $clearBtn = document.querySelector('[data-action="dismiss-all-notifs"]');

  if (!$bell) return;

  $bell.addEventListener('click', togglePanel);
  $clearBtn.addEventListener('click', dismissAllCompleted);
  const $closeBtn = document.querySelector('[data-action="close-notif-tray"]');
  if ($closeBtn) $closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePanel();
  });

  // click fora fecha
  document.addEventListener('click', (e) => {
    if (!panelOpen) return;
    if (e.target.closest('[data-bind="notif-tray"]')) return;
    closePanel();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelOpen) closePanel();
  });

  // primeira leitura + começa a pollar
  refresh().catch((e) => console.warn('notif initial:', e));
  schedulePoll();
}

function togglePanel() {
  if (panelOpen) closePanel();
  else openPanel();
}

function openPanel() {
  panelOpen = true;
  $panel.removeAttribute('hidden');
  $bell.setAttribute('aria-expanded', 'true');
  $tray.classList.add('is-open');
  schedulePoll();
}

function closePanel() {
  panelOpen = false;
  $panel.setAttribute('hidden', '');
  $bell.setAttribute('aria-expanded', 'false');
  $tray.classList.remove('is-open');
  schedulePoll();
}

function schedulePoll() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  // só agenda se há motivo (jobs ativos ou bandeja aberta)
  const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  if (!panelOpen && !hasActive) return;
  pollTimer = setTimeout(() => {
    refresh().catch((e) => console.warn('notif poll:', e));
    schedulePoll();
  }, POLL_MS);
}

async function refresh() {
  const fresh = await listJobs();
  // detecta transições queued/running → completed pra disparar toast.
  for (const j of fresh) {
    const prev = knownJobsById.get(j.id);
    if (prev && prev.status !== 'completed' && j.status === 'completed') {
      showToast(`vídeo pronto · ${shortPrompt(j)}`);
    }
    if (prev && prev.status !== 'failed' && j.status === 'failed') {
      showToast(`falhou · ${shortPrompt(j)}`);
    }
    knownJobsById.set(j.id, j);
  }
  // remove ids dispensados/sumidos do cache
  const ids = new Set(fresh.map((j) => j.id));
  for (const id of [...knownJobsById.keys()]) {
    if (!ids.has(id)) knownJobsById.delete(id);
  }
  jobs = fresh;
  lastUpdatedAt = new Date().toISOString();
  render();
}

function render() {
  const activeCount = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const totalVisible = jobs.length;

  // badge: número de ativos (preferido) ou bolinha pulsante se zero+não-vazio
  if (activeCount > 0) {
    $badge.textContent = String(activeCount);
    $badge.removeAttribute('hidden');
    $badge.classList.remove('is-quiet');
    $bell.classList.add('is-active');
  } else if (totalVisible > 0) {
    $badge.textContent = String(totalVisible);
    $badge.removeAttribute('hidden');
    $badge.classList.add('is-quiet');
    $bell.classList.remove('is-active');
  } else {
    $badge.setAttribute('hidden', '');
    $bell.classList.remove('is-active');
  }

  if (!totalVisible) {
    $list.innerHTML = '';
    $empty.removeAttribute('hidden');
    $clearBtn.setAttribute('hidden', '');
    return;
  }
  $empty.setAttribute('hidden', '');

  const hasFinished = jobs.some((j) => j.status === 'completed' || j.status === 'failed');
  $clearBtn.toggleAttribute('hidden', !hasFinished);

  $list.innerHTML = '';
  jobs.forEach((j) => $list.appendChild(renderItem(j)));
}

function shortPrompt(j) {
  const p = j.params || {};
  const text = p.motion_prompt || p.prompt || p.image_prompt || '';
  return text.slice(0, 50).trim() || 'sem prompt';
}

function modelLabel(j) {
  const k = j.kind === 'generate-video' ? 'i2v' : 't2v';
  const mk = (j.params || {}).model_key || '';
  if (mk.startsWith('pixverse')) return `PixVerse ${k}`;
  if (mk.startsWith('kling')) return `Kling ${k}`;
  return k.toUpperCase();
}

function statusChip(j) {
  if (j.status === 'queued') return { label: 'na fila', cls: 'is-queued' };
  if (j.status === 'running') return { label: 'rodando', cls: 'is-running' };
  if (j.status === 'completed') return { label: 'pronto', cls: 'is-done' };
  if (j.status === 'failed') return { label: 'falhou', cls: 'is-failed' };
  return { label: j.status, cls: '' };
}

function elapsedText(j) {
  const ts = j.started_at || j.created_at;
  if (!ts) return '';
  const ms = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m${sec % 60}s`;
}

function renderItem(j) {
  const item = document.createElement('div');
  const chip = statusChip(j);
  item.className = `notif-item notif-item-${j.status}`;
  item.dataset.jobId = j.id;

  const promptText = shortPrompt(j);
  const isFinished = j.status === 'completed' || j.status === 'failed';
  const showElapsed = j.status === 'queued' || j.status === 'running';

  item.innerHTML = `
    <div class="notif-item-row">
      <span class="notif-item-chip ${chip.cls}">${chip.label}</span>
      <span class="notif-item-model">${escapeHtml(modelLabel(j))}</span>
      ${showElapsed ? `<span class="notif-item-elapsed">${elapsedText(j)}</span>` : ''}
      <button class="notif-item-x" data-action="dismiss-job" aria-label="dispensar">×</button>
    </div>
    <div class="notif-item-prompt">${escapeHtml(promptText)}</div>
    ${j.status === 'failed' && j.error_message
      ? `<div class="notif-item-err">${escapeHtml(j.error_message.slice(0, 120))}</div>`
      : ''}
    ${isFinished && j.video_id
      ? `<div class="notif-item-actions">
           <button class="notif-item-action notif-item-preview" data-action="preview-job">prever</button>
           <button class="notif-item-action notif-item-open" data-action="open-job-editor">abrir editor</button>
         </div>`
      : ''}
  `;

  item.querySelector('[data-action="dismiss-job"]').addEventListener('click', (e) => {
    e.stopPropagation();
    handleDismiss(j.id);
  });
  const previewBtn = item.querySelector('[data-action="preview-job"]');
  if (previewBtn) previewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlePreview(j);
  });
  const openBtn = item.querySelector('[data-action="open-job-editor"]');
  if (openBtn) openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (j.video_id) navigateEditor(j.video_id);
    closePanel();
  });

  // click no body do item abre preview se tem video
  if (isFinished && j.video_id) {
    item.addEventListener('click', () => handlePreview(j));
  }

  return item;
}

async function handleDismiss(id) {
  // otimista
  jobs = jobs.filter((j) => j.id !== id);
  knownJobsById.delete(id);
  render();
  try {
    await dismissJob(id);
  } catch (e) {
    showToast('falha ao dispensar — tente de novo');
    refresh();
  }
}

async function dismissAllCompleted() {
  const ids = jobs.filter((j) => j.status === 'completed' || j.status === 'failed').map((j) => j.id);
  if (!ids.length) return;
  jobs = jobs.filter((j) => j.status !== 'completed' && j.status !== 'failed');
  ids.forEach((id) => knownJobsById.delete(id));
  render();
  try {
    await dismissJobs(ids);
  } catch (e) {
    showToast('falha ao limpar — tente de novo');
    refresh();
  }
}

let currentPreviewJob = null;
let currentPreviewVideo = null;

async function handlePreview(j) {
  if (!j.video_id) return;
  closePanel();
  // monta o modal
  let video = videoCache.get(j.video_id);
  if (!video) {
    try {
      video = await getVideo(j.video_id);
      if (video) videoCache.set(j.video_id, video);
    } catch (e) {
      showToast('falha ao carregar vídeo');
      return;
    }
  }
  if (!video) {
    showToast('vídeo não encontrado');
    return;
  }
  currentPreviewJob = j;
  currentPreviewVideo = video;

  const $eyebrow = document.querySelector('[data-bind="job-preview-eyebrow"]');
  const $title = document.querySelector('[data-bind="job-preview-title"]');
  const $vid = document.querySelector('[data-bind="job-preview-video"]');
  const $prompt = document.querySelector('[data-bind="job-preview-prompt"]');
  const $duration = document.querySelector('[data-bind="job-preview-duration"]');
  const $cost = document.querySelector('[data-bind="job-preview-cost"]');

  const meta = video.generation_meta || {};
  const attempts = meta.attempts || [];
  const att = attempts[meta.active_attempt_idx || 0] || attempts[attempts.length - 1] || {};

  $eyebrow.textContent = j.kind === 'generate-text-video' ? 'Texto → Vídeo' : 'Imagem → Vídeo';
  $title.textContent = video.name || 'sem nome';
  $vid.src = video.gcs_url || att.url || '';
  $vid.load?.();
  $prompt.textContent = shortPrompt(j) || '—';
  $duration.textContent = att.duration_s ? `${att.duration_s}s` : (video.duration_s ? `${video.duration_s}s` : '—');
  const c = j.cost_actual ?? att.cost;
  $cost.textContent = c ? `$${parseFloat(c).toFixed(2)}` : '—';

  openModal('job-video-preview', {
    onClose: () => {
      $vid.pause?.();
      $vid.src = '';
      currentPreviewJob = null;
      currentPreviewVideo = null;
    },
  });
}

// === handlers de botões dentro do modal de preview ===
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="job-preview-open-editor"]')) {
    if (currentPreviewVideo) {
      const id = currentPreviewVideo.id;
      closeModal();
      navigateEditor(id);
    }
  }
  if (e.target.closest('[data-action="job-preview-trash"]')) {
    if (currentPreviewVideo) {
      const id = currentPreviewVideo.id;
      const jobId = currentPreviewJob?.id;
      // direto pra lixeira sem outro confirm — modal aberto já mostra contexto
      (async () => {
        try {
          await deleteVideo(id);
          if (jobId) await dismissJob(jobId).catch(() => {});
          showToast('mandado pra lixeira');
          videoCache.delete(id);
          closeModal();
          refresh();
          // notifica gallery/atelie pra refrescar
          window.dispatchEvent(new CustomEvent('video-deleted', { detail: { id } }));
        } catch (err) {
          showToast('falha — tente de novo');
        }
      })();
    }
  }
});

// Chamado por outros módulos quando enfileiram um job — força refresh imediato
// pra a bandeja já mostrar o item antes do próximo poll.
export function notifyJobEnqueued() {
  refresh().catch(() => {});
  schedulePoll();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
