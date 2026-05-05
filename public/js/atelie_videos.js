// Ateliê → Vídeos. Lista vídeos do user, ação criar vídeo, abre editor.

import { listVideos, createVideo, deleteVideo, duplicateVideo, previewUrl, createVideoFromUrl } from './videos_api.js';
import { openModal, closeModal, showToast, confirmModal } from './modals.js';
import { navigateEditor, navigateProject, navigateGenerate, navigateTextVideo } from './router.js';

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
      if (e.target.closest('.video-card-hover-actions')) return;
      if (e.target.closest('[data-action="goto-published-project"]')) return;
      navigateEditor(v.id);
    });

    const origin = v.origin || 'uploaded';
    const originMap = {
      'uploaded': { label: 'upload', cls: 'tag-origin-upload', icon: '▲' },
      'url': { label: 'url', cls: 'tag-origin-url', icon: '↗' },
      'generated-generic': { label: 'gerado', cls: 'tag-origin-generic', icon: '✦' },
      'generated-t2v': { label: 'texto→vídeo', cls: 'tag-origin-generic', icon: '✦' },
      'generated-from-character': { label: 'personagem', cls: 'tag-origin-character', icon: '☻' },
    };
    const o = originMap[origin] || { label: origin, cls: '', icon: '·' };
    const isPublished = !!v.published_asset_id;
    const dur = v.duration_s ? `${v.duration_s.toFixed(1)}s` : '';
    const projName = v.published_project_name || '';
    const publishedTag = isPublished
      ? (projName
          ? `<button class="tag tag-published video-card-published-link" data-action="goto-published-project" data-project-id="${v.published_project_id}" type="button" title="abrir projeto na Galeria">◆ publicado em <em>${escapeHtml(projName)}</em></button>`
          : `<span class="tag tag-published">◆ publicado</span>`)
      : `<span class="tag tag-draft">◇ rascunho</span>`;

    const thumbUrl = v.thumb_url;
    card.innerHTML = `
      <div class="video-card-thumb${thumbUrl ? ' has-thumb' : ''}"${thumbUrl ? ` style="background-image:url('${thumbUrl}')"` : ''}>
        <span class="play-mark">▶</span>
        ${dur ? `<span class="video-card-duration">${dur}</span>` : ''}
      </div>
      <div class="video-card-body">
        <div class="video-card-name">${escapeHtml(v.name)}</div>
        <div class="video-card-tags">
          <span class="tag ${o.cls}"><span class="tag-icon">${o.icon}</span>${o.label}</span>
          ${publishedTag}
        </div>
      </div>
      <div class="video-card-hover-actions">
        <button class="video-card-hover-btn" data-action="duplicate-video" title="duplicar (cria cópia independente, sem vínculo a projeto)" type="button">⎘</button>
        <button class="video-card-hover-btn video-card-hover-btn-danger" data-action="delete-video" title="apagar" type="button">×</button>
      </div>
    `;
    const $publishedLink = card.querySelector('[data-action="goto-published-project"]');
    if ($publishedLink) {
      $publishedLink.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateProject($publishedLink.getAttribute('data-project-id'));
      });
    }
    card.querySelector('[data-action="duplicate-video"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const dup = await duplicateVideo(v.id);
        showToast('vídeo duplicado');
        await refresh();
        navigateEditor(dup.id);
      } catch (err) {
        showToast('falha ao duplicar: ' + err.message);
      }
    });
    card.querySelector('[data-action="delete-video"]').addEventListener('click', async (e) => {
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

// fluxo escolhido
document.addEventListener('click', (e) => {
  const card = e.target.closest('[data-action="pick-flow"]');
  if (!card) return;
  const flow = card.getAttribute('data-flow');
  if (flow === 'A' || flow === 'B') {
    pendingFlow = flow;
    closeModal();
    setTimeout(() => openStartVideoModal(flow), 50);
  } else if (flow === 'C') {
    closeModal();
    navigateGenerate();
  } else if (flow === 'D') {
    closeModal();
    navigateTextVideo();
  }
});

function openStartVideoModal(flow) {
  const m = document.querySelector('[data-modal="name-video"]');
  m.querySelector('[data-bind="name-video-input"]').value = '';
  m.querySelector('[data-bind="name-video-err"]').textContent = '';
  m.querySelector('[data-bind="url-preview"]').setAttribute('hidden', '');
  m.querySelector('[data-bind="url-preview-status"]').setAttribute('hidden', '');
  // título adapta-se ao fluxo, mas o input aceita texto OU URL nos dois.
  if (flow === 'B') {
    m.querySelector('[data-bind="name-video-title"]').textContent = 'Vídeo de URL';
    m.querySelector('[data-bind="name-video-sub"]').textContent = 'Cole a URL do YouTube. O vídeo fica como referência — você corta trechos no editor.';
    m.querySelector('[data-bind="name-video-label"]').textContent = 'URL do YouTube';
    m.querySelector('[data-bind="name-video-input"]').placeholder = 'https://www.youtube.com/watch?v=...';
  } else {
    m.querySelector('[data-bind="name-video-title"]').textContent = 'Nome do vídeo';
    m.querySelector('[data-bind="name-video-sub"]').textContent = 'Você pode renomear depois — ou cole uma URL do YouTube pra começar a partir de um vídeo existente.';
    m.querySelector('[data-bind="name-video-label"]').textContent = 'nome ou URL';
    m.querySelector('[data-bind="name-video-input"]').placeholder = 'ex: skate na praça — ou cole uma URL do YouTube';
  }
  openModal('name-video');
}

// Detecção de URL no input do "criar vídeo" — debounced 500ms.
const URL_RE = /^https?:\/\/\S+$/i;
let urlDebounce = null;
let urlPreviewedFor = null;
function wireUrlDetection() {
  const m = document.querySelector('[data-modal="name-video"]');
  const $input = m.querySelector('[data-bind="name-video-input"]');
  const $preview = m.querySelector('[data-bind="url-preview"]');
  const $status = m.querySelector('[data-bind="url-preview-status"]');
  const $err = m.querySelector('[data-bind="name-video-err"]');
  const $thumb = m.querySelector('[data-bind="url-preview-thumb"]');
  const $title = m.querySelector('[data-bind="url-preview-title"]');
  const $foot = m.querySelector('[data-bind="url-preview-foot"]');
  const $confirm = m.querySelector('[data-bind="name-video-confirm"]');

  $input.addEventListener('input', () => {
    const v = $input.value.trim();
    $err.textContent = '';
    clearTimeout(urlDebounce);
    if (!URL_RE.test(v)) {
      $preview.setAttribute('hidden', '');
      $status.setAttribute('hidden', '');
      $confirm.textContent = 'criar e abrir editor';
      urlPreviewedFor = null;
      return;
    }
    if (v === urlPreviewedFor) return; // já temos preview
    $preview.setAttribute('hidden', '');
    $status.removeAttribute('hidden');
    $status.textContent = 'buscando informações…';
    urlDebounce = setTimeout(async () => {
      try {
        const info = await previewUrl(v);
        urlPreviewedFor = v;
        $thumb.src = info.thumbnail || '';
        $title.textContent = info.title || '—';
        const dur = info.duration_s ? `${Math.floor(info.duration_s/60)}:${String(Math.round(info.duration_s%60)).padStart(2,'0')}` : '?';
        $foot.textContent = `YouTube · ${dur}`;
        $preview.removeAttribute('hidden');
        $status.setAttribute('hidden', '');
        $confirm.textContent = 'começar a partir deste vídeo';
      } catch (err) {
        $status.setAttribute('hidden', '');
        $err.textContent = err.message;
      }
    }, 500);
  });
}
// roda 1x quando o módulo carrega
wireUrlDetection();

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="confirm-name-video"]')) return;
  const m = document.querySelector('[data-modal="name-video"]');
  const $input = m.querySelector('[data-bind="name-video-input"]');
  const $err = m.querySelector('[data-bind="name-video-err"]');
  const $confirm = m.querySelector('[data-bind="name-video-confirm"]');
  const value = $input.value.trim();
  if (!value) {
    $err.textContent = 'preencha o campo';
    return;
  }
  $confirm.disabled = true;
  $err.textContent = '';
  try {
    let v;
    if (URL_RE.test(value)) {
      v = await createVideoFromUrl(value);
      showToast('vídeo de URL criado');
    } else {
      v = await createVideo(value);
      showToast('vídeo criado');
    }
    closeModal();
    navigateEditor(v.id);
  } catch (err) {
    $err.textContent = err.message;
  } finally {
    $confirm.disabled = false;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
