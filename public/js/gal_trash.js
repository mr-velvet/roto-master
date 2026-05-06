// Lixeira global: lista assets soft-deletados, permite restaurar ou apagar de vez.

import { listTrash, restoreAsset, purgeAsset } from './assets_api.js';
import { showToast, confirmModal } from './modals.js';

const $grid = document.querySelector('[data-bind="trash-grid"]');
const $empty = document.querySelector('[data-bind="trash-empty"]');

export async function showTrash() {
  $grid.innerHTML = '';
  $empty.setAttribute('hidden', '');
  try {
    const assets = await listTrash();
    if (!assets.length) {
      $empty.removeAttribute('hidden');
      return;
    }
    for (const a of assets) renderCard(a);
  } catch (err) {
    showToast('falha ao carregar lixeira: ' + err.message);
  }
}

function renderCard(asset) {
  const card = document.createElement('div');
  card.className = 'trash-card';
  const ch = (asset.name || 'A').trim().charAt(0).toUpperCase() || 'A';
  const deletedAt = asset.deleted_at
    ? new Date(asset.deleted_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  card.innerHTML = `
    <div class="trash-card-mark">${ch}</div>
    <div class="trash-card-name">${escapeHtml(asset.name)}</div>
    <div class="trash-card-meta">
      <span>projeto: ${escapeHtml(asset.project_name || '—')}</span>
      <span>vídeo: ${escapeHtml(asset.video_name || '—')}</span>
      <span>descartado em ${deletedAt}</span>
    </div>
    <div class="trash-card-actions">
      <button class="btn btn-ghost" data-action="trash-restore">restaurar</button>
      <button class="btn btn-danger" data-action="trash-purge">apagar de vez</button>
    </div>
  `;
  card.querySelector('[data-action="trash-restore"]').addEventListener('click', () => doRestore(asset, card));
  card.querySelector('[data-action="trash-purge"]').addEventListener('click', () => doPurge(asset, card));
  $grid.appendChild(card);
}

async function doRestore(asset, card) {
  try {
    await restoreAsset(asset.id);
    showToast('asset restaurado');
    card.remove();
    if (!$grid.children.length) $empty.removeAttribute('hidden');
  } catch (err) {
    showToast('falha: ' + err.message);
  }
}

async function doPurge(asset, card) {
  const ok = await confirmModal({
    title: 'apagar de vez',
    message: `Apaga "${asset.name}" definitivamente. Não dá pra desfazer — o arquivo .aseprite também é removido do storage.`,
    confirmLabel: 'apagar de vez',
  });
  if (!ok) return;
  try {
    await purgeAsset(asset.id);
    showToast('asset apagado');
    card.remove();
    if (!$grid.children.length) $empty.removeAttribute('hidden');
  } catch (err) {
    showToast('falha: ' + err.message);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
