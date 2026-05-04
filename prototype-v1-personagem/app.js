// ============================================================================
// roto-master · módulo Personagem · protótipo navegável
// ----------------------------------------------------------------------------
// Tudo em memória. Sem backend. Sem chamadas reais.
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// ----------------------------------------------------------------------------
// PLACEHOLDER IMAGE GENERATION
// Em vez de depender de URLs externas, vamos pintar SVGs procedurais.
// Cada nó vira um data: URL único e estável (cor derivada do id).
// ----------------------------------------------------------------------------

const PALETTES = [
  ['#1a1410', '#3a2010', '#7a3510', '#d97a3a', '#e8e3d8'],
  ['#0e1410', '#1c2a1c', '#3d4d3a', '#6b8e5a', '#c9d4b5'],
  ['#161018', '#2d1f33', '#4f3a55', '#8a6f95', '#d4c5dc'],
  ['#100e14', '#1f1d2c', '#3a364f', '#6b6585', '#bdb6cf'],
  ['#180e0e', '#2d1818', '#5a2a2a', '#b54848', '#e8c8c8'],
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// generates an SVG figure that LOOKS like a character portrait — abstract
function makeCharThumb(seed, label, kind = 'appearance') {
  const h = hashStr(seed);
  const palette = PALETTES[h % PALETTES.length];
  const bg = palette[0];
  const mid = palette[2];
  const accent = palette[3];
  const skin = palette[4];

  // body proportions vary slightly by hash
  const headY = 95 + (h % 10);
  const bodyW = 80 + ((h >> 4) % 30);
  const headR = 32 + ((h >> 8) % 6);
  const armSpread = 0.3 + (((h >> 12) % 100) / 100) * 0.4;

  // background — moody radial
  const w = 320, hh = 400;

  // accent shapes — vary by kind
  let accentShapes = '';
  if (kind === 'framing') {
    // camera/perspective hint: corner brackets
    accentShapes = `
      <path d="M 20 20 L 20 50 M 20 20 L 50 20" stroke="${accent}" stroke-width="1" fill="none" opacity="0.6"/>
      <path d="M 300 20 L 300 50 M 300 20 L 270 20" stroke="${accent}" stroke-width="1" fill="none" opacity="0.6"/>
      <path d="M 20 380 L 20 350 M 20 380 L 50 380" stroke="${accent}" stroke-width="1" fill="none" opacity="0.6"/>
      <path d="M 300 380 L 300 350 M 300 380 L 270 380" stroke="${accent}" stroke-width="1" fill="none" opacity="0.6"/>
    `;
  } else if (kind === 'movement') {
    // motion lines
    accentShapes = `
      <path d="M 40 ${hh/2} Q 80 ${hh/2 - 20}, 120 ${hh/2}" stroke="${accent}" stroke-width="1" fill="none" opacity="0.4"/>
      <path d="M 200 ${hh/2 + 30} Q 240 ${hh/2 + 10}, 280 ${hh/2 + 30}" stroke="${accent}" stroke-width="1" fill="none" opacity="0.4"/>
    `;
  }

  // a stylized hooded silhouette
  const cx = w / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hh}" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="g${h}" cx="50%" cy="40%" r="70%">
        <stop offset="0%" stop-color="${mid}" stop-opacity="0.9"/>
        <stop offset="60%" stop-color="${bg}" stop-opacity="1"/>
        <stop offset="100%" stop-color="#050506" stop-opacity="1"/>
      </radialGradient>
      <linearGradient id="ga${h}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
      </linearGradient>
      <pattern id="grain${h}" width="3" height="3" patternUnits="userSpaceOnUse">
        <rect width="3" height="3" fill="${bg}"/>
        <circle cx="1" cy="1" r="0.4" fill="${skin}" opacity="0.04"/>
      </pattern>
    </defs>
    <rect width="${w}" height="${hh}" fill="url(#g${h})"/>
    <rect width="${w}" height="${hh}" fill="url(#grain${h})"/>
    <rect width="${w}" height="${hh}" fill="url(#ga${h})"/>

    <!-- ground hint -->
    <ellipse cx="${cx}" cy="${hh - 30}" rx="${bodyW}" ry="6" fill="${bg}" opacity="0.6"/>

    <!-- cape behind -->
    <path d="M ${cx - bodyW * 0.55} ${headY + headR + 10} Q ${cx - bodyW * 0.8} ${hh - 60}, ${cx - bodyW * 0.4} ${hh - 30}
              L ${cx + bodyW * 0.4} ${hh - 30} Q ${cx + bodyW * 0.8} ${hh - 60}, ${cx + bodyW * 0.55} ${headY + headR + 10} Z"
          fill="${mid}" opacity="0.85"/>

    <!-- body torso trapezoid -->
    <path d="M ${cx - bodyW * 0.35} ${headY + headR + 5}
             L ${cx + bodyW * 0.35} ${headY + headR + 5}
             L ${cx + bodyW * 0.45} ${hh - 50}
             L ${cx - bodyW * 0.45} ${hh - 50} Z"
          fill="${palette[1]}"/>

    <!-- shoulders / pauldrons -->
    <ellipse cx="${cx - bodyW * 0.42}" cy="${headY + headR + 18}" rx="18" ry="14" fill="${mid}"/>
    <ellipse cx="${cx + bodyW * 0.42}" cy="${headY + headR + 18}" rx="18" ry="14" fill="${mid}"/>

    <!-- arms -->
    <path d="M ${cx - bodyW * 0.45} ${headY + headR + 28}
             Q ${cx - bodyW * (0.45 + armSpread)} ${headY + 100},
               ${cx - bodyW * (0.30 + armSpread * 0.5)} ${headY + 160}"
          stroke="${palette[1]}" stroke-width="14" stroke-linecap="round" fill="none"/>
    <path d="M ${cx + bodyW * 0.45} ${headY + headR + 28}
             Q ${cx + bodyW * (0.45 + armSpread)} ${headY + 100},
               ${cx + bodyW * (0.30 + armSpread * 0.5)} ${headY + 160}"
          stroke="${palette[1]}" stroke-width="14" stroke-linecap="round" fill="none"/>

    <!-- head + hood -->
    <circle cx="${cx}" cy="${headY}" r="${headR + 8}" fill="${mid}"/>
    <circle cx="${cx}" cy="${headY + 4}" r="${headR}" fill="${skin}" opacity="0.95"/>

    <!-- eye slit / shadow -->
    <ellipse cx="${cx}" cy="${headY + 4}" rx="${headR * 0.85}" ry="${headR * 0.95}" fill="${bg}" opacity="0.75"/>
    <rect x="${cx - 14}" y="${headY - 2}" width="28" height="3" fill="${accent}" opacity="0.85"/>

    <!-- collar accent -->
    <path d="M ${cx - bodyW * 0.32} ${headY + headR + 5}
             L ${cx + bodyW * 0.32} ${headY + headR + 5}
             L ${cx + bodyW * 0.20} ${headY + headR + 18}
             L ${cx - bodyW * 0.20} ${headY + headR + 18} Z"
          fill="${accent}" opacity="0.4"/>

    ${accentShapes}

    <!-- registration marks (corners) — adds tool/atelier feel -->
    <g stroke="${skin}" stroke-width="0.5" opacity="0.2">
      <path d="M ${w-12} ${hh-12} h 8 m -4 -4 v 8" fill="none"/>
    </g>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

// fake video thumbnail — adds a play glyph + animated "frames" hint as static
function makeMovementThumb(seed, label) {
  const base = makeCharThumb(seed, label, 'movement');
  return base; // we'll overlay the play glyph in CSS
}

// ----------------------------------------------------------------------------
// CAMERA PRESETS — each defines target position + look-at + FOV
// Coordinates assume Mixamo character ~180cm tall, root at origin, head at ~170cm
// ----------------------------------------------------------------------------

const CAMERA_PRESETS = {
  'top-down':  { pos: [0, 380, 0.1],     target: [0, 80, 0],   fov: 50, label: 'TOP-DOWN' },
  'iso':       { pos: [200, 220, 200],   target: [0, 90, 0],   fov: 35, label: 'ISOMÉTRICO' },
  'side':      { pos: [320, 100, 0],     target: [0, 100, 0],  fov: 40, label: 'SIDE-SCROLLER' },
  'third':     { pos: [-60, 200, -180],  target: [0, 150, 60], fov: 50, label: '3ª PESSOA' },
  'first':     { pos: [0, 165, -10],     target: [0, 165, 200], fov: 75, label: '1ª PESSOA' },
  'frontal':   { pos: [0, 150, 280],     target: [0, 100, 0],  fov: 32, label: 'FRONTAL' },
  'back':      { pos: [0, 150, -280],    target: [0, 100, 0],  fov: 32, label: 'COSTAS' },
  'hero':      { pos: [80, 30, 200],     target: [0, 140, 0],  fov: 55, label: 'LOW-ANGLE HERÓI' },
  'plonge':    { pos: [60, 320, 180],    target: [0, 60, 0],   fov: 45, label: 'PLONGÉ DRAMÁTICO' },
};

// ----------------------------------------------------------------------------
// STATE — all in memory, mutated through actions
// ----------------------------------------------------------------------------

let nodeId = 0;
const nextId = () => `n${++nodeId}`;

const state = {
  characters: [],
  selectedCharId: null,
  selectedTab: 'appearance',
  // selected nodes per character per stage (for filtering downstream)
  selection: {}, // { [charId]: { appearance: nodeId, framing: nodeId } }
  showDiscarded: false,
  // current generation context
  generationCtx: null,
};

// seed data ---------------------------------------------------------------
function seedData() {
  const knight = {
    id: 'c1',
    num: '001',
    name: 'Cavaleiro Órfico',
    appearances: [],
    framings: [],
    movements: [],
  };
  const a1 = { id: nextId(), version: 'v1', name: 'aparência', favorite: true, discarded: false, date: '02 mai', kind: 'appearance', thumb: makeCharThumb('knight-a1', 'a1') };
  const a2 = { id: nextId(), version: 'v2', name: 'aparência', favorite: false, discarded: false, date: '02 mai', kind: 'appearance', thumb: makeCharThumb('knight-a2', 'a2') };
  const a3 = { id: nextId(), version: 'v3', name: 'aparência', favorite: false, discarded: false, date: '02 mai', kind: 'appearance', thumb: makeCharThumb('knight-a3', 'a3') };
  knight.appearances.push(a1, a2, a3);

  const f1 = { id: nextId(), version: 'v1', name: 'lateral', parentId: a1.id, favorite: true, discarded: false, date: '02 mai', kind: 'framing', thumb: makeCharThumb('knight-f1', 'f1', 'framing'), preset: 'side' };
  const f2 = { id: nextId(), version: 'v1', name: '3/4 frente', parentId: a1.id, favorite: false, discarded: false, date: '02 mai', kind: 'framing', thumb: makeCharThumb('knight-f2', 'f2', 'framing'), preset: 'iso' };
  knight.framings.push(f1, f2);

  const m1 = { id: nextId(), version: 'v1', name: 'andando', parentId: f1.id, favorite: true, discarded: false, date: '02 mai', kind: 'movement', thumb: makeMovementThumb('knight-m1', 'm1'), duration: 5 };
  const m2 = { id: nextId(), version: 'v1', name: 'soco', parentId: f1.id, favorite: false, discarded: false, date: '02 mai', kind: 'movement', thumb: makeMovementThumb('knight-m2', 'm2'), duration: 5 };
  knight.movements.push(m1, m2);

  const witch = {
    id: 'c2',
    num: '002',
    name: 'Bruxa Cinza',
    appearances: [],
    framings: [],
    movements: [],
  };

  state.characters.push(knight, witch);
  // seed selections — knight has aparência v1 selected, framing lateral v1 selected
  state.selection[knight.id] = { appearance: a1.id, framing: f1.id };
  state.selection[witch.id] = {};
}

seedData();

// ----------------------------------------------------------------------------
// DOM HELPERS
// ----------------------------------------------------------------------------
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function on(el, ev, cb) { el && el.addEventListener(ev, cb); return el; }

// ----------------------------------------------------------------------------
// NAVIGATION
// ----------------------------------------------------------------------------

function navigate(screen, charId = null) {
  document.body.classList.remove('screen-home', 'screen-character');
  document.body.classList.add(`screen-${screen}`);
  if (charId) state.selectedCharId = charId;
  if (screen === 'home') renderHome();
  if (screen === 'character') renderCharacter();
  updateBreadcrumb();
}

function updateBreadcrumb() {
  const bc = $('#breadcrumb');
  if (!bc) return;
  if (document.body.classList.contains('screen-character')) {
    const c = currentCharacter();
    bc.innerHTML = `
      <span>arquivo</span>
      <span class="crumb-sep">›</span>
      <span>personagens</span>
      <span class="crumb-sep">›</span>
      <span class="crumb-active">${c?.name ?? '—'}</span>`;
  } else {
    bc.innerHTML = `<span>arquivo</span><span class="crumb-sep">›</span><span class="crumb-active">personagens</span>`;
  }
}

function currentCharacter() {
  return state.characters.find(c => c.id === state.selectedCharId);
}

// ----------------------------------------------------------------------------
// RENDER: HOME
// ----------------------------------------------------------------------------

function renderHome() {
  const grid = $('#char-grid');
  grid.innerHTML = '';
  state.characters.forEach(c => {
    const fav = c.appearances.find(a => a.favorite) || c.appearances[0];
    const movCount = c.movements.filter(m => m.favorite).length;
    const card = document.createElement('div');
    card.className = 'char-card';
    card.innerHTML = `
      <div class="char-card-num">${c.num}</div>
      <div class="char-thumb">
        ${fav ? `<img src="${fav.thumb}" alt="${c.name}">` : `
          <div class="char-thumb-empty">
            <div class="empty-glyph">?</div>
            <div class="empty-text">sem aparência</div>
          </div>`}
      </div>
      <div class="char-card-body">
        <div class="char-card-name">${c.name}</div>
        <div class="char-card-meta">
          <span><b>${c.appearances.length}</b> aparências</span>
          <span class="dot">·</span>
          <span><b>${movCount}</b> movimento${movCount === 1 ? '' : 's'} aprovado${movCount === 1 ? '' : 's'}</span>
        </div>
      </div>
    `;
    on(card, 'click', () => navigate('character', c.id));
    grid.appendChild(card);
  });

  // "+ new" card
  const newCard = document.createElement('div');
  newCard.className = 'char-card-new';
  newCard.innerHTML = `
    <div class="new-content">
      <div class="new-glyph">+</div>
      <div class="new-text">novo personagem</div>
    </div>
  `;
  on(newCard, 'click', createNewCharacter);
  grid.appendChild(newCard);
}

function createNewCharacter() {
  const num = String(state.characters.length + 1).padStart(3, '0');
  const c = {
    id: 'c' + (state.characters.length + 1) + '_' + Date.now(),
    num,
    name: 'Personagem sem nome',
    appearances: [],
    framings: [],
    movements: [],
  };
  state.characters.push(c);
  state.selection[c.id] = {};
  navigate('character', c.id);
  // start in rename mode
  setTimeout(() => startRename(), 60);
}

on($('#btn-new-char'), 'click', createNewCharacter);
on($('.back-btn'), 'click', () => navigate('home'));

// ----------------------------------------------------------------------------
// RENDER: CHARACTER WORKSPACE
// ----------------------------------------------------------------------------

function renderCharacter() {
  const c = currentCharacter();
  if (!c) return;

  $('#char-num').textContent = c.num;
  $('#char-name').textContent = c.name;

  const apps = c.appearances.filter(n => state.showDiscarded || !n.discarded);
  const selectedApp = c.appearances.find(a => a.id === state.selection[c.id]?.appearance);
  const selectedFram = c.framings.find(f => f.id === state.selection[c.id]?.framing);

  const framsAll = c.framings.filter(f => !selectedApp || f.parentId === selectedApp.id);
  const movs = c.movements.filter(m => !selectedFram || m.parentId === selectedFram.id);

  $('#tab-count-appearance').textContent = c.appearances.filter(n => !n.discarded).length;
  $('#tab-count-framing').textContent = framsAll.filter(n => !n.discarded).length;
  $('#tab-count-movement').textContent = movs.filter(n => !n.discarded).length;

  // stats
  const apprCount = c.appearances.filter(n => !n.discarded).length;
  const movApproved = c.movements.filter(m => m.favorite).length;
  $('#char-stats').innerHTML = `
    <div class="stat">
      <span class="stat-key">aparências</span>
      <span class="stat-val">${apprCount}<span class="stat-mark">${c.appearances.find(a => a.favorite) ? '★' : ''}</span></span>
    </div>
    <div class="stat">
      <span class="stat-key">enquadramentos</span>
      <span class="stat-val">${c.framings.filter(n => !n.discarded).length}</span>
    </div>
    <div class="stat">
      <span class="stat-key">movimentos aprovados</span>
      <span class="stat-val">${movApproved}</span>
    </div>
  `;

  renderAppearancePanel(c);
  renderFramingPanel(c, selectedApp);
  renderMovementPanel(c, selectedFram);

  switchTab(state.selectedTab);
}

function renderAppearancePanel(c) {
  const grid = $('[data-grid="appearance"]');
  const panel = $('[data-panel="appearance"]');
  grid.innerHTML = '';
  const items = c.appearances.filter(n => state.showDiscarded || !n.discarded);
  panel.classList.toggle('is-empty', items.length === 0);
  items.forEach(n => grid.appendChild(makeNodeCard(n, c, 'appearance')));
}

function renderFramingPanel(c, selectedApp) {
  const grid = $('[data-grid="framing"]');
  const panel = $('[data-panel="framing"]');
  grid.innerHTML = '';

  // pill: shows current source
  if (selectedApp) {
    $('#framing-source-thumb').style.backgroundImage = `url(${selectedApp.thumb})`;
    $('#framing-source-name').textContent = `${selectedApp.name} ${selectedApp.version}`;
  } else {
    $('#framing-source-thumb').style.backgroundImage = '';
    $('#framing-source-name').textContent = 'nenhuma aparência';
  }

  const items = c.framings
    .filter(f => !selectedApp || f.parentId === selectedApp.id)
    .filter(n => state.showDiscarded || !n.discarded);

  if (!selectedApp || c.appearances.length === 0) {
    panel.classList.add('is-empty');
    return;
  }
  panel.classList.toggle('is-empty', items.length === 0);
  items.forEach(n => grid.appendChild(makeNodeCard(n, c, 'framing')));
}

function renderMovementPanel(c, selectedFram) {
  const grid = $('[data-grid="movement"]');
  const panel = $('[data-panel="movement"]');
  grid.innerHTML = '';

  if (selectedFram) {
    $('#movement-source-thumb').style.backgroundImage = `url(${selectedFram.thumb})`;
    $('#movement-source-name').textContent = `${selectedFram.name} ${selectedFram.version}`;
  } else {
    $('#movement-source-thumb').style.backgroundImage = '';
    $('#movement-source-name').textContent = 'nenhum enquadramento';
  }

  const items = c.movements
    .filter(m => !selectedFram || m.parentId === selectedFram.id)
    .filter(n => state.showDiscarded || !n.discarded);

  if (!selectedFram || c.framings.length === 0) {
    panel.classList.add('is-empty');
    return;
  }
  panel.classList.toggle('is-empty', items.length === 0);
  items.forEach(n => grid.appendChild(makeNodeCard(n, c, 'movement')));
}

function makeNodeCard(n, character, kind) {
  const card = document.createElement('div');
  const isSel =
    (kind === 'appearance' && state.selection[character.id]?.appearance === n.id) ||
    (kind === 'framing' && state.selection[character.id]?.framing === n.id);

  card.className = `node ${isSel ? 'selected' : ''} ${n.discarded ? 'discarded' : ''}`;
  const isMov = kind === 'movement';

  card.innerHTML = `
    <div class="node-thumb">
      <img src="${n.thumb}" alt="${n.name} ${n.version}">
      ${isMov ? '<div class="play-glyph">▶</div>' : ''}
      <button class="fav-star ${n.favorite ? 'active' : ''}" title="favorito">★</button>
    </div>
    <div class="node-body">
      <div class="node-row">
        <div class="node-name">${n.name}</div>
        <div class="node-version">${n.version}</div>
      </div>
      <div class="node-meta">
        <span class="meta-date">${n.date}</span>
        <span>${isMov ? n.duration + 's' : kind}</span>
      </div>
      <div class="node-actions">
        ${kind === 'appearance' ? '<button class="node-act primary" data-act="select">selecionar</button>' : ''}
        ${kind === 'framing' ? '<button class="node-act primary" data-act="select">selecionar</button>' : ''}
        ${kind === 'movement' ? '<button class="node-act primary" data-act="rotoscope">▸ rotoscopar</button>' : ''}
        <button class="node-act" data-act="fav">${n.favorite ? '★ favorita' : '☆ favoritar'}</button>
        <button class="node-act danger" data-act="discard">descartar</button>
      </div>
    </div>
  `;

  // click on card body selects (for appearance/framing tabs, drives downstream tabs)
  on(card, 'click', e => {
    if (e.target.closest('.node-act') || e.target.closest('.fav-star')) return;
    if (kind === 'appearance') {
      state.selection[character.id] = { ...state.selection[character.id], appearance: n.id, framing: null };
    } else if (kind === 'framing') {
      state.selection[character.id] = { ...state.selection[character.id], framing: n.id };
    }
    renderCharacter();
  });

  on(card.querySelector('.fav-star'), 'click', e => {
    e.stopPropagation();
    n.favorite = !n.favorite;
    renderCharacter();
  });

  card.querySelectorAll('.node-act').forEach(b => {
    on(b, 'click', e => {
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === 'fav') { n.favorite = !n.favorite; renderCharacter(); }
      else if (act === 'discard') { n.discarded = true; renderCharacter(); toast('descartado', `${n.name} ${n.version} oculto`); }
      else if (act === 'select') {
        if (kind === 'appearance') {
          state.selection[character.id] = { ...state.selection[character.id], appearance: n.id, framing: null };
        } else {
          state.selection[character.id] = { ...state.selection[character.id], framing: n.id };
        }
        switchTab(kind === 'appearance' ? 'framing' : 'movement');
        renderCharacter();
      }
      else if (act === 'rotoscope') { toast('rotoscopia', 'abriria o editor de rotoscopia (não implementado neste protótipo)'); }
    });
  });

  return card;
}

