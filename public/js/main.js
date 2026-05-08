// Bootstrap. Auth (token) → router → screens.

import { initAuth, clearToken, getToken, setTokenAndValidate } from './auth.js';
import { showToast, openModal } from './modals.js';
import { bindRouter, startRouter, navigateHome, navigateAtelie, navigateTrash, navigateFeHome } from './router.js';
import { bindChrome, setSpace, setBreadcrumb } from './chrome.js';
import { showHome } from './gal_home.js';
import { showProject } from './gal_project.js';
import { showTrash } from './gal_trash.js';
import { showAtelieVideos } from './atelie_videos.js';
import { showAtelieGenerate } from './atelie_generate.js';
import { showAtelieTextVideo } from './atelie_text2video.js';
import { initEditor, openEditor } from './editor.js';
import { showFeHome } from './fe_home.js';
import { showFeEditor } from './fe_editor.js';
import { initNotifTray } from './notif_tray.js';

const $loginErr = document.getElementById('login-err');
const $btnSignin = document.getElementById('btn-signin');
const $loginInput = document.getElementById('login-token-input');
const $loginLoading = document.getElementById('login-loading');
const $loginActions = document.getElementById('login-actions');

function showLoginActions(errMsg) {
  if ($loginLoading) $loginLoading.style.display = 'none';
  if ($loginActions) $loginActions.style.display = 'flex';
  if (errMsg && $loginErr) $loginErr.textContent = errMsg;
  setTimeout(() => $loginInput?.focus(), 50);
}

async function tryEnter() {
  const v = $loginInput?.value?.trim();
  if (!v) {
    if ($loginErr) $loginErr.textContent = 'cole o token primeiro';
    return;
  }
  if ($loginErr) $loginErr.textContent = '';
  $btnSignin.disabled = true;
  $btnSignin.textContent = 'validando…';
  try {
    const r = await setTokenAndValidate(v);
    if (!r.ok) {
      if ($loginErr) $loginErr.textContent = r.error;
      $btnSignin.disabled = false;
      $btnSignin.textContent = '▸ entrar';
      return;
    }
    window.location.reload();
  } catch (e) {
    if ($loginErr) $loginErr.textContent = 'falha de rede — tente de novo';
    $btnSignin.disabled = false;
    $btnSignin.textContent = '▸ entrar';
  }
}

$btnSignin.addEventListener('click', tryEnter);
$loginInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryEnter();
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

// Versão em produção: lê /version.json (arquivo estático servido pelo
// express.static). Cada commit que vai pra prod atualiza esse arquivo.
// Header mostra só `v0.0.4`; clicar abre modal com label/data/sha.
let versionInfo = null;
(async () => {
  try {
    const r = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    versionInfo = await r.json();
    const $v = document.querySelector('[data-bind="brand-version"]');
    if (!$v) return;
    const tag = versionInfo.version ? `v${versionInfo.version}` : (versionInfo.sha ? String(versionInfo.sha).slice(0, 7) : '');
    if (!tag) return;
    $v.textContent = tag;
    $v.removeAttribute('hidden');
  } catch (e) {
    // silencioso — versão é cosmética
  }
})();

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="open-version-info"]')) return;
  if (!versionInfo) return;
  openModal('version-info', {
    onOpen: (m) => {
      const set = (key, val) => {
        const $el = m.querySelector(`[data-bind="version-info-${key}"]`);
        if ($el) $el.textContent = val || '—';
      };
      set('version', versionInfo.version ? `v${versionInfo.version}` : '—');
      set('date', versionInfo.date || '—');
      set('sha', versionInfo.sha || '—');
      set('label', versionInfo.label || '—');
    },
  });
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

function showFeHomeScreen() {
  setSpace('frame-editor', 'fe-home');
  setBreadcrumb([{ label: 'Frames Editor' }, { label: 'Tirinhas' }]);
  showFeHome();
}

function showFeEditorScreen(id) {
  setSpace('frame-editor', 'fe-editor');
  setBreadcrumb([
    { label: 'Frames Editor', action: () => navigateFeHome() },
    { label: 'Tirinhas', action: () => navigateFeHome() },
    { label: 'Editor' },
  ]);
  showFeEditor(id);
}

(async () => {
  let result;
  try {
    result = await initAuth();
  } catch (e) {
    document.body.classList.remove('app-loading');
    document.body.classList.add('app-unauth');
    showLoginActions('falha ao verificar auth: ' + (e?.message || 'erro de rede'));
    return;
  }

  if (!result.authenticated) {
    document.body.classList.remove('app-loading');
    document.body.classList.add('app-unauth');
    showLoginActions(result.error || 'cole o token pra entrar');
    return;
  }

  document.body.classList.remove('app-loading');

  initEditor();
  initNotifTray();

  bindChrome({
    onSwitchSpace: (target) => {
      if (target === 'galeria') navigateHome();
      else if (target === 'atelie') navigateAtelie('videos');
      else if (target === 'frame-editor') navigateFeHome();
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
    onFeHome: showFeHomeScreen,
    onFeEditor: showFeEditorScreen,
  });
  startRouter();
})();
