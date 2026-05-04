// Galeria · Detalhe do projeto — lista de assets do projeto.

import { getProject, addMember, removeMember } from './projects_api.js';
import { listAssets } from './assets_api.js';
import { showToast, confirmModal } from './modals.js';
import { openAssetDetail } from './asset_modal.js';
import { navigateAtelie, navigateHome, navigateEditor } from './router.js';
import { getUser } from './auth.js';

const $title = document.querySelector('[data-bind="project-name"]');
const $sub = document.querySelector('[data-bind="project-sub"]');
const $grid = document.querySelector('[data-bind="asset-grid"]');
const $emptyCall = document.querySelector('[data-bind="empty-call"]');
const $filterChips = document.querySelectorAll('[data-bind="asset-filter"] .chip');
const $membersList = document.querySelector('[data-bind="members-list"]');
const $membersAdd = document.querySelector('[data-bind="members-add"]');
const $membersAddInput = document.querySelector('[data-bind="members-add-input"]');
const $membersErr = document.querySelector('[data-bind="members-err"]');

let currentProjectId = null;
let currentProjectName = '';
let currentMyRole = null;
let currentMembers = [];
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
  currentProjectName = project.name;
  currentMyRole = project.my_role;
  currentMembers = members;
  $title.textContent = project.name;
  const memberSummary = members.length === 1 ? '1 membro' : `${members.length} membros`;
  $sub.textContent = project.description || `${memberSummary}.`;

  renderMembers();
  await refreshAssets();
}

function renderMembers() {
  const me = getUser();
  const myEmail = (me.userEmail || '').toLowerCase();

  $membersList.innerHTML = '';
  for (const m of currentMembers) {
    const li = document.createElement('li');
    li.className = 'member-row';
    const isPending = String(m.member_sub).startsWith('pending:');
    const isMe = !isPending && me.userId && m.member_sub === me.userId;
    const labelEmail = m.member_email || (isPending ? String(m.member_sub).slice('pending:'.length) : '—');

    const roleTag = m.role === 'owner'
      ? '<span class="member-role member-role-owner">owner</span>'
      : '<span class="member-role">member</span>';
    const stateTag = isPending ? '<span class="member-pending">aguarda 1º login</span>' : '';
    const meTag = isMe ? '<span class="member-me">você</span>' : '';

    const canRemove = currentMyRole === 'owner' && !(isMe && m.role === 'owner');
    const removeBtn = canRemove
      ? `<button class="member-remove" data-action="remove-member" data-sub="${escapeHtml(m.member_sub)}" data-email="${escapeHtml(labelEmail)}" title="remover" type="button">×</button>`
      : '';

    li.innerHTML = `
      <span class="member-avatar">${escapeHtml((labelEmail[0] || '?').toUpperCase())}</span>
      <span class="member-email">${escapeHtml(labelEmail)}</span>
      ${meTag}
      ${roleTag}
      ${stateTag}
      ${removeBtn}
    `;
    $membersList.appendChild(li);
  }

  if (currentMyRole === 'owner') {
    $membersAdd.removeAttribute('hidden');
  } else {
    $membersAdd.setAttribute('hidden', '');
  }
  $membersErr.textContent = '';
  $membersAddInput.value = '';
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

    card.innerHTML = `
      <div class="asset-card-preview">
        <div class="preview-mark preview-mark-letter">${escapeHtml(previewChar)}</div>
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
        const link = document.createElement('a');
        link.href = a.gcs_url;
        link.download = `${a.name}.aseprite`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }
      if (e.target.closest('[data-action="card-edit"]')) {
        e.stopPropagation();
        navigateEditor(a.video_id);
        return;
      }
      openAssetDetail(a, currentProjectName, { onClose: refreshAssets });
    });

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

// adicionar membro
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="add-member"]')) return;
  if (!currentProjectId) return;
  const email = $membersAddInput.value.trim().toLowerCase();
  $membersErr.textContent = '';
  if (!email || !email.includes('@')) {
    $membersErr.textContent = 'email inválido';
    return;
  }
  try {
    const { member, pending } = await addMember(currentProjectId, email);
    currentMembers = [...currentMembers, member];
    renderMembers();
    showToast(pending ? 'convite enviado — vai virar membro no 1º login' : 'membro adicionado');
  } catch (err) {
    $membersErr.textContent = err.message;
  }
});

$membersAddInput?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  document.querySelector('[data-action="add-member"]')?.click();
});

// remover membro
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="remove-member"]');
  if (!btn || !currentProjectId) return;
  const sub = btn.getAttribute('data-sub');
  const email = btn.getAttribute('data-email');
  const ok = await confirmModal({
    title: 'remover membro',
    message: `Remover ${email} deste projeto? Ele perde acesso aos assets daqui.`,
    confirmLabel: 'remover',
  });
  if (!ok) return;
  try {
    await removeMember(currentProjectId, sub);
    currentMembers = currentMembers.filter((m) => m.member_sub !== sub);
    renderMembers();
    showToast('membro removido');
  } catch (err) {
    showToast('falha ao remover: ' + err.message);
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