// rename ---
function startRename() {
  const el = $('#char-name');
  el.contentEditable = 'true';
  el.focus();
  // place cursor at end
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
function commitRename() {
  const el = $('#char-name');
  el.contentEditable = 'false';
  const c = currentCharacter();
  if (c) c.name = el.textContent.trim() || c.name;
  renderCharacter();
}
on($('#rename-btn'), 'click', startRename);
on($('#char-name'), 'blur', commitRename);
on($('#char-name'), 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#char-name').blur(); } });

// tab switching ---
function switchTab(name) {
  state.selectedTab = name;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
  // animate rail under the active tab
  const active = $(`.tab[data-tab="${name}"]`);
  if (active) {
    const tabsBox = $('#tabs').getBoundingClientRect();
    const r = active.getBoundingClientRect();
    const fill = $('#tab-rail-fill');
    fill.style.left = (r.left - tabsBox.left) + 'px';
    fill.style.width = r.width + 'px';
  }
}
$$('.tab').forEach(t => on(t, 'click', () => switchTab(t.dataset.tab)));

// toggle discarded ---
$$('[data-toggle-discarded]').forEach(b => on(b, 'click', () => {
  state.showDiscarded = !state.showDiscarded;
  $$('[data-toggle-discarded] span:last-child').forEach(s => {
    s.textContent = state.showDiscarded ? 'ocultar descartadas' : 'mostrar descartadas';
  });
  renderCharacter();
}));

// source picker (clicking the toolbar pill) ---
on($('#framing-source-pill'), 'click', () => openSourcePicker('appearance'));
on($('#movement-source-pill'), 'click', () => openSourcePicker('framing'));

function openSourcePicker(kind) {
  const c = currentCharacter();
  if (!c) return;
  let items;
  if (kind === 'appearance') {
    items = c.appearances;
  } else {
    // framings: filter to children of currently selected appearance
    const selApp = c.appearances.find(a => a.id === state.selection[c.id]?.appearance);
    items = selApp ? c.framings.filter(f => f.parentId === selApp.id) : c.framings;
  }
  $('#source-picker-title').textContent =
    kind === 'appearance' ? 'Trocar aparência base' : 'Trocar enquadramento base';
  const grid = $('#source-picker-grid');
  grid.innerHTML = '';
  items.filter(n => !n.discarded).forEach(n => {
    const card = document.createElement('div');
    const currentSel = state.selection[c.id]?.[kind];
    card.className = `picker-card ${n.id === currentSel ? 'current' : ''}`;
    card.innerHTML = `
      <div class="picker-thumb" style="background-image: url(${n.thumb})"></div>
      <div class="picker-name">${n.name} ${n.version}</div>
    `;
    on(card, 'click', () => {
      if (kind === 'appearance') {
        state.selection[c.id] = { ...state.selection[c.id], appearance: n.id, framing: null };
      } else {
        state.selection[c.id] = { ...state.selection[c.id], framing: n.id };
      }
      closeModal('source-picker');
      renderCharacter();
    });
    grid.appendChild(card);
  });
  openModal('source-picker');
}

// ----------------------------------------------------------------------------
// MODALS — open/close + custom selects
// ----------------------------------------------------------------------------

function openModal(name) {
  const m = document.querySelector(`[data-modal="${name}"]`);
  if (!m) return;
  m.classList.add('open');
}
function closeModal(name) {
  const m = name
    ? document.querySelector(`[data-modal="${name}"]`)
    : document.querySelector('.modal-bg.open');
  if (m) m.classList.remove('open');
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-modal-close]')) {
    e.target.closest('.modal-bg').classList.remove('open');
  }
  if (e.target.classList.contains('modal-bg')) {
    e.target.classList.remove('open');
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-bg.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.select.open').forEach(s => s.classList.remove('open'));
  }
});

