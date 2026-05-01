// =============================================================
//  ROTOSCOPE PoC — TRANSPORT ÚNICO (princípio WYSIWYG)
//  -----------------------------------------------------------
//  Não existe RAF contínuo a 60fps. Existe um array `frames[]` de
//  N RGBA buffers que é regenerado quando duração ou fps mudam.
//  Play, scrub e export consomem EXATAMENTE o mesmo array.
// =============================================================

import { bindUI as bindPlaybackUI, bootMode, stopPlay } from './playback.js';
import {
  buildUI, wireHandlers, setProgress, initRangeUI, refreshRangeUI, updateInfo, dom,
} from './ui.js';
import { initFileLoader, bindFileLoader } from './file_loader.js';
import { initAuth, signIn, signOut, getUser } from './auth.js';
import { getVideo } from './videos_api.js';
import { initVideoListUI, bindVideoList, showVideoList, hideVideoList } from './video_list.js';
import { bindRouter, startRouter, navigateList, navigateVideo } from './router.js';

// ----- Login screen handlers -----
const $loginErr = document.getElementById('login-err');
const $btnSignin = document.getElementById('btn-signin');
const $btnLogout = document.getElementById('btn-logout');
const $userAvatar = document.getElementById('user-avatar');
const $userEmail = document.getElementById('user-email');
const $btnBack = document.getElementById('btn-back');
const $videoNameDisplay = document.getElementById('video-name-display');

$btnSignin.addEventListener('click', async () => {
  $loginErr.textContent = '';
  try { await signIn(); }
  catch (e) { $loginErr.textContent = 'Falha no login: ' + e.message; }
});

$btnLogout.addEventListener('click', async () => {
  try { await signOut(); } catch(e) { console.warn(e); }
});

$btnBack.addEventListener('click', () => {
  stopPlay();
  navigateList();
});

let editorBooted = false;
let currentVideo = null;

function bootEditorOnce() {
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
    },
  });
  initFileLoader();
}

async function showEditor(videoId) {
  // Carrega metadata do vídeo
  let v;
  try {
    v = await getVideo(videoId);
  } catch (e) {
    alert('erro ao abrir vídeo: ' + e.message);
    navigateList();
    return;
  }
  if (!v) {
    alert('vídeo não encontrado');
    navigateList();
    return;
  }
  currentVideo = v;

  hideVideoList();
  document.body.classList.remove('view-list');
  document.body.classList.add('no-video'); // editor começa sem vídeo carregado
  bootEditorOnce();

  $videoNameDisplay.textContent = v.name;

  // TODO próxima sessão: se v.gcs_url, atribuir vid.src = v.gcs_url e disparar fluxo de loaded.
  // Por ora: editor abre vazio, user precisa carregar arquivo manualmente (que ainda só fica em browser).
  if (v.gcs_url) {
    setProgress('<span class="stage">Upload pra storage virá no próximo passo.</span> Por agora, carregue o vídeo manualmente.', 0);
  }
}

function showList() {
  document.body.classList.add('view-list');
  $videoNameDisplay.textContent = '';
  currentVideo = null;
  showVideoList();
}

(async () => {
  let result;
  try {
    result = await initAuth();
  } catch (e) {
    document.body.classList.remove('app-loading');
    document.body.classList.add('app-unauth');
    $loginErr.textContent = 'Erro inicializando auth: ' + e.message;
    return;
  }

  if (!result.authenticated) {
    document.body.classList.remove('app-loading');
    document.body.classList.add('app-unauth');
    if (result.error) $loginErr.textContent = result.error;
    return;
  }

  const u = getUser();
  if (u.userPicture) $userAvatar.src = u.userPicture; else $userAvatar.style.display = 'none';
  $userEmail.textContent = u.userEmail || u.userId;

  document.body.classList.remove('app-loading');

  // Wiring de lista + roteador
  initVideoListUI();
  bindVideoList({ onOpenVideo: (id) => navigateVideo(id) });
  bindRouter({
    onList: showList,
    onVideo: (id) => showEditor(id),
  });
  startRouter();
})();
