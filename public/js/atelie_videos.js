// Atelie -> Videos. Lista videos, organiza em pastas, multi-selecao
// tipo planilha (ctrl/shift+click), menu de contexto custom.

import { listVideos, createVideo, deleteVideo, duplicateVideo, previewUrl, createVideoFromUrl, moveVideos } from './videos_api.js';
import { listFolders, createFolder, renameFolder, deleteFolder } from './folders_api.js';
import { openModal, closeModal, showToast, confirmModal } from './modals.js';
import { navigateEditor, navigateProject, navigateGenerate, navigateTextVideo } from './router.js';

const $grid = document.querySelector('[data-bind="video-grid"]');
const $empty = document.querySelector('[data-bind="videos-empty"]');
const $countVideos = document.querySelector('[data-bind="count-videos"]');

const $foldersList = document.querySelector('[data-bind="folders-list"]');
const $videosEyebrow = document.querySelector('[data-bind="videos-eyebrow"]');
const $videosTitle = document.querySelector('[data-bind="videos-title"]');
const $videosSub = document.querySelector('[data-bind="videos-sub"]');

const $multiBar = document.querySelector('[data-bind="multi-select-bar"]');
const $multiCount = document.querySelector('[data-bind="multi-select-count"]');
const $multiTrashLabel = document.querySelector('[data-bind="multi-select-trash-label"]');
const $multiMoveLabel = document.querySelector('[data-bind="multi-select-move-label"]');

const $ctxMenu = document.querySelector('[data-bind="atelie-ctx-menu"]');

// Estado
let videos = [];
let folders = [];
let rootCount = 0;
let pendingFlow = null;
// activeFolderId: undefined = todas as pastas; null = raiz; <uuid> = pasta.
let activeFolderId;
try {
  const stored = localStorage.getItem('atelie-active-folder');
  if (stored === 'null') activeFolderId = null;
  else if (stored && stored !== 'undefined') activeFolderId = stored;
} catch (e) { /* ignore */ }

let selected = new Set();
let anchorId = null;  // ultimo video clicado sem shift — ancora pro shift+click
let pendingMoveTargets = null;  // ids pra mover automatico apos criar pasta nova

export async function showAtelieVideos() {
  await refresh();
}

window.addEventListener('video-deleted', () => { refresh().catch(() => {}); });

async function refresh() {
  const skeletonTimer = setTimeout(() => renderSkeleton(6), 150);
  try {
    const [vids, fold] = await Promise.all([
      listVideos(activeFolderId),
      listFolders(),
    ]);
    videos = vids;
    folders = fold.folders || [];
    rootCount = fold.root_count || 0;
  } catch (e) {
    clearTimeout(skeletonTimer);
    console.error('refresh atelie:', e);
    showToast('falha ao listar');
    return;
  }
  clearTimeout(skeletonTimer);
  const totalGeral = rootCount + folders.reduce((acc, f) => acc + (f.video_count || 0), 0);
  $countVideos.textContent = String(totalGeral);
  renderFoldersSide();
  renderHeader();
  render();
}

function renderSkeleton(n) {
  $grid.innerHTML = '';
  $empty.setAttribute('hidden', '');
  for (let i = 0; i < n; i++) {
    const card = document.createElement('div');
    card.className = 'video-card video-card-skeleton';
    card.innerHTML = `
      <div class="video-card-thumb"></div>
      <div class="video-card-body">
        <div class="skel-line skel-line-name"></div>
        <div class="skel-line skel-line-meta"></div>
      </div>
    `;
    $grid.appendChild(card);
  }
}

