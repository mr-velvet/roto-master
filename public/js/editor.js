// Wrapper do editor existente. Orquestra: abrir vídeo, carregar do GCS,
// upload do arquivo local em background, ato de publicar.

import { bindUI as bindPlaybackUI, bootMode, stopPlay } from './playback.js';
import { buildUI, wireHandlers, setProgress, initRangeUI, refreshRangeUI, updateInfo, dom } from './ui.js';
import { initFileLoader, bindFileLoader, loadFromUrl } from './file_loader.js';
import { getVideo, uploadVideoFile, publishVideo, publishAsset, patchVideo, uploadThumb } from './videos_api.js';
import { listProjects } from './projects_api.js';
import { STATE } from './state.js';
import { vid, flipYRGBA } from './gl.js';
import { buildAseprite } from './aseprite.js';
import { openModal, closeModal, showToast } from './modals.js';
import { navigateProject, navigateAtelie } from './router.js';
import { startAutosave, stopAutosave, notifyChange, applyEditState } from './autosave.js';

let editorBooted = false;
let currentVideo = null;
let projectsCache = [];
let selectedProjectId = null;

const $videoNameDisplay = document.getElementById('video-name-display');
const $videoPublishState = document.getElementById('video-publish-state');
const $btnPublish = document.getElementById('btn-publish-asset');

export function initEditor() {
  if (editorBooted) return;
  editorBooted = true;

  buildUI();
  bindPlaybackUI({
    setProgress, updateInfo,
    $btnPlay: dom.$btnPlay,
    $btnExport: dom.$btnExport,
    $modeTabs: dom.$modeTabs,
  });
  wireHandlers();

  bindFileLoader({
    onLoaded: () => {
      initRangeUI();
      refreshRangeUI();
      setProgress('<span class="stage">Vídeo carregado.</span> Use os marcadores pra delimitar trecho, depois mude pra "rotoscopia" e exporte.', 0);
      updateInfo();
      bootMode('source');
      maybeCaptureThumb();
    },
    onFileSelected: (file) => {
      // se temos vídeo aberto sem gcs_url, este file vai pro upload em background
      if (currentVideo && !currentVideo.gcs_url) {
        uploadInBackground(file);
      }
    },
  });
  initFileLoader();

  $btnPublish.addEventListener('click', () => openPublishModal());
  wirePublishModal();
  wireAutosaveListeners();
  wireBackButton();
  wireInlineRename();
}

// Botão voltar no canto superior esquerdo do canvas.
function wireBackButton() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-action="editor-back"]')) return;
    navigateAtelie('videos');
  });
}

// Nome do vídeo: clicar transforma o display em input. Enter/blur salva.
function wireInlineRename() {
  $videoNameDisplay.addEventListener('click', () => {
    if (!currentVideo) return;
    if ($videoNameDisplay.classList.contains('is-editing')) return;
    enterRenameMode();
  });
}

function enterRenameMode() {
  const orig = currentVideo.name;
  $videoNameDisplay.classList.add('is-editing');
  $videoNameDisplay.contentEditable = 'true';
  $videoNameDisplay.spellcheck = false;
  $videoNameDisplay.focus();
  // seleciona tudo
  const range = document.createRange();
  range.selectNodeContents($videoNameDisplay);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = async (commit) => {
    $videoNameDisplay.removeEventListener('keydown', onKey);
    $videoNameDisplay.removeEventListener('blur', onBlur);
    $videoNameDisplay.classList.remove('is-editing');
    $videoNameDisplay.contentEditable = 'false';

    const next = $videoNameDisplay.textContent.trim();
    if (!commit || !next || next === orig) {
      $videoNameDisplay.textContent = orig;
      return;
    }
    if (next.length > 200) {
      $videoNameDisplay.textContent = orig;
      showToast('nome muito longo (máx 200)');
      return;
    }
    try {
      const updated = await patchVideo(currentVideo.id, { name: next });
      currentVideo.name = updated.name;
      $videoNameDisplay.textContent = updated.name;
      showToast('renomeado');
    } catch (e) {
      $videoNameDisplay.textContent = orig;
      showToast('falha ao renomear: ' + e.message);
    }
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  $videoNameDisplay.addEventListener('keydown', onKey);
  $videoNameDisplay.addEventListener('blur', onBlur);
}

// Hooka autosave em todos inputs do editor que afetam estado.
function wireAutosaveListeners() {
  const inputs = [
    'cap-start', 'cap-end', 'cap-fps', 'cap-scale', 'cap-overlay',
    'in-range', 'out-range',
  ];
  for (const id of inputs) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => notifyChange());
    if (el) el.addEventListener('input', () => notifyChange());
  }
  // sliders de PARAMS (gerados dinamicamente em buildUI)
  document.getElementById('sliders').addEventListener('input', () => notifyChange());
  // presets
  document.getElementById('presets').addEventListener('click', (e) => {
    const btn = e.target.closest('.preset-btn, button');
    if (!btn) return;
    const name = btn.dataset.name;
    if (name) notifyChange(name);
  });
}

