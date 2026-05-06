// Galeria · Detalhe do projeto — lista de assets do projeto.

import { getProject } from './projects_api.js';
import { listAssets, deleteAsset } from './assets_api.js';
import { showToast, confirmModal } from './modals.js';
import { openAssetDetail } from './asset_modal.js';
import { navigateAtelie, navigateHome, navigateEditor } from './router.js';
import { showContextMenu } from './context_menu.js';

const $title = document.querySelector('[data-bind="project-name"]');
const $sub = document.querySelector('[data-bind="project-sub"]');
const $grid = document.querySelector('[data-bind="asset-grid"]');
const $emptyCall = document.querySelector('[data-bind="empty-call"]');
const $filterChips = document.querySelectorAll('[data-bind="asset-filter"] .chip');

let currentProjectId = null;
let currentProjectName = '';
let currentAssets = [];
let currentFilter = 'all';

const ORIGIN_LABELS = {
  uploaded: { label: 'upload', icon: '▲' },
  url: { label: 'url', icon: '↗' },
  'generated-generic': { label: 'gerado', icon: '✦' },
  'generated-from-character': { label: 'personagem', icon: '☻' },
};

export async function showProject(projectId) {
  currentProjectId = projectId;
  currentFilter = 'all';
  $filterChips.forEach((c) => c.classList.toggle('is-active', c.getAttribute('data-filter') === 'all'));

  $title.textContent = '…';
  $sub.textContent = '';
  $grid.innerHTML = '';
  $emptyCall.setAttribute('hidden', '');

  let project;
  try {
    project = await getProject(projectId);
  } catch (e) {
    console.error('get project:', e);
    showToast('falha ao carregar projeto');
    navigateHome();
    return;
  }
  if (!project) {
    showToast('projeto não encontrado');
    navigateHome();
    return;
  }
  currentProjectName = project.name;
  $title.textContent = project.name;
  $sub.textContent = project.description || '';

  await refreshAssets();
}

async function refreshAssets() {
  try {
    currentAssets = await listAssets({ projectId: currentProjectId });
  } catch (e) {
    console.error('list assets:', e);
    currentAssets = [];
  }
  renderAssets();
}

function renderAssets() {
  const filtered = currentFilter === 'all'
    ? currentAssets
    : currentAssets.filter((a) => a.status === currentFilter);

  $grid.innerHTML = '';
  if (!filtered.length) {
    $emptyCall.removeAttribute('hidden');
    return;
  }
  $emptyCall.setAttribute('hidden', '');

  for (const a of filtered) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'asset-card';
    card.setAttribute('data-asset-id', a.id);

    const created = new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const statusLabel = a.status === 'done' ? 'feito' : 'pendente';
    const statusClass = a.status === 'done' ? 'is-feito' : 'is-pendente';
    const previewChar = ((a.name || 'A').trim().charAt(0) || 'A').toUpperCase();
    const origin = ORIGIN_LABELS[a.video_origin] || null;
    const downloadable = !!a.gcs_url;
    const editable = !!a.video_id;

    const thumbUrl = a.video_thumb_url;
    card.innerHTML = `
      <div class="asset-card-preview${thumbUrl ? ' has-thumb' : ''}"${thumbUrl ? ` style="background-image:url('${thumbUrl}')"` : ''}>
        ${thumbUrl ? '' : `<div class="preview-mark preview-mark-letter">${escapeHtml(previewChar)}</div>`}
        <div class="asset-card-status ${statusClass}">${statusLabel}</div>
        <div class="asset-card-hover-actions">
          ${downloadable ? `<button class="asset-card-hover-btn" data-action="card-download" title="baixar .aseprite" type="button">↓</button>` : ''}
          ${editable ? `<button class="asset-card-hover-btn" data-action="card-edit" title="re-editar no editor" type="button">↗</button>` : ''}
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-card-name">${escapeHtml(a.name)}</div>
        <div class="asset-card-meta">
          <span>v${a.version} · ${created}</span>
          ${origin ? `<span class="asset-card-origin"><span class="asset-card-origin-icon">${origin.icon}</span>${origin.label}</span>` : ''}
        </div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="card-download"]')) {
        e.stopPropagation();
        downloadFile(a.gcs_url, `${a.name}.aseprite`);
        return;
      }
      if (e.target.closest('[data-action="card-edit"]')) {
        e.stopPropagation();
        navigateEditor(a.video_id);
        return;
      }
      openAssetDetail(a, currentProjectName, { onClose: refreshAssets });
    });

    card.addEventListener('contextmenu', (e) => buildAssetCtxMenu(e, a));

    $grid.appendChild(card);
  }
}

function downloadFile(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function buildAssetCtxMenu(event, a) {
  const items = [];
  if (a.gcs_url) {
    items.push({
      label: 'baixar .aseprite',
      icon: '↓',
      onClick: () => downloadFile(a.gcs_url, `${a.name}.aseprite`),
    });
  }
  if (a.video_gcs_url) {
    items.push({
      label: 'baixar vídeo-fonte',
      icon: '⇩',
      hint: '.mp4',
      onClick: () => downloadFile(a.video_gcs_url, `${a.video_name || a.name}.mp4`),
    });
  }
  if (a.video_id) {
    items.push({
      label: 'abrir no editor',
      icon: '✎',
      onClick: () => navigateEditor(a.video_id),
    });
  }
  items.push({
    label: 'ver detalhes',
    icon: '◇',
    onClick: () => openAssetDetail(a, currentProjectName, { onClose: refreshAssets }),
  });
  items.push({ divider: true });
  items.push({
    label: 'jogar na lixeira',
    icon: '⌫',
    danger: true,
    onClick: async () => {
      const ok = await confirmModal({
        title: 'jogar na lixeira',
        message: `Move "${a.name}" pra Lixeira. Vídeo-fonte volta a ser rascunho no Ateliê. Restaurável depois pela Lixeira (canto direito do header).`,
        confirmLabel: 'jogar na lixeira',
      });
      if (!ok) return;
      try {
        await deleteAsset(a.id);
        showToast('asset na lixeira');
        await refreshAssets();
      } catch (err) {
        showToast('falha: ' + err.message);
      }
    },
  });
  showContextMenu(event, items);
}

$filterChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    $filterChips.forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    currentFilter = chip.getAttribute('data-filter');
    renderAssets();
  });
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="goto-home"]')) navigateHome();
  if (e.target.closest('[data-action="goto-atelie-videos"]')) navigateAtelie('videos');
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