// open generation modals ---
$$('[data-gen]').forEach(b => on(b, 'click', () => openGen(b.dataset.gen)));

function openGen(kind) {
  const c = currentCharacter();
  if (!c) return;
  if (kind === 'appearance') {
    openModal('appearance');
  } else if (kind === 'framing') {
    const selApp = c.appearances.find(a => a.id === state.selection[c.id]?.appearance);
    if (!selApp) {
      toast('precisa de aparência', 'gere ou selecione uma aparência primeiro');
      return;
    }
    $('#framing-modal-source').textContent = `${selApp.name} ${selApp.version}`;
    $('#framing-modal-thumb').style.backgroundImage = `url(${selApp.thumb})`;
    $('#framing-ref-thumb').style.backgroundImage = `url(${selApp.thumb})`;
    $('#framing-ref-name').textContent = `${selApp.name} ${selApp.version}`;
    openModal('framing');
    // wait one frame so modal layout settles before measuring canvas
    requestAnimationFrame(() => requestAnimationFrame(initViewport));
  } else if (kind === 'movement') {
    const selFram = c.framings.find(f => f.id === state.selection[c.id]?.framing);
    if (!selFram) {
      toast('precisa de enquadramento', 'gere ou selecione um enquadramento primeiro');
      return;
    }
    $('#movement-modal-source').textContent = `${selFram.name} ${selFram.version}`;
    $('#movement-modal-thumb').style.backgroundImage = `url(${selFram.thumb})`;
    $('#movement-ref-thumb').style.backgroundImage = `url(${selFram.thumb})`;
    $('#movement-ref-name').textContent = `${selFram.name} ${selFram.version}`;
    updateMovementCost();
    openModal('movement');
  }
}