export async function openEditor(videoId) {
  document.body.classList.add('no-video');
  $videoNameDisplay.textContent = '…';
  setPublishState(false);

  let v;
  try {
    v = await getVideo(videoId);
  } catch (e) {
    showToast('erro ao abrir vídeo: ' + e.message);
    navigateAtelie('videos');
    return;
  }
  if (!v) {
    showToast('vídeo não encontrado');
    navigateAtelie('videos');
    return;
  }
  currentVideo = v;
  $videoNameDisplay.textContent = v.name;
  setPublishState(!!v.published_asset_id);

  stopPlay();
  stopAutosave();

  // restaura estado salvo antes do primeiro render
  applyEditState(v.edit_state || {});
  startAutosave(v.id, v.edit_state || {});

  if (v.gcs_url) {
    setProgress('<span class="stage">Carregando vídeo do storage…</span>', 0);
    loadFromUrl(v.gcs_url);
  } else {
    setProgress('<span class="stage">Vídeo ainda sem arquivo.</span> Carregue um arquivo (botão acima ou arrastando aqui). Vai subir pro storage automaticamente.', 0);
  }
}

function setPublishState(isPublished) {
  if (isPublished) {
    $videoPublishState.innerHTML = '<span class="dot-ok"></span>publicado';
  } else {
    $videoPublishState.innerHTML = '<span class="dot-warn"></span>ainda não publicado';
  }
}

// Captura primeiro frame e sobe pro GCS, se ainda não houver thumb.
// Idempotente do lado do servidor; chamada barata.
async function maybeCaptureThumb() {
  if (!currentVideo || currentVideo.thumb_url) return;
  // garante que o vídeo tem dimensão conhecida e foi seekable
  if (!vid.videoWidth || !vid.videoHeight) return;
  try {
    // seek pro primeiro frame não-preto. Vou pra 0.1s pra evitar frame preto inicial.
    await new Promise((resolve) => {
      const onSeek = () => { vid.removeEventListener('seeked', onSeek); resolve(); };
      vid.addEventListener('seeked', onSeek);
      vid.currentTime = Math.min(0.1, (vid.duration || 1) * 0.05);
    });

    // canvas off-screen redimensionado pra max 480px de largura
    const maxW = 480;
    const ratio = vid.videoWidth / vid.videoHeight;
    const w = Math.min(vid.videoWidth, maxW);
    const h = Math.round(w / ratio);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(vid, 0, 0, w, h);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) return;

    const result = await uploadThumb(currentVideo.id, blob);
    if (result.video?.thumb_url) {
      currentVideo.thumb_url = result.video.thumb_url;
    }
  } catch (e) {
    // não-fatal: thumb é otimização, não bloqueia o editor
    console.warn('thumb capture falhou:', e.message);
  }
}

async function uploadInBackground(file) {
  if (!currentVideo) return;
  setProgress('<span class="stage">Enviando vídeo pro storage em segundo plano…</span>', 50);
  try {
    // metadata da mídia depois que <video> carregou
    await new Promise((r) => setTimeout(r, 100));
    const metadata = {
      duration_s: vid.duration || null,
      width: vid.videoWidth || null,
      height: vid.videoHeight || null,
    };
    const updated = await uploadVideoFile(currentVideo.id, file, metadata);
    currentVideo = updated;
    setProgress('<span class="ok">✓ Vídeo salvo no storage.</span> Próximas aberturas carregam direto.', 100);
    showToast('vídeo salvo');
  } catch (e) {
    console.error('upload falhou:', e);
    setProgress('<span class="err">Falha ao salvar no storage:</span> ' + e.message + '. O vídeo continua editável localmente, mas se recarregar a página vai precisar carregar de novo.', 0);
  }
}