function renderFoldersSide() {
  if (!$foldersList) return;
  $foldersList.innerHTML = '';
  const itens = [
    { kind: 'all', label: 'Todos', icon: '▦', count: rootCount + folders.reduce((a, f) => a + (f.video_count || 0), 0), key: 'all' },
    { kind: 'root', label: 'Raiz (sem pasta)', icon: '◇', count: rootCount, key: 'root' },
  ];
  for (const it of itens) {
    const li = document.createElement('li');
    li.className = 'atelie-folders-item';
    if (it.kind === 'all' && activeFolderId === undefined) li.classList.add('is-active');
    if (it.kind === 'root' && activeFolderId === null) li.classList.add('is-active');
    li.dataset.kind = it.kind;
    li.innerHTML = `
      <span class="atelie-folders-icon">${it.icon}</span>
      <span class="atelie-folders-name">${escapeHtml(it.label)}</span>
      <span class="atelie-folders-count">${it.count}</span>
    `;
    $foldersList.appendChild(li);
  }
  const sep = document.createElement('div');
  sep.className = 'atelie-folders-sep';
  $foldersList.appendChild(sep);
  for (const f of folders) {
    const li = document.createElement('li');
    li.className = 'atelie-folders-item';
    if (activeFolderId === f.id) li.classList.add('is-active');
    li.dataset.kind = 'folder';
    li.dataset.folderId = f.id;
    li.innerHTML = `
      <span class="atelie-folders-icon">▦</span>
      <span class="atelie-folders-name">${escapeHtml(f.nome)}</span>
      <span class="atelie-folders-count">${f.video_count || 0}</span>
    `;
    $foldersList.appendChild(li);
  }
}

function renderHeader() {
  let nome = 'Todos os vídeos';
  if (activeFolderId === null) nome = 'Raiz (sem pasta)';
  else if (typeof activeFolderId === 'string') {
    const f = folders.find((x) => x.id === activeFolderId);
    nome = f ? f.nome : 'Pasta';
  }
  if ($videosEyebrow) $videosEyebrow.textContent = `Ateliê / Vídeos / ${nome}`;
  if ($videosTitle) $videosTitle.innerHTML = `<em>${escapeHtml(nome)}</em>`;
  if ($videosSub) {
    if (activeFolderId === undefined) $videosSub.textContent = 'Matéria-prima da rotoscopia.';
    else if (activeFolderId === null) $videosSub.textContent = 'Vídeos sem pasta atribuída.';
    else $videosSub.textContent = 'Botão direito num vídeo pra trocar de pasta.';
  }
}

function render() {
  $grid.innerHTML = '';
  if (!videos.length) {
    $empty.removeAttribute('hidden');
    updateMultiBar();
    return;
  }
  $empty.setAttribute('hidden', '');

  for (const v of videos) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.videoId = v.id;
    if (selected.has(v.id)) card.classList.add('is-multi-selected');
    card.addEventListener('click', (e) => onCardClick(e, v));

    const origin = v.origin || 'uploaded';
    const originMap = {
      'uploaded': { label: 'upload', cls: 'tag-origin-upload', icon: '▲' },
      'url': { label: 'url', cls: 'tag-origin-url', icon: '↗' },
      'generated-generic': { label: 'gerado', cls: 'tag-origin-generic', icon: '✦' },
      'generated-t2v': { label: 'texto→vídeo', cls: 'tag-origin-generic', icon: '✦' },
      'generated-from-character': { label: 'personagem', cls: 'tag-origin-character', icon: '☻' },
    };
    const o = originMap[origin] || { label: origin, cls: '', icon: '·' };
    const isPublished = !!v.published_project_id;
    const dur = v.duration_s ? `${v.duration_s.toFixed(1)}s` : '';
    const projName = v.published_project_name || '';
    const publishedTag = isPublished
      ? `<button class="tag tag-published video-card-published-link" data-action="goto-published-project" data-project-id="${v.published_project_id}" type="button" title="abrir projeto na Galeria">◆ publicado em <em>${escapeHtml(projName)}</em></button>`
      : `<span class="tag tag-draft">◇ rascunho</span>`;
    const costTag = renderCostTag(v);
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
          ${costTag}
        </div>
      </div>
      <div class="video-card-hover-actions">
        <button class="video-card-hover-btn" data-action="duplicate-video" title="duplicar" type="button">⎘</button>
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
    // Botao direito no card: menu de contexto custom.
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Se o video clicado nao ta selecionado, ele vira a unica selecao.
      if (!selected.has(v.id)) {
        selected.clear();
        selected.add(v.id);
        anchorId = v.id;
        renderSelectionVisuals();
        updateMultiBar();
      }
      abrirMenuContextoVideo(e.clientX, e.clientY);
    });
    $grid.appendChild(card);
  }
  updateMultiBar();
}

