// Bootstrap do protótipo.
import { on, start, go } from './router.js';
import * as Home from './views/home.js';
import * as Project from './views/project.js';
import * as Workbench from './views/workbench.js';
import * as Editor from './views/editor.js';
import { store } from './store.js';

// Header global — usuário (decorativo)
function paintChrome() {
  const u = store.user();
  const userPill = document.querySelector('#user-pill');
  if (userPill) userPill.textContent = u.email;
}

// Banner protótipo (sempre visível, no topo do app)
function paintBanner() {
  if (document.querySelector('.proto-banner')) return;
  const b = document.createElement('div');
  b.className = 'proto-banner';
  b.innerHTML = `
    <span class="proto-dot"></span>
    <span>MODO PROTÓTIPO</span>
    <span class="proto-sep">·</span>
    <span>sem chamadas reais à IA, dados em localStorage</span>
  `;
  document.body.prepend(b);
}

// Menu workbench dropdown — abrir via click no botão
function setupWorkbenchMenu() {
  const btn = document.querySelector('#wb-menu-btn');
  const menu = document.querySelector('#wb-menu');
  if (!btn || !menu) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== btn) menu.classList.remove('open');
  });
}

// Rotas
on('/',                Home.render);
on('/p/:id',           Project.render);
on('/wb/videos',       Workbench.renderVideos);
on('/wb/characters',   Workbench.renderCharacters);
on('/wb/framings',     Workbench.renderFramings);
on('/wb/cameras',      Workbench.renderCameras);
on('/v/:id',           Editor.render);

paintBanner();
paintChrome();
setupWorkbenchMenu();
start();
