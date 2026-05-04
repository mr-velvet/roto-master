// Galeria · Home — lista de projetos.

import { listProjects, createProject } from './projects_api.js';
import { openModal, closeModal, showToast } from './modals.js';
import { navigateProject } from './router.js';

const $grid = document.querySelector('[data-bind="project-grid"]');
const $empty = document.querySelector('[data-bind="projects-empty"]');

let projects = [];

export async function showHome() {
  await refresh();
}

async function refresh() {
  try {
    projects = await listProjects();
  } catch (e) {
    console.error('list projects:', e);
    showToast('falha ao listar projetos');
    return;
  }
  render();
}

function render() {
  $grid.innerHTML = '';
  if (!projects.length) {
    $empty.removeAttribute('hidden');
    return;
  }
  $empty.setAttribute('hidden', '');

  for (const p of projects) {
    const card = document.createElement('button');
    card.className = 'project-card';
    card.addEventListener('click', () => navigateProject(p.id));

    const created = new Date(p.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    card.innerHTML = `
      <div class="project-card-thumbs">
        <div class="thumb empty"></div>
        <div class="thumb empty"></div>
        <div class="thumb empty"></div>
      </div>
      <div class="project-card-name">${escapeHtml(p.name)}</div>
      <div class="project-card-meta">
        <span><span class="meta-num">${p.asset_count}</span> ${p.asset_count === 1 ? 'asset' : 'assets'}</span>
        <span><span class="meta-num">${p.member_count}</span> ${p.member_count === 1 ? 'membro' : 'membros'}</span>
        <span>${created}</span>
      </div>
    `;
    $grid.appendChild(card);
  }
}

// botão "novo projeto"
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="new-project"]')) return;
  const m = document.querySelector('[data-modal="new-project"]');
  m.querySelector('[data-bind="new-project-name"]').value = '';
  m.querySelector('[data-bind="new-project-err"]').textContent = '';
  openModal('new-project');
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="confirm-new-project"]')) return;
  const m = document.querySelector('[data-modal="new-project"]');
  const $input = m.querySelector('[data-bind="new-project-name"]');
  const $err = m.querySelector('[data-bind="new-project-err"]');
  const name = $input.value.trim();
  if (!name) {
    $err.textContent = 'nome é obrigatório';
    return;
  }
  try {
    const p = await createProject(name);
    closeModal();
    showToast('projeto criado');
    projects.unshift(p);
    render();
    navigateProject(p.id);
  } catch (err) {
    $err.textContent = err.message;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
