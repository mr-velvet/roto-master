// Ateliê → Vídeos. Lista vídeos do user, ação criar vídeo, abre editor.

import { listVideos, createVideo, deleteVideo } from './videos_api.js';
import { openModal, closeModal, showToast, confirmModal } from './modals.js';
import { navigateEditor } from './router.js';

const $grid = document.querySelector('[data-bind="video-grid"]');
const $empty = document.querySelector('[data-bind="videos-empty"]');
const $countVideos = document.querySelector('[data-bind="count-videos"]');

let videos = [];
let pendingFlow = null;

export async function showAtelieVideos() {
  await refresh();
}

async function refresh() {
  try {
    videos = await listVideos();
  } catch (e) {
    console.error('list videos:', e);
    showToast('falha ao listar vídeos');
    return;
  }
  $countVideos.textContent = String(videos.length);
  render();
}

function render() {
  $grid.innerHTML = '';
  if (!videos.length) {
    $empty.removeAttribute('hidden');
    return;
  }
  $empty.setAttribute('hidden', '');

  for (const v of videos) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.addEventListener('click', (e) => {
      if (e.target.closest('.video-card-delete')) return;
      navigateEditor(v.id);
    });

    const origin = v.origin || 'uploaded';
    const originMap = {
      'uploaded': { label: 'upload', cls: 'tag-origin-upload', icon: '▲' },
      'url': { label: 'url', cls: 'tag-origin-url', icon: '↗' },
      'generated-generic': { label: 'gerado', cls: 'tag-origin-generic', icon: '✦' },
      'generated-from-character': { label: 'personagem', cls: 'tag-origin-character', icon: '☻' },
    };
    const o = originMap[origin] || { label: origin, cls: '', icon: '·' };
    const isPublished = !!v.published_asset_id;
    const dur = v.duration_s ? `${v.duration_s.toFixed(1)}s` : '';

    card.innerHTML = `
      <div class="video-card-thumb">
        <span class="play-mark">▶</span>
        ${dur ? `<span class="video-card-duration">${dur}</span>` : ''}
      </div>
      <div class="video-card-body">
        <div class="video-card-name">${escapeHtml(v.name)}</div>
        <div class="video-card-tags">
          <span class="tag ${o.cls}"><span class="tag-icon">${o.icon}</span>${o.label}</span>
          <span class="tag ${isPublished ? 'tag-published' : 'tag-draft'}">
            ${isPublished ? '◆ publicado' : '◇ rascunho'}
          </span>
        </div>
      </div>
      <button class="video-card-delete" title="apagar" style="position:absolute; top:8px; right:8px; width:24px; height:24px; background:rgba(5,5,6,0.7); color:var(--paper-3); border:0; opacity:0; transition:opacity 160ms;">×</button>
    `;
    card.querySelector('.video-card-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmModal({
        title: 'apagar vídeo',
        message: `Apagar "${v.name}"? Essa ação não pode ser desfeita.`,
      });
      if (!ok) return;
      try {
        await deleteVideo(v.id);
        showToast('vídeo apagado');
        await refresh();
      } catch (err) {
        showToast('falha ao apagar: ' + err.message);
      }
    });
    $grid.appendChild(card);
  }
}

// botão "criar vídeo" abre seletor de fluxo
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="new-video"]')) return;
  openModal('new-video');
});

// fluxo A escolhido → modal de nome
document.addEventListener('click', (e) => {
  const card = e.target.closest('[data-action="pick-flow"]');
  if (!card) return;
  const flow = card.getAttribute('data-flow');
  if (flow !== 'A') return; // outros fluxos: em breve
  pendingFlow = flow;
  closeModal();
  setTimeout(() => {
    const m = document.querySelector('[data-modal="name-video"]');
    m.querySelector('[data-bind="name-video-input"]').value = '';
    m.querySelector('[data-bind="name-video-err"]').textContent = '';
    openModal('name-video');
  }, 50);
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="confirm-name-video"]')) return;
  const m = document.querySelector('[data-modal="name-video"]');
  const $input = m.querySelector('[data-bind="name-video-input"]');
  const $err = m.querySelector('[data-bind="name-video-err"]');
  const name = $input.value.trim();
  if (!name) {
    $err.textContent = 'nome é obrigatório';
    return;
  }
  try {
    const v = await createVideo(name);
    closeModal();
    showToast('vídeo criado');
    navigateEditor(v.id);
  } catch (err) {
    $err.textContent = err.message;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
