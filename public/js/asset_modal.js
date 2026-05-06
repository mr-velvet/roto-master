// Detalhe do asset — modal (visão seção 6.7).
// Quem chama: gal_project.js, click no asset-card.
// Estado vivo do modal; ao fechar, dispara onClose pra refresh externo se houve mudança.

import { patchAsset, deleteAsset } from './assets_api.js';
import { getVideo, duplicateVideo } from './videos_api.js';
import { openModal, closeModal, showToast, confirmModal } from './modals.js';
import { navigateEditor } from './router.js';

const $eyebrow = document.querySelector('[data-bind="asset-detail-eyebrow"]');
const $name = document.querySelector('[data-bind="asset-detail-name"]');
const $nameInput = document.querySelector('[data-bind="asset-detail-name-input"]');
const $preview = document.querySelector('[data-bind="asset-detail-preview"]');
const $statusChip = document.querySelector('[data-bind="asset-detail-status-chip"]');
const $sourceWrap = document.querySelector('[data-bind="asset-detail-source-wrap"]');
const $sourceName = document.querySelector('[data-bind="asset-detail-source-name"]');
const $meta = document.querySelector('[data-bind="asset-detail-meta"]');

// botões do modal — bind direto, evita problema de ordem de listeners globais
const $btnDownload = document.querySelector('[data-action="asset-detail-download"]');
const $btnReedit = document.querySelector('[data-action="asset-detail-reedit"]');
const $btnDuplicate = document.querySelector('[data-action="asset-detail-duplicate"]');
const $btnUnpublish = document.querySelector('[data-action="asset-detail-unpublish"]');
const $btnGotoSource = document.querySelector('[data-action="asset-detail-goto-source"]');

let currentAsset = null;
let onCloseDirty = null; // callback pra avisar gal_project que precisa refresh
let dirty = false;

export function openAssetDetail(asset, projectName, opts = {}) {
  currentAsset = { ...asset };
  dirty = false;
  onCloseDirty = opts.onClose || null;

  $eyebrow.textContent = `Galeria · ${projectName || '—'}`;
  renderName();
  renderStatus();
  renderPreview();
  renderSource();
  renderMeta();

  openModal('asset-detail', {
    onClose: () => {
      if (dirty && typeof onCloseDirty === 'function') onCloseDirty();
      currentAsset = null;
      onCloseDirty = null;
      // sai do modo edit-name caso estivesse
      $name.removeAttribute('hidden');
      $nameInput.setAttribute('hidden', '');
    },
  });
}

function renderName() {
  $name.textContent = currentAsset.name;
  $name.removeAttribute('hidden');
  $nameInput.setAttribute('hidden', '');
}

function renderStatus() {
  const isFeito = currentAsset.status === 'done';
  $statusChip.textContent = isFeito ? 'feito' : 'pendente';
  $statusChip.classList.toggle('is-feito', isFeito);
  $statusChip.classList.toggle('is-pendente', !isFeito);
}

function renderPreview() {
  // Marca tipográfica grande baseada na primeira letra do nome (não o ◇ genérico).
  const ch = (currentAsset.name || 'A').trim().charAt(0).toUpperCase() || 'A';
  $preview.textContent = ch;
}

function renderSource() {
  if (currentAsset.video_name) {
    $sourceName.textContent = currentAsset.video_name;
    $sourceWrap.removeAttribute('hidden');
  } else {
    $sourceWrap.setAttribute('hidden', '');
  }
}

function renderMeta() {
  const created = currentAsset.created_at
    ? new Date(currentAsset.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  $meta.textContent = `v${currentAsset.version} · ${created}`;
}

// chip status: alterna pendente↔feito no servidor, atualiza UI
$statusChip.addEventListener('click', async () => {
  if (!currentAsset) return;
  const next = currentAsset.status === 'done' ? 'pending' : 'done';
  const prev = currentAsset.status;
  currentAsset.status = next;
  renderStatus();
  try {
    const updated = await patchAsset(currentAsset.id, { status: next });
    Object.assign(currentAsset, updated);
    dirty = true;
  } catch (err) {
    currentAsset.status = prev;
    renderStatus();
    showToast('falha ao atualizar status: ' + err.message);
  }
});

// nome: click vira input
$name.addEventListener('click', () => {
  if (!currentAsset) return;
  $nameInput.value = currentAsset.name;
  $name.setAttribute('hidden', '');
  $nameInput.removeAttribute('hidden');
  $nameInput.focus();
  $nameInput.select();
});

async function commitNameEdit() {
  if (!currentAsset) return;
  const next = $nameInput.value.trim();
  if (!next || next === currentAsset.name) {
    renderName();
    return;
  }
  if (next.length > 200) {
    showToast('nome muito longo');
    return;
  }
  const prev = currentAsset.name;
  currentAsset.name = next;
  renderName();
  renderPreview();
  try {
    const updated = await patchAsset(currentAsset.id, { name: next });
    Object.assign(currentAsset, updated);
    dirty = true;
  } catch (err) {
    currentAsset.name = prev;
    renderName();
    renderPreview();
    showToast('falha ao renomear: ' + err.message);
  }
}

$nameInput.addEventListener('blur', commitNameEdit);
$nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $nameInput.blur();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    renderName(); // descarta
  }
});

// fonte: leva pro editor do vídeo associado
$btnGotoSource?.addEventListener('click', () => {
  if (!currentAsset || !currentAsset.video_id) return;
  // captura ANTES de closeModal — onClose zera currentAsset síncronamente.
  const videoId = currentAsset.video_id;
  closeModal();
  navigateEditor(videoId);
});

// re-editar
$btnReedit?.addEventListener('click', () => {
  if (!currentAsset || !currentAsset.video_id) {
    showToast('vídeo-fonte indisponível');
    return;
  }
  const videoId = currentAsset.video_id;
  closeModal();
  navigateEditor(videoId);
});

// baixar .aseprite
$btnDownload?.addEventListener('click', () => {
  if (!currentAsset || !currentAsset.gcs_url) {
    showToast('arquivo indisponível');
    return;
  }
  const a = document.createElement('a');
  a.href = currentAsset.gcs_url;
  a.download = `${currentAsset.name}.aseprite`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// duplicar vídeo: cria cópia independente do vídeo-fonte; leva pro editor da cópia
$btnDuplicate?.addEventListener('click', async () => {
  if (!currentAsset || !currentAsset.video_id) {
    showToast('vídeo-fonte indisponível');
    return;
  }
  const videoId = currentAsset.video_id;
  try {
    const dup = await duplicateVideo(videoId);
    showToast('vídeo duplicado — agora é independente');
    closeModal();
    navigateEditor(dup.id);
  } catch (err) {
    showToast('falha ao duplicar: ' + err.message);
  }
});

// jogar na lixeira (soft delete; restaurável da Lixeira no header)
$btnUnpublish?.addEventListener('click', async () => {
  if (!currentAsset) return;
  const ok = await confirmModal({
    title: 'jogar na lixeira',
    message: `Move o asset "${currentAsset.name}" pra Lixeira. O vídeo-fonte volta a ser rascunho no Ateliê. Você pode restaurar depois pela Lixeira.`,
    confirmLabel: 'jogar na lixeira',
  });
  if (!ok) return;
  try {
    await deleteAsset(currentAsset.id);
    dirty = true;
    showToast('asset jogado na lixeira');
    closeModal();
  } catch (err) {
    showToast('falha: ' + err.message);
  }
});