// Click no card: ctrl/cmd toggle, shift range, simples = navega ou seleciona unica.
function onCardClick(e, v) {
  if (e.target.closest('.video-card-hover-actions')) return;
  if (e.target.closest('[data-action="goto-published-project"]')) return;
  const isToggle = e.ctrlKey || e.metaKey;
  const isRange = e.shiftKey;
  if (isToggle) {
    e.preventDefault();
    if (selected.has(v.id)) selected.delete(v.id);
    else { selected.add(v.id); anchorId = v.id; }
    renderSelectionVisuals();
    updateMultiBar();
    return;
  }
  if (isRange && anchorId && anchorId !== v.id) {
    e.preventDefault();
    const ids = videos.map((x) => x.id);
    const a = ids.indexOf(anchorId);
    const b = ids.indexOf(v.id);
    if (a >= 0 && b >= 0) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      selected.clear();
      for (let i = lo; i <= hi; i++) selected.add(ids[i]);
    }
    renderSelectionVisuals();
    updateMultiBar();
    return;
  }
  // Click simples: se ja tem selecao multipla, limpa primeiro e navega.
  if (selected.size > 0) {
    selected.clear();
    renderSelectionVisuals();
    updateMultiBar();
  }
  anchorId = v.id;
  navigateEditor(v.id);
}

function renderSelectionVisuals() {
  for (const card of $grid.querySelectorAll('.video-card')) {
    card.classList.toggle('is-multi-selected', selected.has(card.dataset.videoId));
  }
}

function updateMultiBar() {
  if (!$multiBar) return;
  const n = selected.size;
  if (n === 0) {
    $multiBar.setAttribute('hidden', '');
    return;
  }
  $multiBar.removeAttribute('hidden');
  $multiCount.textContent = n === 1 ? '1 vídeo selecionado' : `${n} vídeos selecionados`;
  if ($multiMoveLabel) $multiMoveLabel.textContent = n === 1 ? 'jogar para pasta…' : `jogar ${n} para pasta…`;
  if ($multiTrashLabel) $multiTrashLabel.textContent = n === 1 ? 'jogar na lixeira' : `jogar ${n} na lixeira`;
}

// ====== Sidebar de pastas ======

$foldersList?.addEventListener('click', (e) => {
  const li = e.target.closest('.atelie-folders-item');
  if (!li) return;
  const kind = li.dataset.kind;
  if (kind === 'all') setActiveFolder(undefined);
  else if (kind === 'root') setActiveFolder(null);
  else if (kind === 'folder') setActiveFolder(li.dataset.folderId);
});

$foldersList?.addEventListener('contextmenu', (e) => {
  const li = e.target.closest('.atelie-folders-item');
  if (!li || li.dataset.kind !== 'folder') return;
  e.preventDefault();
  e.stopPropagation();
  abrirMenuContextoPasta(e.clientX, e.clientY, li.dataset.folderId);
});

function setActiveFolder(id) {
  activeFolderId = id;
  try {
    if (id === undefined) localStorage.removeItem('atelie-active-folder');
    else if (id === null) localStorage.setItem('atelie-active-folder', 'null');
    else localStorage.setItem('atelie-active-folder', id);
  } catch (e) { /* ignore */ }
  selected.clear();
  anchorId = null;
  refresh();
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="folder-new"]')) return;
  openModalFolderNew();
});

function openModalFolderNew() {
  const m = document.querySelector('[data-modal="folder-new"]');
  const $i = m.querySelector('[data-bind="folder-new-input"]');
  const $err = m.querySelector('[data-bind="folder-new-err"]');
  $i.value = '';
  $err.textContent = '';
  openModal('folder-new');
  setTimeout(() => $i.focus(), 50);
}