// custom selects ---
function setupSelects() {
  $$('.select').forEach(sel => {
    const btn = sel.querySelector('.select-btn');
    const valEl = sel.querySelector('.select-val');
    on(btn, 'click', e => {
      e.stopPropagation();
      const isOpen = sel.classList.contains('open');
      $$('.select.open').forEach(s => s.classList.remove('open'));
      if (!isOpen) sel.classList.add('open');
    });
    sel.querySelectorAll('li').forEach(li => {
      on(li, 'click', e => {
        e.stopPropagation();
        sel.querySelectorAll('li').forEach(x => x.classList.remove('selected'));
        li.classList.add('selected');
        // For duration selector, show short form ("5s") instead of full label
        if (sel.dataset.select === 'movement-duration') {
          valEl.textContent = li.dataset.val + 's';
        } else {
          valEl.textContent = li.querySelector('span').textContent;
        }
        sel.classList.remove('open');
        sel.dataset.value = li.dataset.val;
        sel.dispatchEvent(new CustomEvent('change', { detail: { value: li.dataset.val } }));
        if (sel.dataset.select === 'movement-model' || sel.dataset.select === 'movement-duration') {
          updateMovementCost();
        }
      });
    });
  });
  document.addEventListener('click', () => {
    $$('.select.open').forEach(s => s.classList.remove('open'));
  });
}
setupSelects();

