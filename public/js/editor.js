// Wrapper do editor existente. Orquestra: abrir vídeo, carregar do GCS,
// upload do arquivo local em background, ato de publicar.

import { bindUI as bindPlaybackUI, bootMode, stopPlay, ensureBuilt } from './playback.js';
import { buildUI, wireHandlers, setProgress, initRangeUI, refreshRangeUI, updateInfo, dom } from './ui.js';
import { initFileLoader, bindFileLoader, loadFromUrl } from './file_loader.js';
import { getVideo, uploadVideoFile, publishVideo, publishAsset, publishVideoAsNew, patchVideo, uploadThumb, getStreamUrl, extractSection } from './videos_api.js';
import { listProjects } from './projects_api.js';
import { getAsset } from './assets_api.js';
import { STATE } from './state.js';
import { vid } from './gl.js';
import { buildAseprite } from './aseprite.js';
import { openModal, closeModal, showToast } from './modals.js';
import { navigateProject, navigateAtelie } from './router.js';
import { startAutosave, stopAutosave, notifyChange, applyEditState, onAutosaveStatus } from './autosave.js';

let editorBooted = false;
let currentVideo = null;
let projectsCache = [];
let selectedProjectId = null;
// Quando vídeo já tem asset publicado, guardamos {id, project_id, name} aqui
// pra decidir no submit: republicar (mesmo projeto+nome) ou publicar como
// novo (qualquer um diferente, dispara duplicação no backend).
let currentAssetForRepublish = null;

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

  $btnPublish.addEventListener('click', async () => {
    // Feedback imediato: o botão pode demorar (build de frames se não tem,
    // listProjects, getAsset). Sem isso parece travado por 5-10s.
    if ($btnPublish.disabled) return;
    const orig = $btnPublish.innerHTML;
    $btnPublish.disabled = true;
    $btnPublish.innerHTML = '<span class="btn-spin">◴</span> abrindo…';
    try {
      await openPublishModal();
    } finally {
      $btnPublish.disabled = false;
      $btnPublish.innerHTML = orig;
    }
  });
  wirePublishModal();
  wireAutosaveListeners();
  wireBackButton();
  wireInlineRename();
  wireExtractButton();
  wireStreamErrorRefresh();
  wireAutosaveIndicator();
}

// Liga o indicador visual de autosave (no painel direito) ao status
// publicado por autosave.js. Mostra: salvando… / salvo / falha.
function wireAutosaveIndicator() {
  const $ind = document.getElementById('autosave-indicator');
  if (!$ind) return;
  const $label = $ind.querySelector('.autosave-label');
  onAutosaveStatus((status) => {
    $ind.setAttribute('data-status', status);
    if (status === 'idle') $label.textContent = '—';
    else if (status === 'saving') $label.textContent = 'salvando…';
    else if (status === 'saved') $label.textContent = 'salvo';
    else if (status === 'error') $label.textContent = 'falha ao salvar';
  });
}