// ====================== Publicar ======================

function wirePublishModal() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="toggle-project-select"]')) {
      const menu = document.querySelector('[data-bind="publish-project-menu"]');
      if (menu.hasAttribute('hidden')) menu.removeAttribute('hidden');
      else menu.setAttribute('hidden', '');
    }
  });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="confirm-publish"]')) return;
    await doPublish();
  });
}

async function openPublishModal() {
  if (!currentVideo) return;
  if (!STATE.frames || !STATE.frames.length) {
    // garante que existe pelo menos rotoscopia construída
    showToast('mude pra modo "rotoscopia" e dê play primeiro pra construir os frames');
    return;
  }

  try {
    projectsCache = await listProjects();
  } catch (e) {
    showToast('falha ao listar projetos: ' + e.message);
    return;
  }
  if (!projectsCache.length) {
    showToast('crie um projeto na Galeria antes de publicar');
    return;
  }

  selectedProjectId = null;
  const m = document.querySelector('[data-modal="publish"]');
  m.querySelector('[data-bind="publish-project-label"]').textContent = '— escolher —';
  m.querySelector('[data-bind="publish-asset-name"]').value = currentVideo.name;
  m.querySelector('[data-bind="publish-err"]').textContent = '';
  const warn = m.querySelector('[data-bind="publish-overwrite-warn"]');
  if (currentVideo.published_asset_id) warn.removeAttribute('hidden');
  else warn.setAttribute('hidden', '');

  // popula menu de projetos
  const menu = m.querySelector('[data-bind="publish-project-menu"]');
  menu.innerHTML = '';
  for (const p of projectsCache) {
    const li = document.createElement('li');
    li.textContent = p.name;
    li.addEventListener('click', () => {
      selectedProjectId = p.id;
      m.querySelector('[data-bind="publish-project-label"]').textContent = p.name;
      menu.setAttribute('hidden', '');
    });
    menu.appendChild(li);
  }
  menu.setAttribute('hidden', '');

  openModal('publish');
}

async function doPublish() {
  const m = document.querySelector('[data-modal="publish"]');
  const $err = m.querySelector('[data-bind="publish-err"]');
  $err.textContent = '';
  if (!selectedProjectId) {
    $err.textContent = 'escolha um projeto';
    return;
  }
  const assetName = m.querySelector('[data-bind="publish-asset-name"]').value.trim() || currentVideo.name;
  const N = STATE.frames.length;
  if (!N) {
    $err.textContent = 'sem frames pra publicar';
    return;
  }
  setProgress('<span class="stage">Gerando .aseprite…</span>', 50);
  try {
    const flipped = STATE.frames.map((f) => flipYRGBA(f, STATE.dw, STATE.dh));
    const aseBytes = buildAseprite(flipped, STATE.dw, STATE.dh, STATE.frameDurationMs);
    const blob = new Blob([aseBytes], { type: 'application/octet-stream' });
    const file = new File([blob], `${assetName}.aseprite`, { type: 'application/octet-stream' });

    let asset;
    if (currentVideo.published_asset_id) {
      // republicação
      asset = await publishAsset(currentVideo.published_asset_id, file);
    } else {
      asset = await publishVideo(currentVideo.id, file, selectedProjectId, assetName);
      currentVideo.published_asset_id = asset.id;
      setPublishState(true);
    }

    closeModal();
    showToast('asset publicado');
    setProgress('<span class="ok">✓ Asset publicado.</span> Indo pro projeto…', 100);
    setTimeout(() => navigateProject(selectedProjectId), 600);
  } catch (e) {
    console.error('publish:', e);
    $err.textContent = e.message;
    setProgress('<span class="err">Falha ao publicar:</span> ' + e.message, 0);
  }
}