// segmented controls ---
$$('.seg').forEach(seg => {
  seg.querySelectorAll('button').forEach(b => {
    on(b, 'click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      seg.dataset.value = b.dataset.val;
      // refresh appearance prompt preview
      if (seg.dataset.seg === 'style') {
        const styleMap = {
          'realismo': 'photorealism, sharp detail, natural lighting',
          'semi-realista': 'semi-realista, painterly, mid-detail textures',
          'cartoon': 'stylized cartoon, clean linework, flat shading',
        };
        $('#appearance-style-out').textContent = styleMap[b.dataset.val];
      }
    });
  });
});

// live prompt preview ---
on($('#appearance-prompt'), 'input', e => {
  $('#appearance-user-out').textContent = e.target.value || '—';
});
on($('#movement-prompt'), 'input', e => {
  $('#movement-user-out').textContent = e.target.value || '—';
});

// movement cost recalculation
function updateMovementCost() {
  const modelSel = $('[data-select="movement-model"]');
  const durSel = $('[data-select="movement-duration"]');
  const liModel = modelSel.querySelector('li.selected');
  const liDur = durSel.querySelector('li.selected');
  const cps = parseFloat(liModel?.dataset.costPerS || '0.07');
  const dur = parseInt(liDur?.dataset.val || '5');
  const cost = (cps * dur).toFixed(2);
  $('#movement-cost').textContent = '$' + cost;
  $('#movement-confirm-cost').textContent = '$' + cost;
}

