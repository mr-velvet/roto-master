// Bootstrap. Auth → router → screens.

import { initAuth, signIn, signOut, getUser } from './auth.js';
import { bindRouter, startRouter, navigateHome, navigateAtelie, navigateEditor, currentRoute } from './router.js';
import { bindChrome, setSpace, setBreadcrumb } from './chrome.js';
import { showHome } from './gal_home.js';
import { showProject } from './gal_project.js';
import { showAtelieVideos } from './atelie_videos.js';
import { showAtelieGenerate } from './atelie_generate.js';
import { showAtelieTextVideo } from './atelie_text2video.js';
import { initEditor, openEditor } from './editor.js';

const $loginErr = document.getElementById('login-err');
const $btnSignin = document.getElementById('btn-signin');
const $btnLogout = document.getElementById('btn-logout');
const $userAvatar = document.getElementById('user-avatar');
const $userAvatarLetter = document.getElementById('user-avatar-letter');
const $userEmail = document.getElementById('user-email');

$btnSignin.addEventListener('click', async () => {
  $loginErr.textContent = '';
  try { await signIn(); }
  catch (e) { $loginErr.textContent = 'Falha no login: ' + e.message; }
});

$btnLogout.addEventListener('click', async () => {
  try { await signOut(); } catch (e) { console.warn(e); }
});

function showHomeScreen() {
  setSpace('galeria', 'home');
  setBreadcrumb([{ label: 'Galeria' }]);
  showHome();
}

function showProjectScreen(id) {
  setSpace('galeria', 'project');
  setBreadcrumb([
    { label: 'Galeria', action: () => navigateHome() },
    { label: 'Projeto' },
  ]);
  showProject(id);
}

function showAtelieScreen() {
  setSpace('atelie', 'atelie');
  setBreadcrumb([
    { label: 'Ateliê' },
    { label: 'Vídeos' },
  ]);
  showAtelieVideos();
}

function showGenerateScreen() {
  setSpace('atelie', 'atelie-generate');
  setBreadcrumb([
    { label: 'Ateliê', action: () => navigateAtelie() },
    { label: 'Vídeos', action: () => navigateAtelie('videos') },
    { label: 'Gerar' },
  ]);
  showAtelieGenerate();
}

function showTextVideoScreen() {
  setSpace('atelie', 'atelie-text2video');
  setBreadcrumb([
    { label: 'Ateliê', action: () => navigateAtelie() },
    { label: 'Vídeos', action: () => navigateAtelie('videos') },
    { label: 'Texto → Vídeo' },
  ]);
  showAtelieTextVideo();
}

function showEditorScreen(id) {
  setSpace('atelie', 'editor');
  setBreadcrumb([
    { label: 'Ateliê', action: () => navigateAtelie() },
    { label: 'Vídeos', action: () => navigateAtelie('videos') },
    { label: 'Editor' },
  ]);
  openEditor(id);
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
  if (u.userPicture) {
    $userAvatar.src = u.userPicture;
    $userAvatar.style.display = '';
    $userAvatarLetter.style.display = 'none';
  } else {
    $userAvatarLetter.textContent = (u.userEmail || u.userId || '?')[0].toUpperCase();
  }
  $userEmail.textContent = u.userEmail || u.userId;

  document.body.classList.remove('app-loading');

  // boot do editor (só DOM/listeners; não carrega vídeo até openEditor)
  initEditor();

  // chrome com handler de troca de espaço
  bindChrome({
    onSwitchSpace: (target) => {
      if (target === 'galeria') navigateHome();
      else navigateAtelie('videos');
    },
  });

  bindRouter({
    onHome: showHomeScreen,
    onProject: showProjectScreen,
    onAtelie: showAtelieScreen,
    onGenerate: showGenerateScreen,
    onTextVideo: showTextVideoScreen,
    onEditor: showEditorScreen,
  });
  startRouter();
})();
