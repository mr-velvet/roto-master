// Galeria · Detalhe do projeto — lista de assets do projeto.

import { getProject } from './projects_api.js';
import { listAssets } from './assets_api.js';
import { showToast } from './modals.js';
import { navigateAtelie, navigateHome } from './router.js';

const $title = document.querySelector('[data-bind="project-name"]');
const $sub = document.querySelector('[data-bind="project-sub"]');
const $grid = document.querySelector('[data-bind="asset-grid"]');
const $emptyCall = document.querySelector('[data-bind="empty-call"]');
const $filterChips = document.querySelectorAll('[data-bind="asset-filter"] .chip');

let currentProjectId = null;
let currentAssets = [];
let currentFilter = 'all';

export async function showProject(projectId) {
  currentProjectId = projectId;
  currentFilter = 'all';
  $filterChips.forEach((c) => c.classList.toggle('is-active', c.getAttribute('data-filter') === 'all'));

  $title.textContent = '…';
  $sub.textContent = '';
  $grid.innerHTML = '';
  $emptyCall.setAttribute('hidden', '');

  let data;
  try {
    data = await getProject(projectId);
  } catch (e) {
    console.error('get project:', e);
    showToast('falha ao carregar projeto');
    navigateHome();
    return;
  }
  if (!data) {
    showToast('projeto não encontrado');
    navigateHome();
    return;
  }
  const { project, members } = data;
  $title.textContent = project.name;
  const memberSummary = members.length === 1 ? '1 membro' : `${members.length} membros`;
  $sub.textContent = project.description || `${memberSummary}.`;

  try {
    currentAssets = await listAssets({ projectId });
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
    const card = document.createElement('div');
    card.className = 'asset-card';

    const created = new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const statusLabel = a.status === 'done' ? 'feito' : 'pendente';
    const statusClass = a.status === 'done' ? 'is-feito' : 'is-pendente';

    card.innerHTML = `
      <div class="asset-card-preview">
        <div class="preview-mark">◇</div>
        <div class="asset-card-status ${statusClass}">${statusLabel}</div>
      </div>
      <div class="asset-card-body">
        <div class="asset-card-name">${escapeHtml(a.name)}</div>
        <div class="asset-card-meta">v${a.version} · ${created}</div>
        ${a.video_origin ? `<div class="asset-card-source"><span class="asset-card-source-icon">↳</span>origem: ${a.video_origin}</div>` : ''}
      </div>
    `;
    $grid.appendChild(card);
  }
}

// filtros
$filterChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    $filterChips.forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    currentFilter = chip.getAttribute('data-filter');
    renderAssets();
  });
});

// chamadas globais
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="goto-home"]')) navigateHome();
  if (e.target.closest('[data-action="goto-atelie-videos"]')) navigateAtelie('videos');
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