// ----------------------------------------------------------------------------
// GENERATION (simulated)
// ----------------------------------------------------------------------------

$$('[data-gen-confirm]').forEach(b => on(b, 'click', () => generate(b.dataset.genConfirm)));

function generate(kind) {
  const c = currentCharacter();
  if (!c) return;

  if (kind === 'appearance') {
    closeModal('appearance');
    runImageGeneration('aparência · nano-banana-pro', () => {
      const v = 'v' + (c.appearances.length + 1);
      const seed = c.id + '-a' + Date.now();
      const userText = $('#appearance-prompt').value.trim() || 'novo personagem';
      const node = {
        id: nextId(), version: v, name: 'aparência',
        favorite: c.appearances.length === 0, discarded: false,
        date: 'agora', kind: 'appearance', thumb: makeCharThumb(seed, v),
        prompt: userText,
      };
      c.appearances.push(node);
      // auto-select if first
      if (!state.selection[c.id]?.appearance) {
        state.selection[c.id] = { ...state.selection[c.id], appearance: node.id };
      }
      renderCharacter();
      toast('pronto', `aparência ${v} adicionada`);
    });
  }

  if (kind === 'framing') {
    closeModal('framing');
    teardownViewport();
    runImageGeneration('enquadramento · nano-banana-pro', () => {
      const selAppId = state.selection[c.id]?.appearance;
      const cnt = c.framings.filter(f => f.parentId === selAppId).length + 1;
      const v = 'v' + cnt;
      const seed = c.id + '-f' + Date.now();
      const presetEl = $('.preset.active');
      const presetKey = presetEl?.dataset.preset || 'side';
      const presetLabel = presetEl?.querySelector('span:last-child')?.textContent.toLowerCase() || 'lateral';
      const node = {
        id: nextId(), version: v, name: presetLabel,
        parentId: selAppId, favorite: cnt === 1, discarded: false,
        date: 'agora', kind: 'framing', thumb: makeCharThumb(seed, v, 'framing'),
        preset: presetKey,
      };
      c.framings.push(node);
      if (!state.selection[c.id]?.framing) {
        state.selection[c.id] = { ...state.selection[c.id], framing: node.id };
      }
      renderCharacter();
      toast('pronto', `enquadramento ${presetLabel} ${v}`);
    });
  }

  if (kind === 'movement') {
    closeModal('movement');
    const selFramId = state.selection[c.id]?.framing;
    const cnt = c.movements.filter(m => m.parentId === selFramId).length + 1;
    const v = 'v' + cnt;
    const userText = $('#movement-prompt').value.trim() || 'ação';
    const shortName = userText.split(/[\s,]+/).slice(0, 2).join(' ').toLowerCase() || 'ação';
    const dur = parseInt($('[data-select="movement-duration"] li.selected')?.dataset.val || '5');
    // create the placeholder card immediately with "gerando..." state
    const seed = c.id + '-m' + Date.now();
    const placeholder = {
      id: nextId(), version: v, name: shortName,
      parentId: selFramId, favorite: false, discarded: false,
      date: 'agora', kind: 'movement', duration: dur,
      thumb: makeMovementThumb(seed, v),
      generating: true,
    };
    c.movements.push(placeholder);
    renderCharacter();
    toast('na fila', `${shortName} ${v} · ~60s`);

    // simulate completion after 3s
    setTimeout(() => {
      placeholder.generating = false;
      renderCharacter();
      toast('pronto', `movimento "${shortName} ${v}" disponível`);
    }, 3000);
  }
}

