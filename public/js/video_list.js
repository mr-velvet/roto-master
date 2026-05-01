// Lista de vídeos + modal de criar novo.
// Renderiza no #video-list. Notifica via callback quando user abre/cria vídeo.

import { listVideos, createVideo, deleteVideo } from './videos_api.js';

let onOpenVideo = () => {};

export function bindVideoList(deps) {
  onOpenVideo = deps.onOpenVideo;
}

const $listScreen = document.getElementById('video-list');
const $listGrid = document.getElementById('video-list-grid');
const $listEmpty = document.getElementById('video-list-empty');
const $btnNew = document.getElementById('btn-new-video');

const $modal = document.getElementById('name-modal');
const $modalInput = document.getElementById('name-modal-input');
const $modalConfirm = document.getElementById('name-modal-confirm');
const $modalCancel = document.getElementById('name-modal-cancel');
const $modalErr = document.getElementById('name-modal-err');

function fmtDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function videoCard(v) {
  const card = document.createElement('div');
  card.className = 'video-card';
  card.dataset.id = v.id;
  const hasFile = !!v.gcs_url;
  card.innerHTML = `
    <div class="video-card-thumb ${hasFile ? '' : 'empty'}">
      ${hasFile
        ? `<span class="meta">${v.width || '?'}×${v.height || '?'}</span>`
        : `<span class="placeholder">sem vídeo</span>`}
    </div>
    <div class="video-card-body">
      <div class="video-card-name" title="${v.name}">${v.name}</div>
      <div class="video-card-meta">${fmtDate(v.updated_at)}</div>
    </div>
    <button class="video-card-delete" title="apagar">×</button>
  `;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.video-card-delete')) return;
    onOpenVideo(v.id);
  });
  card.querySelector('.video-card-delete').addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await confirmDelete(v.name);
    if (!ok) return;
    try {
      await deleteVideo(v.id);
      card.remove();
      if (!$listGrid.children.length) {
        $listEmpty.style.display = 'block';
        $listEmpty.innerHTML = 'nenhum vídeo ainda.<br>clique em <em>novo vídeo</em> pra começar.';
      }
    } catch (err) {
      console.error(err);
    }
  });
  return card;
}

// Confirm modal custom (regra UI: nada de confirm() nativo).
function confirmDelete(name) {
  return new Promise((resolve) => {
    const $cmodal = document.getElementById('confirm-modal');
    const $cmsg = document.getElementById('confirm-modal-msg');
    const $cyes = document.getElementById('confirm-modal-yes');
    const $cno = document.getElementById('confirm-modal-no');
    $cmsg.textContent = `Apagar "${name}"? Essa ação não pode ser desfeita.`;
    $cmodal.style.display = 'flex';
    const close = (v) => {
      $cmodal.style.display = 'none';
      $cyes.removeEventListener('click', onYes);
      $cno.removeEventListener('click', onNo);
      $cmodal.removeEventListener('click', onBg);
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onYes = () => close(true);
    const onNo = () => close(false);
    const onBg = (e) => { if (e.target === $cmodal) close(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    $cyes.addEventListener('click', onYes);
    $cno.addEventListener('click', onNo);
    $cmodal.addEventListener('click', onBg);
    document.addEventListener('keydown', onKey);
  });
}

export async function showVideoList() {
  $listScreen.style.display = 'flex';
  $listGrid.innerHTML = '';
  $listEmpty.style.display = 'none';
  $listEmpty.textContent = 'carregando…';
  try {
    const videos = await listVideos();
    if (!videos.length) {
      $listEmpty.style.display = 'block';
      $listEmpty.innerHTML = 'nenhum vídeo ainda.<br>clique em <em>novo vídeo</em> pra começar.';
      return;
    }
    videos.forEach(v => $listGrid.appendChild(videoCard(v)));
  } catch (e) {
    $listEmpty.style.display = 'block';
    $listEmpty.innerHTML = `<span class="err">erro ao carregar: ${e.message}</span>`;
  }
}

export function hideVideoList() {
  $listScreen.style.display = 'none';
}

// ---- Modal de criar ----
function openModal() {
  $modalInput.value = '';
  $modalErr.textContent = '';
  $modal.style.display = 'flex';
  setTimeout(() => $modalInput.focus(), 0);
}
function closeModal() {
  $modal.style.display = 'none';
}

async function submitNewVideo() {
  const name = $modalInput.value.trim();
  if (!name) {
    $modalErr.textContent = 'dê um nome ao vídeo';
    return;
  }
  $modalConfirm.disabled = true;
  $modalErr.textContent = '';
  try {
    const v = await createVideo(name);
    closeModal();
    onOpenVideo(v.id);
  } catch (e) {
    $modalErr.textContent = e.message;
  } finally {
    $modalConfirm.disabled = false;
  }
}

export function initVideoListUI() {
  $btnNew.addEventListener('click', openModal);
  $modalConfirm.addEventListener('click', submitNewVideo);
  $modalCancel.addEventListener('click', closeModal);
  $modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitNewVideo();
    if (e.key === 'Escape') closeModal();
  });
  $modal.addEventListener('click', (e) => {
    if (e.target === $modal) closeModal();
  });
}
