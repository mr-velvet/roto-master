// Bootstrap. Auth (token) → router → screens.

import { initAuth, clearToken, getToken } from './auth.js';
import { showToast } from './modals.js';
import { bindRouter, startRouter, navigateHome, navigateAtelie, navigateTrash } from './router.js';
import { bindChrome, setSpace, setBreadcrumb } from './chrome.js';
import { showHome } from './gal_home.js';
import { showProject } from './gal_project.js';
import { showTrash } from './gal_trash.js';
import { showAtelieVideos } from './atelie_videos.js';
import { showAtelieGenerate } from './atelie_generate.js';
import { showAtelieTextVideo } from './atelie_text2video.js';
import { initEditor, openEditor } from './editor.js';

const $loginErr = document.getElementById('login-err');
const $btnSignin = document.getElementById('btn-signin');

// Botão "colar token" — limpa token salvo e recarrega pra reabrir prompt.
$btnSignin.addEventListener('click', () => {
  clearToken();
  window.location.reload();
});

// Botão de copiar token (header global). Útil pra compartilhar o token
// com alguém do time sem ter que abrir devtools.
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="copy-token"]')) return;
  const t = getToken();
  if (!t || t === 'dev-bypass') {
    showToast('em dev local não tem token (bypass ativo)');
    return;
  }
  try {
    await navigator.clipboard.writeText(t);
    showToast('token copiado');
  } catch (err) {
    showToast('falha ao copiar: ' + err.message);
  }
});

// Botão de lixeira (header global).
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="goto-trash"]')) return;
  navigateTrash();
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

function showTrashScreen() {
  setSpace('galeria', 'trash');
  setBreadcrumb([
    { label: 'Galeria', action: () => navigateHome() },
    { label: 'Lixeira' },
  ]);
  showTrash();
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

  document.body.classList.remove('app-loading');

  initEditor();

  bindChrome({
    onSwitchSpace: (target) => {
      if (target === 'galeria') navigateHome();
      else navigateAtelie('videos');
    },
  });

  bindRouter({
    onHome: showHomeScreen,
    onProject: showProjectScreen,
    onTrash: showTrashScreen,
    onAtelie: showAtelieScreen,
    onGenerate: showGenerateScreen,
    onTextVideo: showTextVideoScreen,
    onEditor: showEditorScreen,
  });
  startRouter();
})();
