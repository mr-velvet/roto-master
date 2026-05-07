// Detalhe do asset — modal (visão seção 6.7).
// Quem chama: gal_project.js, click no asset-card.
// Estado vivo do modal; ao fechar, dispara onClose pra refresh externo se houve mudança.

import { patchAsset, deleteAsset, uploadFinal } from './assets_api.js';
import { getVideo, duplicateVideo } from './videos_api.js';
import { openModal, closeModal, showToast, confirmModal } from './modals.js';
import { navigateEditor } from './router.js';
import { attachRotoscopyPreview } from './rotoscopy_preview.js';

const $eyebrow = document.querySelector('[data-bind="asset-detail-eyebrow"]');
const $name = document.querySelector('[data-bind="asset-detail-name"]');
const $nameInput = document.querySelector('[data-bind="asset-detail-name-input"]');
const $previewWrap = document.querySelector('[data-bind="asset-detail-preview-wrap"]');
const $preview = document.querySelector('[data-bind="asset-detail-preview"]');
const $previewVideo = document.querySelector('[data-bind="asset-detail-preview-video"]');
const $previewCanvas = document.querySelector('[data-bind="asset-detail-preview-canvas"]');
const $statusChip = document.querySelector('[data-bind="asset-detail-status-chip"]');
const $sourceWrap = document.querySelector('[data-bind="asset-detail-source-wrap"]');
const $sourceName = document.querySelector('[data-bind="asset-detail-source-name"]');
const $meta = document.querySelector('[data-bind="asset-detail-meta"]');

// botões do modal — bind direto, evita problema de ordem de listeners globais
const $btnUploadFinal = document.querySelector('[data-action="asset-detail-upload-final"]');
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
      $name.removeAttribute('hidden');
      $nameInput.setAttribute('hidden', '');
      $previewVideo.pause();
      $previewVideo.removeAttribute('src');
      $previewVideo.load();
      destroyRotoscopyPreview();
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

let rotoscopyPreview = null;

function destroyRotoscopyPreview() {
  if (rotoscopyPreview) { rotoscopyPreview.stop(); rotoscopyPreview = null; }
}

function renderPreview() {
  const ch = (currentAsset.name || 'A').trim().charAt(0).toUpperCase() || 'A';
  $preview.textContent = ch;

  destroyRotoscopyPreview();
  // limpa canvas
  $previewCanvas.setAttribute('hidden', '');
  // limpa video
  $previewVideo.removeAttribute('src');
  $previewVideo.load();
  $previewVideo.setAttribute('hidden', '');
  $preview.setAttribute('hidden', '');

  const isDone = currentAsset.status === 'done' && !!currentAsset.gcs_url;
  const videoUrl = currentAsset.video_gcs_url;

  if (isDone) {
    $previewCanvas.removeAttribute('hidden');
    rotoscopyPreview = attachRotoscopyPreview(currentAsset.gcs_url, $previewCanvas, { autoStart: true });
  } else if (videoUrl) {
    $previewVideo.src = videoUrl;
    $previewVideo.currentTime = 0;
    $previewVideo.removeAttribute('hidden');
  } else {
    $preview.removeAttribute('hidden');
  }
}

// hover: vídeo toca, rotoscopia já está em loop (autoStart).
// mouseleave: vídeo pausa+reseta, rotoscopia continua tocando (ela é o próprio
// trabalho final, não faz sentido parar).
$previewWrap?.addEventListener('mouseenter', () => {
  if ($previewVideo.src) $previewVideo.play().catch(() => {});
});
$previewWrap?.addEventListener('mouseleave', () => {
  if ($previewVideo.src) {
    $previewVideo.pause();
    try { $previewVideo.currentTime = 0; } catch {}
  }
});

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

// subir trabalho final (.aseprite finalizado da pessoa)
$btnUploadFinal?.addEventListener('click', () => {
  if (!currentAsset) return;
  const assetId = currentAsset.id;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.aseprite,application/octet-stream';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!/\.aseprite$/i.test(file.name)) {
      showToast('precisa ser um arquivo .aseprite');
      return;
    }
    showToast('subindo trabalho final…', 1500);
    try {
      const updated = await uploadFinal(assetId, file);
      // atualiza estado local + UI sem fechar o modal
      if (currentAsset && currentAsset.id === updated.id) {
        Object.assign(currentAsset, updated);
        renderStatus();
        renderMeta();
        renderPreview();
      }
      dirty = true;
      showToast('trabalho final salvo · asset marcado como feito');
    } catch (err) {
      console.error('upload-final failed:', err);
      showToast('falha ao subir: ' + (err.message || 'erro desconhecido'));
    }
  });
  input.click();
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
  // captura defensiva: se algo no caminho fechar o modal de detalhe
  // (zerando currentAsset), ainda temos o id pra completar a operação.
  const assetId = currentAsset.id;
  const assetName = currentAsset.name;
  const ok = await confirmModal({
    title: 'jogar na lixeira',
    message: `Move o asset "${assetName}" pra Lixeira. O vídeo de origem continua intacto no Ateliê. Você pode restaurar o asset depois pela Lixeira.`,
    confirmLabel: 'jogar na lixeira',
  });
  if (!ok) return;
  try {
    await deleteAsset(assetId);
    dirty = true;
    showToast('asset jogado na lixeira');
    closeModal();
  } catch (err) {
    console.error('trash asset failed:', err);
    showToast('falha: ' + (err.message || 'erro desconhecido'));
  }
});