// Se o modal folder-new for fechado sem criar (cancel/Esc/backdrop), zera o
// pending pra nao mover videos pra uma pasta que nao foi criada.
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="modal-close"]')) return;
  const m = document.querySelector('[data-modal="folder-new"]');
  if (m && !m.hasAttribute('hidden')) pendingMoveTargets = null;
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const m = document.querySelector('[data-modal="folder-new"]');
  if (m && !m.hasAttribute('hidden')) pendingMoveTargets = null;
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="folder-new-confirm"]')) return;
  const m = document.querySelector('[data-modal="folder-new"]');
  const $i = m.querySelector('[data-bind="folder-new-input"]');
  const $err = m.querySelector('[data-bind="folder-new-err"]');
  const nome = $i.value.trim();
  if (!nome) { $err.textContent = 'preencha o nome'; return; }
  try {
    const f = await createFolder(nome);
    closeModal();
    // Se o user criou a pasta via "nova pasta…" no modal de mover, ja move
    // os videos pra ela e nao troca de pasta ativa (so renderiza).
    if (pendingMoveTargets && pendingMoveTargets.length) {
      const targets = pendingMoveTargets;
      pendingMoveTargets = null;
      await moverSelecionadosPara(targets, f.id);
    } else {
      await refresh();
      setActiveFolder(f.id);
      showToast(`pasta "${f.nome}" criada`);
    }
  } catch (err) {
    $err.textContent = err.message;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const m = document.querySelector('[data-modal="folder-new"]');
  if (!m || m.hasAttribute('hidden')) return;
  if (e.target !== m.querySelector('[data-bind="folder-new-input"]')) return;
  e.preventDefault();
  m.querySelector('[data-action="folder-new-confirm"]').click();
});

// Renomear pasta
function openModalRenameFolder(folderId) {
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return;
  const m = document.querySelector('[data-modal="folder-rename"]');
  const $i = m.querySelector('[data-bind="folder-rename-input"]');
  const $err = m.querySelector('[data-bind="folder-rename-err"]');
  $i.value = folder.nome;
  $err.textContent = '';
  m.dataset.folderId = folderId;
  openModal('folder-rename');
  setTimeout(() => { $i.focus(); $i.select(); }, 50);
}

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="folder-rename-confirm"]')) return;
  const m = document.querySelector('[data-modal="folder-rename"]');
  const $i = m.querySelector('[data-bind="folder-rename-input"]');
  const $err = m.querySelector('[data-bind="folder-rename-err"]');
  const folderId = m.dataset.folderId;
  const nome = $i.value.trim();
  if (!nome) { $err.textContent = 'preencha o nome'; return; }
  try {
    await renameFolder(folderId, nome);
    closeModal();
    await refresh();
    showToast('pasta renomeada');
  } catch (err) {
    $err.textContent = err.message;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const m = document.querySelector('[data-modal="folder-rename"]');
  if (!m || m.hasAttribute('hidden')) return;
  if (e.target !== m.querySelector('[data-bind="folder-rename-input"]')) return;
  e.preventDefault();
  m.querySelector('[data-action="folder-rename-confirm"]').click();
});

async function apagarPasta(folderId) {
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return;
  const n = folder.video_count || 0;
  const msg = n === 0
    ? `Apagar pasta "${folder.nome}"?`
    : `Apagar pasta "${folder.nome}"? Os ${n} vídeos voltam pra raiz, nada é deletado.`;
  const ok = await confirmModal({ title: 'apagar pasta', message: msg, confirmLabel: 'apagar pasta', danger: true });
  if (!ok) return;
  try {
    await deleteFolder(folderId);
    if (activeFolderId === folderId) setActiveFolder(undefined);
    else await refresh();
    showToast('pasta apagada');
  } catch (err) {
    showToast('falha: ' + err.message);
  }
}

// ====== Modal "jogar para pasta" ======