// "generating" badge decoration — applied via MutationObserver after renderCharacter rebuilds the grid
function decorateGeneratingBadges() {
  const c = currentCharacter();
  if (!c) return;
  const grid = $('[data-grid="movement"]');
  if (!grid) return;
  c.movements.forEach(m => {
    if (!m.generating) return;
    grid.querySelectorAll('.node').forEach(card => {
      const nm  = card.querySelector('.node-name')?.textContent;
      const ver = card.querySelector('.node-version')?.textContent;
      if (nm === m.name && ver === m.version && !card.querySelector('.badge')) {
        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.innerHTML = `<span class="badge-dot"></span><span>gerando</span>`;
        card.querySelector('.node-thumb').appendChild(badge);
        const img = card.querySelector('img');
        if (img) img.style.filter = 'grayscale(1) brightness(0.5)';
      }
    });
  });
}
const _movGrid = $('[data-grid="movement"]');
if (_movGrid) new MutationObserver(decorateGeneratingBadges).observe(_movGrid, { childList: true });

// ----------------------------------------------------------------------------
// RUN IMAGE GENERATION (simulated, ~2s)
// ----------------------------------------------------------------------------

function runImageGeneration(detail, onDone) {
  $('#gen-image-detail').textContent = detail;
  $('#gen-image-fill').style.width = '0';
  openModal('generating-image');
  const start = performance.now();
  const dur = 2000;
  function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    $('#gen-image-fill').style.width = (t * 100) + '%';
    if (t < 1) requestAnimationFrame(tick);
    else {
      closeModal('generating-image');
      onDone();
    }
  }
  requestAnimationFrame(tick);
}

// ----------------------------------------------------------------------------
// TOAST
// ----------------------------------------------------------------------------

