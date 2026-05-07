// Galeria · Detalhe do projeto — lista de assets do projeto.

import { getProject } from './projects_api.js';
import { listAssets, deleteAsset, uploadFinal } from './assets_api.js';
import { showToast, confirmModal } from './modals.js';
import { openAssetDetail } from './asset_modal.js';
import { navigateAtelie, navigateHome, navigateEditor } from './router.js';
import { showContextMenu } from './context_menu.js';
import { attachRotoscopyPreview } from './rotoscopy_preview.js';

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

    // Status 'done' + .aseprite no GCS: mostra rotoscopia animada do próprio
    // arquivo final (canvas + parser). Caso contrário, mostra vídeo de
    // referência. Fallback: letra capitular se nada está disponível.
    const isDone = a.status === 'done' && !!a.gcs_url;
    const videoUrl = a.video_gcs_url;
    let previewHtml;
    if (isDone) {
      previewHtml = `<canvas class="asset-card-preview-canvas" data-bind="rotoscopy-canvas"></canvas>`;
    } else if (videoUrl) {
      previewHtml = `<video class="asset-card-preview-video" muted playsinline loop preload="metadata" src="${escapeAttr(videoUrl)}"></video>`;
    } else {
      previewHtml = `<div class="preview-mark preview-mark-letter">${escapeHtml(previewChar)}</div>`;
    }
    card.innerHTML = `
      <div class="asset-card-preview${isDone ? ' has-rotoscopy' : (videoUrl ? ' has-video' : '')}">
        ${previewHtml}
        <div class="asset-card-status ${statusClass}">${statusLabel}</div>
        <div class="asset-card-hover-actions">
          <button class="asset-card-hover-btn" data-action="card-upload-final" title="subir trabalho final (.aseprite)" type="button">↥</button>
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
      if (e.target.closest('[data-action="card-upload-final"]')) {
        e.stopPropagation();
        triggerUploadFinal(a, refreshAssets);
        return;
      }
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

    const $vid = card.querySelector('.asset-card-preview-video');
    if ($vid) {
      card.addEventListener('mouseenter', () => { $vid.play().catch(() => {}); });
      card.addEventListener('mouseleave', () => {
        $vid.pause();
        try { $vid.currentTime = 0; } catch {}
      });
    }
    const $canvas = card.querySelector('[data-bind="rotoscopy-canvas"]');
    if ($canvas && a.gcs_url) {
      // Lazy: só anexa quando o card entra no viewport (evita parsear todos
      // os .aseprite de uma galeria grande de uma vez).
      let preview = null;
      const ensure = () => {
        if (!preview) preview = attachRotoscopyPreview(a.gcs_url, $canvas, { autoStart: false });
        return preview;
      };
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { ensure(); io.disconnect(); }
        }
      }, { rootMargin: '200px' });
      io.observe(card);
      card.addEventListener('mouseenter', () => { ensure().play(); });
      card.addEventListener('mouseleave', () => {
        if (preview) { preview.pause(); preview.reset(); }
      });
    }

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

// Helper compartilhado: abre file picker .aseprite, sobe via upload-final,
// chama onDone (refresh do contexto). Usado pelo card e pelo menu de contexto.
function triggerUploadFinal(asset, onDone) {
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
      await uploadFinal(asset.id, file);
      showToast('trabalho final salvo · asset marcado como feito');
      if (typeof onDone === 'function') await onDone();
    } catch (err) {
      console.error('upload-final failed:', err);
      showToast('falha ao subir: ' + (err.message || 'erro desconhecido'));
    }
  });
  input.click();
}

export { triggerUploadFinal };

function buildAssetCtxMenu(event, a) {
  const items = [];
  items.push({
    label: 'subir trabalho final',
    icon: '↥',
    hint: '.aseprite',
    onClick: () => triggerUploadFinal(a, refreshAssets),
  });
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
        message: `Move "${a.name}" pra Lixeira. O vídeo de origem continua intacto no Ateliê. Restaurável depois pela Lixeira (canto direito do header).`,
        confirmLabel: 'jogar na lixeira',
      });
      if (!ok) return;
      try {
        await deleteAsset(a.id);
        showToast('asset na lixeira');
        await refreshAssets();
      } catch (err) {
        console.error('trash asset failed:', err);
        showToast('falha: ' + (err.message || 'erro desconhecido'));
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

function escapeAttr(s) {
  return String(s).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));
}
