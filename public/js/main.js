// =============================================================
//  ROTOSCOPE PoC — TRANSPORT ÚNICO (princípio WYSIWYG)
//  -----------------------------------------------------------
//  Não existe RAF contínuo a 60fps. Existe um array `frames[]` de
//  N RGBA buffers que é regenerado quando duração ou fps mudam.
//  Play, scrub e export consomem EXATAMENTE o mesmo array.
// =============================================================

import { bindUI as bindPlaybackUI, bootMode } from './playback.js';
import {
  buildUI, wireHandlers, setProgress, initRangeUI, refreshRangeUI, updateInfo, dom,
} from './ui.js';
import { initFileLoader, bindFileLoader } from './file_loader.js';
import { initAuth, signIn, signOut, getUser } from './auth.js';

const $loginErr = document.getElementById('login-err');
const $btnSignin = document.getElementById('btn-signin');
const $btnLogout = document.getElementById('btn-logout');
const $userAvatar = document.getElementById('user-avatar');
const $userEmail = document.getElementById('user-email');

$btnSignin.addEventListener('click', async () => {
  $loginErr.textContent = '';
  try { await signIn(); }
  catch (e) { $loginErr.textContent = 'Falha no login: ' + e.message; }
});

$btnLogout.addEventListener('click', async () => {
  try { await signOut(); } catch(e) { console.warn(e); }
});

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
  document.body.classList.add('no-video');

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
})();