// Vídeos origin='url' usam streaming URL temporária (~6h). Se expirar
// durante a sessão, <video> dá erro de rede; aqui pedimos uma URL fresca
// e tentamos de novo. Transparente pro user.
let refreshingStream = false;
function wireStreamErrorRefresh() {
  vid.addEventListener('error', async () => {
    if (refreshingStream) return;
    if (!currentVideo) return;
    if (!currentVideo.source_url) return; // só pra streaming
    if (currentVideo.gcs_url) return;       // já é local, sem refresh
    const code = vid.error?.code;
    // 2 = MEDIA_ERR_NETWORK, 4 = MEDIA_ERR_SRC_NOT_SUPPORTED
    if (code !== 2 && code !== 4) return;
    refreshingStream = true;
    try {
      const fresh = await getStreamUrl(currentVideo.id);
      loadFromUrl(fresh);
    } catch (e) {
      console.warn('refresh stream falhou:', e.message);
    } finally {
      refreshingStream = false;
    }
  });
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

  // Feedback imediato: spinner enquanto busca vídeo no backend.
  // O empty-hint ("arraste um vídeo aqui") ficaria visível e dá sensação
  // de que o click no re-editar não fez nada — em vídeos grandes o download
  // posterior pode levar dezenas de segundos.
  const $loading = document.getElementById('video-loading');
  if ($loading) {
    $loading.querySelector('.video-loading-msg').textContent = 'abrindo vídeo…';
    $loading.classList.remove('is-error');
    $loading.removeAttribute('hidden');
  }

  let v;
  try {
    v = await getVideo(videoId);
  } catch (e) {
    if ($loading) $loading.setAttribute('hidden', '');
    showToast('erro ao abrir vídeo: ' + e.message);
    navigateAtelie('videos');
    return;
  }
  if (!v) {
    if ($loading) $loading.setAttribute('hidden', '');
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

  // 3 caminhos:
  //  a) tem gcs_url → carrega direto (caso normal: upload ou trecho extraído).
  //  b) origin='url' SEM gcs_url → pede streaming URL ao backend (yt-dlp -g).
  //  c) sem nada → modo "carregue um arquivo".
  if (v.gcs_url) {
    if ($loading) $loading.querySelector('.video-loading-msg').textContent = 'baixando vídeo do storage…';
    setProgress('<span class="stage">Carregando vídeo do storage…</span>', 0);
    loadFromUrl(v.gcs_url);
  } else if (v.origin === 'url' && v.source_url) {
    setProgress('<span class="stage">Buscando streaming URL…</span>', 0);
    try {
      const streamUrl = await getStreamUrl(v.id);
      loadFromUrl(streamUrl);
      setProgress('<span class="stage">Streaming do YouTube.</span> Marque in/out e clique em <em>extrair trecho</em> pra criar um vídeo na workbench.', 0);
    } catch (e) {
      setProgress('<span class="err">Falha ao obter streaming URL:</span> ' + e.message, 0);
    }
  } else {
    if ($loading) $loading.setAttribute('hidden', '');
    setProgress('<span class="stage">Vídeo ainda sem arquivo.</span> Carregue um arquivo (botão acima ou arrastando aqui). Vai subir pro storage automaticamente.', 0);
  }

  // mostra/esconde botão "extrair trecho" baseado no tipo do vídeo
  updateExtractButton();
}

// Botão "extrair trecho" só aparece pra vídeos com source_url (origin='url').
// Pra uploads/gerados, esconder. Validação de duração (≤20s) acontece on-click.
function updateExtractButton() {
  const $btn = document.getElementById('btn-extract');
  if (!$btn) return;
  if (currentVideo?.source_url) {
    $btn.style.display = '';
  } else {
    $btn.style.display = 'none';
  }
}

function wireExtractButton() {
  const $btn = document.getElementById('btn-extract');
  if (!$btn) return;
  $btn.addEventListener('click', async () => {
    if (!currentVideo) return;
    // pega in/out do estado atual do editor
    const in_s = STATE.inS;
    const out_s = STATE.outS;
    const dur = out_s - in_s;
    if (dur <= 0) {
      showToast('marque um trecho válido (in < out)');
      return;
    }
    if (dur > 20) {
      showToast(`trecho de ${dur.toFixed(1)}s — máx 20s pra rotoscopia`);
      return;
    }
    $btn.disabled = true;
    setProgress(`<span class="stage">Extraindo ${dur.toFixed(1)}s do YouTube…</span>`, 30);
    try {
      const newVideo = await extractSection(currentVideo.id, in_s, out_s);
      setProgress(`<span class="ok">✓ Trecho salvo como novo vídeo.</span> Indo pra ele…`, 100);
      showToast('trecho extraído');
      setTimeout(() => navigateAtelie('videos'), 400);
      // alternativa: ir direto pro editor do novo vídeo:
      // setTimeout(() => { window.location.hash = `#/v/${newVideo.id}`; }, 400);
    } catch (e) {
      setProgress(`<span class="err">Falha:</span> ${e.message}`, 0);
      showToast('falha: ' + e.message);
    } finally {
      $btn.disabled = false;
    }
  });
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
  // Toggle do dropdown via classList no wrapper .custom-select.
  // Click-fora fecha (dropdown precisa disso pra parecer nativo).
  document.addEventListener('click', (e) => {
    const select = document.querySelector('[data-bind="publish-project-select"]');
    if (!select) return;
    const toggleBtn = e.target.closest('[data-action="toggle-project-select"]');
    if (toggleBtn && select.contains(toggleBtn)) {
      select.classList.toggle('is-open');
      return;
    }
    // click fora do select fecha
    if (!select.contains(e.target)) {
      select.classList.remove('is-open');
    }
  });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="confirm-publish"]')) return;
    await doPublish();
  });

  // Atualiza info "vai sobrescrever" vs "vai criar novo" ao vivo
  // conforme o user altera o nome do asset no input.
  const $name = document.querySelector('[data-bind="publish-asset-name"]');
  if ($name) $name.addEventListener('input', updateRepublishInfo);
}