function toast(title, sub) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <span class="toast-glyph">◐</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-sub">${sub}</div>
    </div>
  `;
  $('#toast-stack').appendChild(el);
  setTimeout(() => el.classList.add('fade-out'), 3500);
  setTimeout(() => el.remove(), 3900);
}

// ----------------------------------------------------------------------------
// THREE.JS VIEWPORT (framing modal)
// ----------------------------------------------------------------------------

let viewport = {
  inited: false,
  scene: null, camera: null, renderer: null, controls: null,
  model: null, mixer: null, raf: 0, modelLoaded: false,
  presetTween: null,
};

function initViewport() {
  // Even if already inited, we need to handle resize since the modal just opened.
  if (viewport.inited) {
    // ensure renderer matches new size
    const canvas = $('#viewport-canvas');
    const wrap = canvas.parentElement;
    setTimeout(() => resizeViewport(wrap.clientWidth, wrap.clientHeight), 50);
    if (!viewport.modelLoaded) {
      $('#viewport-loading').classList.remove('hidden');
    }
    applyPreset('side', false);
    return;
  }
  viewport.inited = true;

  const canvas = $('#viewport-canvas');
  const wrap = canvas.parentElement;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050506);
  // very soft fog gives depth
  scene.fog = new THREE.Fog(0x050506, 600, 1400);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
  camera.position.set(320, 100, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 100, 0);
  controls.minDistance = 40;
  controls.maxDistance = 1500;

  // lighting — soft key + fill
  const amb = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(amb);
  const key = new THREE.DirectionalLight(0xffe8d5, 0.8);
  key.position.set(200, 300, 200);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa0c8ff, 0.25);
  fill.position.set(-200, 100, -100);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xd97a3a, 0.35);
  rim.position.set(0, 50, -250);
  scene.add(rim);

  // ground grid — subtle, atelier feel
  const gridSize = 800, gridDivs = 40;
  const grid = new THREE.GridHelper(gridSize, gridDivs, 0x1a1b1e, 0x111114);
  grid.position.y = 0;
  scene.add(grid);

  // floor disk under character (very subtle)
  const floorGeo = new THREE.CircleGeometry(150, 64);
  const floorMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0c, transparent: true, opacity: 0.6 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.5;
  scene.add(floor);

  // origin tick marks (like an atelier reference)
  const axisMat = new THREE.LineBasicMaterial({ color: 0x232428 });
  const axisPts = [];
  axisPts.push(new THREE.Vector3(-30, 0.5, 0), new THREE.Vector3(30, 0.5, 0));
  axisPts.push(new THREE.Vector3(0, 0.5, -30), new THREE.Vector3(0, 0.5, 30));
  const axisGeo = new THREE.BufferGeometry().setFromPoints(axisPts);
  scene.add(new THREE.LineSegments(axisGeo, axisMat));

  // try loading character.fbx
  const loader = new FBXLoader();
  const fbxPath = './assets/character.fbx';
  loader.load(fbxPath, (fbx) => {
    // override materials with neutral gray
    fbx.traverse(obj => {
      if (obj.isMesh) {
        obj.material = new THREE.MeshStandardMaterial({
          color: 0x9c9486,
          roughness: 0.85,
          metalness: 0.05,
          flatShading: false,
        });
        obj.frustumCulled = false;
      }
    });
    // scale & center — Mixamo character is usually ~180 cm tall
    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    fbx.position.x -= center.x;
    fbx.position.z -= center.z;
    fbx.position.y -= box.min.y; // feet on ground
    scene.add(fbx);
    viewport.model = fbx;
    viewport.modelLoaded = true;
    $('#viewport-loading').classList.add('hidden');
    // align controls target on character chest
    controls.target.set(0, size.y * 0.55, 0);
  }, (xhr) => {
    if (xhr.lengthComputable) {
      $('#viewport-loading .loading-text').textContent =
        `carregando humanoide… ${Math.round(xhr.loaded / xhr.total * 100)}%`;
    }
  }, (err) => {
    console.error('FBX load error:', err);
    // fallback: show a placeholder humanoid built from primitives
    buildPlaceholderHumanoid(scene);
    viewport.modelLoaded = true;
    $('#viewport-loading .loading-text').textContent = 'modelo de fallback (FBX não carregou — rode com servidor)';
    setTimeout(() => $('#viewport-loading').classList.add('hidden'), 1500);
  });

  viewport.scene = scene;
  viewport.camera = camera;
  viewport.renderer = renderer;
  viewport.controls = controls;

  // size + render loop
  const ro = new ResizeObserver(() => {
    resizeViewport(wrap.clientWidth, wrap.clientHeight);
  });
  ro.observe(wrap);
  resizeViewport(wrap.clientWidth, wrap.clientHeight);

  function tick() {
    if (!viewport.inited) return;
    viewport.controls.update();
    if (viewport.presetTween) viewport.presetTween();
    viewport.renderer.render(viewport.scene, viewport.camera);
    updateCamReadout();
    viewport.raf = requestAnimationFrame(tick);
  }
  tick();

  // hook up presets
  $$('.preset[data-preset]').forEach(b => {
    on(b, 'click', () => {
      $$('.preset').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      applyPreset(b.dataset.preset, true);
    });
  });

  // FOV slider
  on($('#fov-slider'), 'input', e => {
    const v = parseInt(e.target.value);
    $('#fov-val').textContent = v + '°';
    if (viewport.camera) {
      viewport.camera.fov = v;
      viewport.camera.updateProjectionMatrix();
    }
  });

  // initial preset
  applyPreset('side', false);
}

function buildPlaceholderHumanoid(scene) {
  // simple 5-primitive humanoid as fallback
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9c9486, roughness: 0.85, metalness: 0.05 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(15, 24, 16), mat); head.position.y = 165;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(20, 25, 60, 16), mat); torso.position.y = 110;
  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 60, 12), mat); arm1.position.set(28, 105, 0); arm1.rotation.z = -0.15;
  const arm2 = arm1.clone(); arm2.position.x = -28; arm2.rotation.z = 0.15;
  const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(8, 7, 80, 12), mat); leg1.position.set(10, 40, 0);
  const leg2 = leg1.clone(); leg2.position.x = -10;
  g.add(head, torso, arm1, arm2, leg1, leg2);
  scene.add(g);
}

function resizeViewport(w, h) {
  if (!viewport.renderer) return;
  viewport.renderer.setSize(w, h, false);
  viewport.camera.aspect = w / h;
  viewport.camera.updateProjectionMatrix();
}

function applyPreset(key, animate) {
  const preset = CAMERA_PRESETS[key];
  if (!preset || !viewport.camera) return;

  const corner = $('#active-preset-tag');
  if (corner) corner.textContent = preset.label;

  // sync FOV slider
  $('#fov-slider').value = preset.fov;
  $('#fov-val').textContent = preset.fov + '°';
  viewport.camera.fov = preset.fov;
  viewport.camera.updateProjectionMatrix();

  if (!animate) {
    viewport.camera.position.set(...preset.pos);
    viewport.controls.target.set(...preset.target);
    viewport.controls.update();
    return;
  }

  // animate over ~600ms
  const startPos = viewport.camera.position.clone();
  const startTar = viewport.controls.target.clone();
  const endPos = new THREE.Vector3(...preset.pos);
  const endTar = new THREE.Vector3(...preset.target);
  const t0 = performance.now();
  const dur = 600;
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  viewport.presetTween = () => {
    const t = Math.min(1, (performance.now() - t0) / dur);
    const k = ease(t);
    viewport.camera.position.lerpVectors(startPos, endPos, k);
    viewport.controls.target.lerpVectors(startTar, endTar, k);
    viewport.controls.update();
    if (t >= 1) viewport.presetTween = null;
  };
}

function updateCamReadout() {
  if (!viewport.camera) return;
  const p = viewport.camera.position;
  const t = viewport.controls.target;
  const fmt = v => v.toFixed(0).padStart(4, ' ');
  $('#cam-pos').textContent    = `${fmt(p.x)} · ${fmt(p.y)} · ${fmt(p.z)}`;
  $('#cam-target').textContent = `${fmt(t.x)} · ${fmt(t.y)} · ${fmt(t.z)}`;
}

function teardownViewport() {
  // we keep state.inited true (model already loaded once) — just stop animating until next open
  // actually it's fine to keep ticking; we just won't see it.
}

// ----------------------------------------------------------------------------
// BOOTSTRAP
// ----------------------------------------------------------------------------

// initial style preview
$('#appearance-style-out').textContent = 'semi-realista, painterly, mid-detail textures';

// initial render
navigate('home');

// expose for debugging
window.__state = state;