function abrirModalEscolherPasta(videoIds) {
  const m = document.querySelector('[data-modal="folder-pick"]');
  const $list = m.querySelector('[data-bind="folder-pick-list"]');
  const $sub = m.querySelector('[data-bind="folder-pick-sub"]');
  const $title = m.querySelector('[data-bind="folder-pick-title"]');
  $title.textContent = videoIds.length === 1 ? 'Jogar vídeo para pasta' : `Jogar ${videoIds.length} vídeos para pasta`;
  $sub.textContent = 'Escolha o destino.';
  $list.innerHTML = '';
  // pasta atual dos videos selecionados — se todos compartilham, marca como is-current
  const currentFolderIds = new Set(videos.filter((v) => videoIds.includes(v.id)).map((v) => v.folder_id || null));
  const isAllInSame = currentFolderIds.size === 1;
  const currentFolderId = isAllInSame ? [...currentFolderIds][0] : 'mixed';
  // raiz
  const liRoot = document.createElement('li');
  liRoot.className = 'is-special';
  if (currentFolderId === null) liRoot.classList.add('is-current');
  liRoot.innerHTML = `<span>◇</span><span>Raiz (sem pasta)</span><span class="folder-pick-count">${currentFolderId === null ? 'aqui' : ''}</span>`;
  liRoot.addEventListener('click', () => moverSelecionadosPara(videoIds, null));
  $list.appendChild(liRoot);
  // pastas existentes
  for (const f of folders) {
    const li = document.createElement('li');
    if (currentFolderId === f.id) li.classList.add('is-current');
    li.innerHTML = `<span>▦</span><span>${escapeHtml(f.nome)}</span><span class="folder-pick-count">${currentFolderId === f.id ? 'aqui' : (f.video_count || 0)}</span>`;
    li.addEventListener('click', () => moverSelecionadosPara(videoIds, f.id));
    $list.appendChild(li);
  }
  // criar nova: fecha esse modal, abre o de nova pasta, e ao criar move os
  // videos pra ela automaticamente via flag pendingMoveTargets.
  const liNew = document.createElement('li');
  liNew.className = 'is-special';
  liNew.style.borderTop = '1px solid var(--copper-soft)';
  liNew.innerHTML = `<span>+</span><span><em>nova pasta…</em></span>`;
  liNew.addEventListener('click', () => {
    pendingMoveTargets = [...videoIds];
    closeModal();
    openModalFolderNew();
  });
  $list.appendChild(liNew);
  openModal('folder-pick');
}

async function moverSelecionadosPara(videoIds, folderId) {
  try {
    await moveVideos(videoIds, folderId);
    closeModal();
    selected.clear();
    await refresh();
    const dest = folderId === null ? 'raiz' : (folders.find((f) => f.id === folderId)?.nome || 'pasta');
    showToast(`${videoIds.length} ${videoIds.length === 1 ? 'vídeo movido' : 'vídeos movidos'} pra ${dest}`);
  } catch (err) {
    showToast('falha ao mover: ' + err.message);
  }
}

// ====== Bottom bar: mover/lixeira ======

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="multi-select-clear"]')) return;
  selected.clear();
  renderSelectionVisuals();
  updateMultiBar();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="multi-select-move"]')) return;
  if (!selected.size) return;
  abrirModalEscolherPasta([...selected]);
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="multi-select-trash"]')) return;
  if (!selected.size) return;
  const ids = [...selected];
  const ok = await confirmModal({
    title: 'mandar pra lixeira',
    message: `Mandar ${ids.length} ${ids.length === 1 ? 'vídeo' : 'vídeos'} pra lixeira? Você pode restaurar depois.`,
    confirmLabel: `mandar ${ids.length} pra lixeira`,
    danger: true,
  });
  if (!ok) return;
  videos = videos.filter((v) => !selected.has(v.id));
  render();
  const failed = [];
  await Promise.all(ids.map(async (id) => {
    try { await deleteVideo(id); }
    catch (err) { console.error('bulk-delete falhou', id, err); failed.push(id); }
  }));
  if (failed.length) showToast(`falha em ${failed.length} de ${ids.length}`);
  else showToast(`${ids.length} ${ids.length === 1 ? 'vídeo' : 'vídeos'} na lixeira`);
  selected.clear();
  refresh();
});

// ====== Menu de contexto ======

function fecharCtxMenu() {
  if (!$ctxMenu) return;
  $ctxMenu.setAttribute('hidden', '');
  $ctxMenu.innerHTML = '';
}