function updateRepublishInfo() {
  if (!currentAssetForRepublish) return;
  const m = document.querySelector('[data-modal="publish"]');
  const $info = m.querySelector('[data-bind="publish-republish-info"]');
  const $msg = m.querySelector('[data-bind="publish-republish-msg"]');
  const $dot = m.querySelector('[data-bind="publish-republish-dot"]');
  const $btn = m.querySelector('[data-action="confirm-publish"]');
  const nameInput = m.querySelector('[data-bind="publish-asset-name"]').value.trim();
  const sameName = nameInput && nameInput === currentAssetForRepublish.name;
  const sameProject = selectedProjectId === currentAssetForRepublish.project_id;

  $info.removeAttribute('hidden');
  if (sameName && sameProject) {
    $dot.className = 'dot dot-warn';
    $msg.innerHTML = `Vai <strong>sobrescrever</strong> o asset existente <em>${escapeHtml(currentAssetForRepublish.name)}</em>.`;
    if ($btn) $btn.querySelector('.btn-icon').textContent = '◆';
  } else {
    $dot.className = 'dot dot-ok';
    $msg.innerHTML = `Vai criar um <strong>asset novo</strong> (vídeo é duplicado por trás). O asset original <em>${escapeHtml(currentAssetForRepublish.name)}</em> fica intacto.`;
    if ($btn) $btn.querySelector('.btn-icon').textContent = '✦';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function openPublishModal() {
  if (!currentVideo) return;

  // Sem frames buildadas? Builda automaticamente — user pediu pra publicar,
  // então a construção é parte implícita do fluxo. Progress visível.
  if (!STATE.frames || !STATE.frames.length) {
    try {
      setProgress('<span class="stage">Construindo frames antes de publicar…</span>', 10);
      await ensureBuilt();
      if (!STATE.frames.length) {
        showToast('falha ao construir frames');
        setProgress('<span class="err">Falha ao construir frames pra publicação.</span>', 0);
        return;
      }
    } catch (e) {
      console.error('build pré-publish falhou:', e);
      showToast('falha ao construir: ' + e.message);
      return;
    }
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

  // Se vídeo já tem asset, busca pra ter project_id+name atuais e
  // pré-preencher o modal. Se mudar qualquer um, vira "publicar como novo".
  currentAssetForRepublish = null;
  if (currentVideo.published_asset_id) {
    try {
      const existing = await getAsset(currentVideo.published_asset_id);
      if (existing) {
        currentAssetForRepublish = {
          id: existing.id,
          project_id: existing.project_id,
          name: existing.name,
        };
      }
    } catch (e) {
      console.warn('falha ao buscar asset publicado:', e.message);
    }
  }

  selectedProjectId = currentAssetForRepublish?.project_id || null;
  const m = document.querySelector('[data-modal="publish"]');
  const initialProject = projectsCache.find((p) => p.id === selectedProjectId);
  m.querySelector('[data-bind="publish-project-label"]').textContent =
    initialProject?.name || '— escolher —';
  m.querySelector('[data-bind="publish-asset-name"]').value =
    currentAssetForRepublish?.name || currentVideo.name;
  m.querySelector('[data-bind="publish-err"]').textContent = '';

  const $info = m.querySelector('[data-bind="publish-republish-info"]');
  if (currentAssetForRepublish) {
    $info.removeAttribute('hidden');
  } else {
    $info.setAttribute('hidden', '');
  }

  // popula menu de projetos
  const select = m.querySelector('[data-bind="publish-project-select"]');
  const menu = m.querySelector('[data-bind="publish-project-menu"]');
  menu.innerHTML = '';
  for (const p of projectsCache) {
    const li = document.createElement('li');
    li.textContent = p.name;
    li.addEventListener('click', () => {
      selectedProjectId = p.id;
      m.querySelector('[data-bind="publish-project-label"]').textContent = p.name;
      select.classList.remove('is-open');
      updateRepublishInfo();
    });
    menu.appendChild(li);
  }
  select.classList.remove('is-open'); // garante fechado ao reabrir modal

  if (currentAssetForRepublish) updateRepublishInfo();

  openModal('publish');
}

async function doPublish() {
  const m = document.querySelector('[data-modal="publish"]');
  const $err = m.querySelector('[data-bind="publish-err"]');
  const $btn = m.querySelector('[data-action="confirm-publish"]');
  const $btnCancel = m.querySelector('[data-action="modal-close"]');
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

  // Feedback visível DENTRO do modal — setProgress sozinho fica escondido
  // pelo modal aberto. Disable + label dinâmico + classe is-loading.
  const origLabel = $btn.innerHTML;
  $btn.disabled = true;
  $btn.classList.add('is-loading');
  if ($btnCancel) $btnCancel.disabled = true;
  $btn.innerHTML = '<span class="btn-spin">◴</span> empacotando .aseprite…';

  setProgress('<span class="stage">Gerando .aseprite…</span>', 50);
  try {
    // STATE.frames já está top-down (linha 0 = topo visual), que é o que
    // .aseprite espera. Não precisa flipar antes.
    const aseBytes = buildAseprite(STATE.frames, STATE.dw, STATE.dh, STATE.frameDurationMs);
    const blob = new Blob([aseBytes], { type: 'application/octet-stream' });
    const file = new File([blob], `${assetName}.aseprite`, { type: 'application/octet-stream' });

    $btn.innerHTML = '<span class="btn-spin">◴</span> enviando pro storage…';

    let asset;
    let createdNew = false;
    if (currentAssetForRepublish) {
      const sameName = assetName === currentAssetForRepublish.name;
      const sameProject = selectedProjectId === currentAssetForRepublish.project_id;
      if (sameName && sameProject) {
        // Republicar: sobrescreve gcs_url do asset atual.
        asset = await publishAsset(currentAssetForRepublish.id, file);
      } else {
        // Mudou nome ou projeto: backend duplica o vídeo e cria asset novo.
        // O vídeo aberto no editor continua sendo o mesmo (asset original
        // intacto). Navegar pro projeto novo no fim deixa o user direto na
        // lista certa.
        const result = await publishVideoAsNew(currentVideo.id, file, selectedProjectId, assetName);
        asset = result.asset;
        createdNew = true;
      }
    } else {
      asset = await publishVideo(currentVideo.id, file, selectedProjectId, assetName);
      currentVideo.published_asset_id = asset.id;
      setPublishState(true);
    }

    $btn.innerHTML = '<span class="btn-icon" style="color:var(--moss)">✓</span> publicado';
    showToast(createdNew ? 'asset novo criado (vídeo duplicado)' : 'asset publicado');
    setProgress('<span class="ok">✓ Asset publicado.</span> Indo pro projeto…', 100);
    // delay pra user ver o "publicado" antes de fechar
    setTimeout(() => {
      closeModal();
      $btn.innerHTML = origLabel;
      $btn.disabled = false;
      $btn.classList.remove('is-loading');
      if ($btnCancel) $btnCancel.disabled = false;
      navigateProject(selectedProjectId);
    }, 700);
  } catch (e) {
    console.error('publish:', e);
    $err.textContent = e.message;
    setProgress('<span class="err">Falha ao publicar:</span> ' + e.message, 0);
    // restaura botão pra permitir nova tentativa
    $btn.innerHTML = origLabel;
    $btn.disabled = false;
    $btn.classList.remove('is-loading');
    if ($btnCancel) $btnCancel.disabled = false;
  }
}