function abrirCtxMenu(x, y, items) {
  if (!$ctxMenu) return;
  $ctxMenu.innerHTML = '';
  for (const it of items) {
    if (it.sep) {
      const d = document.createElement('div');
      d.className = 'ctx-menu-sep';
      $ctxMenu.appendChild(d);
      continue;
    }
    const d = document.createElement('div');
    d.className = 'ctx-menu-item';
    if (it.danger) d.classList.add('is-danger');
    if (it.disabled) d.classList.add('is-disabled');
    d.textContent = it.label;
    if (!it.disabled && it.onClick) {
      d.addEventListener('click', () => {
        fecharCtxMenu();
        it.onClick();
      });
    }
    $ctxMenu.appendChild(d);
  }
  $ctxMenu.style.left = `${x}px`;
  $ctxMenu.style.top = `${y}px`;
  $ctxMenu.removeAttribute('hidden');
  // ajusta se sair da tela
  requestAnimationFrame(() => {
    const r = $ctxMenu.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) $ctxMenu.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight - 8) $ctxMenu.style.top = `${window.innerHeight - r.height - 8}px`;
  });
}

document.addEventListener('click', (e) => {
  if (!$ctxMenu || $ctxMenu.hasAttribute('hidden')) return;
  if (e.target.closest('.ctx-menu')) return;
  fecharCtxMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') fecharCtxMenu();
});
window.addEventListener('blur', fecharCtxMenu);

function abrirMenuContextoVideo(x, y) {
  const ids = [...selected];
  const n = ids.length;
  const items = [
    { label: n === 1 ? 'jogar para pasta…' : `jogar ${n} para pasta…`, onClick: () => abrirModalEscolherPasta(ids) },
    { label: n === 1 ? 'tirar da pasta (mandar pra raiz)' : `tirar ${n} da pasta`, onClick: () => moverSelecionadosPara(ids, null) },
    { sep: true },
  ];
  if (n === 1) {
    items.push({
      label: 'duplicar',
      onClick: async () => {
        try {
          const dup = await duplicateVideo(ids[0]);
          showToast('vídeo duplicado');
          await refresh();
          navigateEditor(dup.id);
        } catch (err) { showToast('falha: ' + err.message); }
      },
    });
  }
  items.push({
    label: n === 1 ? 'apagar' : `apagar ${n} vídeos`,
    danger: true,
    onClick: async () => {
      const ok = await confirmModal({
        title: 'apagar',
        message: n === 1 ? 'Apagar este vídeo?' : `Apagar ${n} vídeos? Eles vão pra lixeira.`,
        confirmLabel: n === 1 ? 'apagar' : `apagar ${n}`,
        danger: true,
      });
      if (!ok) return;
      const failed = [];
      await Promise.all(ids.map(async (id) => {
        try { await deleteVideo(id); }
        catch (err) { failed.push(id); }
      }));
      if (failed.length) showToast(`falha em ${failed.length} de ${ids.length}`);
      else showToast(n === 1 ? 'vídeo apagado' : `${n} apagados`);
      selected.clear();
      refresh();
    },
  });
  abrirCtxMenu(x, y, items);
}

function abrirMenuContextoPasta(x, y, folderId) {
  abrirCtxMenu(x, y, [
    { label: 'renomear', onClick: () => openModalRenameFolder(folderId) },
    { label: 'apagar pasta', danger: true, onClick: () => apagarPasta(folderId) },
  ]);
}

// ====== Criar video (fluxo original preservado) ======

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="new-video"]')) return;
  openModal('new-video');
});

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
    if (v === urlPreviewedFor) return;
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

function renderCostTag(v) {
  if (!v.origin || !v.origin.startsWith('generated-')) return '';
  const total = Number(v.cost_total);
  const tries = Number(v.cost_attempts) || 0;
  if (!Number.isFinite(total) || total <= 0) return '';
  const totalStr = `$${total.toFixed(2)}`;
  const label = tries > 1 ? `${totalStr} · ${tries}×` : totalStr;
  return `<span class="tag tag-cost">⛁ ${escapeHtml(label)}</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
