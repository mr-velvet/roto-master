// ============================================================================
// roto-master · protótipo navegável v2
// ----------------------------------------------------------------------------
// Single-file vanilla JS. State em localStorage. Sem build.
// Foco do protótipo: validar a metáfora Galeria/Ateliê e a transição entre
// os dois espaços, mostrando que cada tela tem identidade clara de qual
// espaço pertence.
// ============================================================================

const STORAGE_KEY = 'roto-master-proto-v2';

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

const initialState = () => ({
  // navegação
  space: 'galeria',          // 'galeria' | 'atelie'
  screen: 'home',            // 'home' | 'project' | 'atelie' | 'editor'
  atelieSub: 'videos',       // 'videos' | 'personagens' | 'enquadramentos' | 'cameras'
  currentProjectId: null,
  currentVideoId: null,
  assetFilter: 'all',        // 'all' | 'pendente' | 'feito'

  // dados (Galeria)
  projects: [
    {
      id: 'p1',
      name: 'Cavaleiros do Vale',
      created: '2026-04-12',
      description: 'Animações 2D dos NPCs da fase 3.'
    },
    {
      id: 'p2',
      name: 'Boss Rush',
      created: '2026-04-22',
      description: 'Bosses pixel art para cutscenes.'
    },
    {
      id: 'p3',
      name: 'Tutorial Pack',
      created: '2026-05-01',
      description: 'Movimentos básicos para o tutorial.'
    },
  ],

  assets: [
    { id: 'a1', projectId: 'p1', videoId: 'v1', name: 'Cavaleiro Órfico — andando lateral', status: 'feito',     publishedAt: '2026-04-30' },
    { id: 'a2', projectId: 'p1', videoId: 'v2', name: 'Cavaleiro Órfico — soque',           status: 'pendente', publishedAt: '2026-05-02' },
    { id: 'a3', projectId: 'p1', videoId: 'v3', name: 'Bandido — esquiva',                  status: 'feito',     publishedAt: '2026-04-28' },
    { id: 'a4', projectId: 'p2', videoId: 'v4', name: 'Bruxa Cinza — feitiço',              status: 'pendente', publishedAt: '2026-05-03' },
  ],

  // dados (Ateliê — workbench do usuário)
  videos: [
    { id: 'v1', name: 'Cavaleiro Órfico — andando lateral', origin: 'character', duration: '00:05', publishedAssetId: 'a1' },
    { id: 'v2', name: 'Cavaleiro Órfico — soque',           origin: 'character', duration: '00:04', publishedAssetId: 'a2' },
    { id: 'v3', name: 'Bandido — esquiva',                  origin: 'character', duration: '00:03', publishedAssetId: 'a3' },
    { id: 'v4', name: 'Bruxa Cinza — feitiço',              origin: 'character', duration: '00:06', publishedAssetId: 'a4' },
    { id: 'v5', name: 'Referência — corrida real (capt.)',  origin: 'upload',    duration: '00:08', publishedAssetId: null },
    { id: 'v6', name: 'Salto duplo (rascunho)',             origin: 'character', duration: '00:04', publishedAssetId: null },
  ],

  personagens: [
    { id: 'c1', name: 'Cavaleiro Órfico', variations: 3,  usedInVideos: 2 },
    { id: 'c2', name: 'Bruxa Cinza',      variations: 2,  usedInVideos: 1 },
    { id: 'c3', name: 'Bandido Ratão',    variations: 4,  usedInVideos: 1 },
  ],

  enquadramentos: [
    { id: 'e1', name: 'Lateral clássico',     fov: 50, posicao: 'side-scroller', usedInVideos: 3 },
    { id: 'e2', name: 'Low-angle herói',       fov: 35, posicao: 'low-angle',     usedInVideos: 1 },
    { id: 'e3', name: '3/4 frente cinemático', fov: 40, posicao: '3/4-front',     usedInVideos: 2 },
  ],

  cameras: [
    { id: 'cam1', name: 'Câmera inimigo',  fov: 45, dist: 4.2, alt: 1.6 },
    { id: 'cam2', name: 'Boss view',       fov: 28, dist: 6.8, alt: 2.4 },
    { id: 'cam3', name: 'Plongé dramático',fov: 55, dist: 3.0, alt: 4.5 },
  ],
});

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...initialState(), ...parsed };
    }
  } catch (_) {}
  return initialState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

function resetState() {
  state = initialState();
  saveState();
  renderAll();
  toast('dados seed resetados.');
}

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function uid(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 8)}`; }

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

// gera padrão visual procedural pra thumbnails (mock visual)
function patternBg(seed) {
  const hue = (hash(seed) % 30) + 10;       // 10..40 (cobre/âmbar)
  const sat = 18 + (hash(seed + 'b') % 12);
  const lum = 6  + (hash(seed + 'c') % 6);
  const lum2 = lum + 4;
  const ang  = (hash(seed + 'd') % 180);
  return `linear-gradient(${ang}deg, hsl(${hue} ${sat}% ${lum}%), hsl(${hue} ${sat-6}% ${lum2}%))`;
}
function hash(s) {
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// ---------------------------------------------------------------------------
// renderização — por tela
// ---------------------------------------------------------------------------

function renderProjects() {
  const grid = $('[data-bind="project-grid"]');
  if (!grid) return;
  grid.innerHTML = '';

  for (const p of state.projects) {
    const projectAssets = state.assets.filter(a => a.projectId === p.id);
    const previews = projectAssets.slice(0, 4);

    const thumbsEl = el('div', { class: 'project-card-thumbs' });
    if (previews.length === 0) {
      thumbsEl.appendChild(el('div', { class: 'thumb empty' }));
    } else {
      for (let i = 0; i < 4; i++) {
        const a = previews[i];
        if (a) {
          const t = el('div', { class: 'thumb' });
          t.style.background = patternBg(a.id);
          thumbsEl.appendChild(t);
        } else {
          thumbsEl.appendChild(el('div', { class: 'thumb empty' }));
        }
      }
    }

    const card = el('div', { class: 'project-card', 'data-id': p.id }, [
      thumbsEl,
      el('div', { class: 'project-card-name' }, p.name),
      el('div', { class: 'project-card-meta' }, [
        el('span', {}, [el('span', { class: 'meta-num' }, String(projectAssets.length)), ' assets']),
        el('span', {}, [
          el('span', { class: 'meta-num' }, String(projectAssets.filter(a => a.status === 'feito').length)),
          ' feitos'
        ]),
      ])
    ]);
    card.addEventListener('click', () => openProject(p.id));
    grid.appendChild(card);
  }
}

function renderProject() {
  const p = state.projects.find(x => x.id === state.currentProjectId);
  if (!p) return;

  $('[data-bind="project-name"]').textContent = p.name;
  const allAssets = state.assets.filter(a => a.projectId === p.id);
  const feitos = allAssets.filter(a => a.status === 'feito').length;
  const pendentes = allAssets.filter(a => a.status === 'pendente').length;
  $('[data-bind="project-sub"]').textContent =
    `${allAssets.length} assets — ${feitos} feitos, ${pendentes} pendentes. ${p.description || ''}`;

  // filter chips
  $$('[data-bind="asset-filter"] .chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.filter === state.assetFilter);
  });

  const filtered = allAssets.filter(a => state.assetFilter === 'all' || a.status === state.assetFilter);

  const grid = $('[data-bind="asset-grid"]');
  grid.innerHTML = '';

  if (allAssets.length === 0) {
    grid.style.display = 'none';
    $('[data-bind="empty-call"]').style.display = '';
  } else {
    grid.style.display = '';
    $('[data-bind="empty-call"]').style.display = filtered.length === 0 ? '' : 'none';

    for (const a of filtered) {
      const v = state.videos.find(vv => vv.id === a.videoId);
      const card = el('div', { class: 'asset-card', 'data-id': a.id }, [
        (() => {
          const preview = el('div', { class: 'asset-card-preview' });
          preview.style.background = patternBg(a.id);
          preview.appendChild(el('div', { class: 'preview-mark' }, '◆'));
          preview.appendChild(el('div', {
            class: `asset-card-status is-${a.status}`
          }, a.status));
          return preview;
        })(),
        el('div', { class: 'asset-card-body' }, [
          el('div', { class: 'asset-card-name' }, a.name),
          el('div', { class: 'asset-card-meta' }, [
            el('span', {}, `publicado ${a.publishedAt}`),
            el('span', {}, '.aseprite'),
          ]),
          v ? el('div', { class: 'asset-card-source' }, [
            el('span', { class: 'asset-card-source-icon' }, '↳'),
            `vídeo-fonte: ${v.name}`
          ]) : null
        ])
      ]);
      card.addEventListener('click', () => openEditorFromAsset(a.id));
      grid.appendChild(card);
    }
  }
}

function renderAtelie() {
  // contagens nas pílulas da sidebar
  $('[data-bind="count-videos"]').textContent = state.videos.length;
  $('[data-bind="count-personagens"]').textContent = state.personagens.length;
  $('[data-bind="count-enquadramentos"]').textContent = state.enquadramentos.length;
  $('[data-bind="count-cameras"]').textContent = state.cameras.length;

  // sidebar — marcar subseção ativa
  $$('.atelie-nav-item').forEach(item => {
    item.classList.toggle('is-active', item.dataset.sub === state.atelieSub);
  });
  // mostrar a subseção
  $$('.atelie-sub').forEach(s => {
    s.hidden = s.dataset.sub !== state.atelieSub;
  });

  if (state.atelieSub === 'videos') renderVideos();
  if (state.atelieSub === 'personagens') renderPersonagens();
  if (state.atelieSub === 'enquadramentos') renderEnquadramentos();
  if (state.atelieSub === 'cameras') renderCameras();
}

function renderVideos() {
  const grid = $('[data-bind="video-grid"]');
  grid.innerHTML = '';

  for (const v of state.videos) {
    const published = v.publishedAssetId ? state.assets.find(a => a.id === v.publishedAssetId) : null;
    const project = published ? state.projects.find(p => p.id === published.projectId) : null;

    const originLabel = {
      upload: 'upload',
      url: 'url',
      generic: 'genérico',
      character: 'personagem'
    }[v.origin] || v.origin;
    const originIcon = {
      upload: '⬆',
      url: '⌘',
      generic: '◆',
      character: '☻'
    }[v.origin] || '·';

    const thumb = el('div', { class: 'video-card-thumb' });
    const pat = el('div', { class: 'thumb-pattern' });
    pat.style.background = patternBg(v.id);
    thumb.appendChild(pat);
    thumb.appendChild(el('div', { class: 'play-mark' }, '▶'));
    thumb.appendChild(el('div', { class: 'video-card-duration' }, v.duration));

    const tags = el('div', { class: 'video-card-tags' }, [
      el('span', { class: `tag tag-origin-${v.origin}` }, [
        el('span', { class: 'tag-icon' }, originIcon),
        originLabel
      ]),
      published
        ? el('span', { class: 'tag tag-published' }, [
            el('span', { class: 'tag-icon' }, '◆'),
            `publicado em ${project ? project.name : '—'}`
          ])
        : el('span', { class: 'tag tag-draft' }, [
            el('span', { class: 'tag-icon' }, '○'),
            'rascunho'
          ])
    ]);

    const card = el('div', { class: 'video-card', 'data-id': v.id }, [
      thumb,
      el('div', { class: 'video-card-body' }, [
        el('div', { class: 'video-card-name' }, v.name),
        tags
      ])
    ]);
    card.addEventListener('click', () => openEditorFromVideo(v.id));
    grid.appendChild(card);
  }
}

function renderPersonagens() {
  const grid = $('[data-bind="personagem-grid"]');
  grid.innerHTML = '';
  for (const c of state.personagens) {
    const card = el('div', { class: 'entity-card', 'data-id': c.id }, [
      (() => {
        const portrait = el('div', { class: 'entity-card-portrait' }, c.name[0]);
        portrait.style.background = patternBg(c.id);
        return portrait;
      })(),
      el('div', { class: 'entity-card-body' }, [
        el('div', { class: 'entity-card-name' }, c.name),
        el('div', { class: 'entity-card-meta' },
          `${c.variations} aparências · usado em ${c.usedInVideos} vídeos`),
      ])
    ]);
    card.addEventListener('click', () => toast(`Personagem "${c.name}" — no produto real, abre o estúdio do personagem (Fluxo D).`));
    grid.appendChild(card);
  }
}

function renderEnquadramentos() {
  const grid = $('[data-bind="enquadramento-grid"]');
  grid.innerHTML = '';
  for (const e of state.enquadramentos) {
    const card = el('div', { class: 'entity-card', 'data-id': e.id }, [
      (() => {
        const portrait = el('div', { class: 'entity-card-portrait' }, '▭');
        portrait.style.background = patternBg(e.id);
        return portrait;
      })(),
      el('div', { class: 'entity-card-body' }, [
        el('div', { class: 'entity-card-name' }, e.name),
        el('div', { class: 'entity-card-meta' }, `fov ${e.fov}° · ${e.posicao}`),
        el('div', { class: 'entity-card-spec' }, `usado em ${e.usedInVideos} vídeos`),
      ])
    ]);
    card.addEventListener('click', () => toast(`Enquadramento "${e.name}" — no produto real, abre o viewport 3D.`));
    grid.appendChild(card);
  }
}

function renderCameras() {
  const list = $('[data-bind="camera-list"]');
  list.innerHTML = '';
  for (const c of state.cameras) {
    const row = el('div', { class: 'camera-row' }, [
      el('div', { class: 'camera-row-icon' }, '◉'),
      el('div', { class: 'camera-row-name' }, c.name),
      el('div', { class: 'camera-row-meta' }, `fov ${c.fov}°`),
      el('div', { class: 'camera-row-meta' }, `dist ${c.dist}m · alt ${c.alt}m`),
    ]);
    list.appendChild(row);
  }
}

function renderEditor() {
  const v = state.videos.find(x => x.id === state.currentVideoId);
  if (!v) return;

  const published = v.publishedAssetId ? state.assets.find(a => a.id === v.publishedAssetId) : null;
  const project = published ? state.projects.find(p => p.id === published.projectId) : null;

  $('[data-bind="editor-name"]').textContent = v.name;
  $('[data-bind="editor-meta"]').textContent =
    `${v.duration} · origem: ${v.origin}`;

  // contexto: se chegamos pela galeria, mostra o caminho da galeria; senão ateliê
  const ctx = published && state.lastFromGallery
    ? `Galeria → ${project?.name || '—'}`
    : `Ateliê → Vídeos`;
  $('[data-bind="editor-context"]').textContent = ctx;

  // estado do publish
  const stateEl = $('[data-bind="editor-publish-state"]');
  const publishBtn = $('[data-action="open-publish"] .btn-icon')?.parentElement;
  if (published) {
    stateEl.classList.add('is-published');
    stateEl.classList.remove('is-warn');
    stateEl.innerHTML = `<span class="dot"></span> publicado em ${project?.name || '—'}`;
    if (publishBtn) {
      publishBtn.querySelector('.btn-icon').textContent = '↻';
      publishBtn.lastChild.textContent = ' republicar (sobrescreve)';
    }
  } else {
    stateEl.classList.remove('is-published');
    stateEl.innerHTML = `<span class="dot dot-warn"></span> ainda não publicado`;
    if (publishBtn) {
      publishBtn.querySelector('.btn-icon').textContent = '◆';
      publishBtn.lastChild.textContent = ' publicar como asset';
    }
  }
}

// ---------------------------------------------------------------------------
// breadcrumb e label de espaço
// ---------------------------------------------------------------------------

function renderChrome() {
  // label "você está em" + alternador
  const spaceName = state.space === 'galeria' ? 'Galeria' : 'Ateliê';
  $('[data-bind="space-name"]').textContent = spaceName;
  $$('.space-switch-btn').forEach(b => {
    const active = b.dataset.space === state.space;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', String(active));
  });

  // breadcrumb depende da tela
  const crumb = $('[data-bind="breadcrumb"]');
  crumb.innerHTML = '';

  const items = [];
  if (state.space === 'galeria') {
    items.push('Galeria');
    if (state.screen === 'project' || state.screen === 'editor') {
      const p = state.projects.find(x => x.id === state.currentProjectId);
      if (p) items.push(p.name);
    }
    if (state.screen === 'editor') {
      const v = state.videos.find(x => x.id === state.currentVideoId);
      if (v) items.push(v.name);
    }
  } else {
    items.push('Ateliê');
    const subLabel = {
      videos: 'Vídeos',
      personagens: 'Personagens',
      enquadramentos: 'Enquadramentos',
      cameras: 'Câmeras salvas'
    }[state.atelieSub];
    if (subLabel) items.push(subLabel);
    if (state.screen === 'editor') {
      const v = state.videos.find(x => x.id === state.currentVideoId);
      if (v) items.push(v.name);
    }
  }

  for (const it of items) {
    crumb.appendChild(el('li', {}, it));
  }
}

// ---------------------------------------------------------------------------
// navegação + transição animada entre espaços
// ---------------------------------------------------------------------------

function applyDOMState() {
  document.body.dataset.space = state.space;
  document.body.dataset.screen = state.screen;
}

function renderAll() {
  applyDOMState();
  renderChrome();
  if (state.screen === 'home')    renderProjects();
  if (state.screen === 'project') renderProject();
  if (state.screen === 'atelie')  renderAtelie();
  if (state.screen === 'editor')  renderEditor();
  saveState();
}

function gotoSpace(targetSpace) {
  if (state.space === targetSpace) return;
  playTransition(targetSpace, () => {
    state.space = targetSpace;
    if (targetSpace === 'galeria') {
      state.screen = 'home';
    } else {
      state.screen = 'atelie';
    }
    renderAll();
  });
}

function playTransition(target, mid) {
  const overlay = $('[data-bind="transition"]');
  const label = $('[data-bind="transition-label"]');
  label.textContent = target === 'galeria' ? 'Galeria' : 'Ateliê';
  overlay.dataset.target = target;
  overlay.classList.add('is-on');

  setTimeout(() => {
    mid && mid();
    setTimeout(() => {
      overlay.classList.remove('is-on');
    }, 220);
  }, 360);
}

function openProject(projectId) {
  state.currentProjectId = projectId;
  state.assetFilter = 'all';
  state.space = 'galeria';
  state.screen = 'project';
  renderAll();
}

function gotoHome() {
  state.screen = 'home';
  state.currentProjectId = null;
  renderAll();
}

function gotoAtelieSub(sub) {
  state.atelieSub = sub;
  state.space = 'atelie';
  state.screen = 'atelie';
  renderAll();
}

function openEditorFromVideo(videoId) {
  state.currentVideoId = videoId;
  state.lastFromGallery = false;
  state.screen = 'editor';
  renderAll();
}

function openEditorFromAsset(assetId) {
  const a = state.assets.find(x => x.id === assetId);
  if (!a) return;
  state.currentVideoId = a.videoId;
  state.currentProjectId = a.projectId;
  state.lastFromGallery = true;
  state.screen = 'editor';
  renderAll();
}

// ---------------------------------------------------------------------------
// modais
// ---------------------------------------------------------------------------

function openModal(name) {
  const m = $(`[data-modal="${name}"]`);
  if (m) {
    m.hidden = false;
    setTimeout(() => {
      const firstInput = m.querySelector('input, textarea, button.btn-primary');
      firstInput?.focus();
    }, 50);
  }
}
function closeAllModals() {
  $$('.modal').forEach(m => m.hidden = true);
  // fecha custom selects abertos
  $$('.custom-select.is-open').forEach(s => s.classList.remove('is-open'));
}

// ---------------------------------------------------------------------------
// publish flow
// ---------------------------------------------------------------------------

let publishCtx = { projectId: null, name: '' };

function openPublishModal() {
  const v = state.videos.find(x => x.id === state.currentVideoId);
  if (!v) return;

  const existingAsset = v.publishedAssetId ? state.assets.find(a => a.id === v.publishedAssetId) : null;

  publishCtx = {
    projectId: existingAsset ? existingAsset.projectId : null,
    name: existingAsset ? existingAsset.name : v.name,
  };

  // popula menu de projetos
  const menu = $('[data-bind="publish-project-menu"]');
  menu.innerHTML = '';
  for (const p of state.projects) {
    const li = el('li', { 'data-id': p.id }, p.name);
    li.addEventListener('click', () => {
      publishCtx.projectId = p.id;
      $('[data-bind="publish-project-label"]').textContent = p.name;
      $('[data-bind="publish-project-select"]').classList.remove('is-open');
    });
    menu.appendChild(li);
  }
  // opção criar novo
  const liNew = el('li', { class: 'is-create' }, '+ criar novo projeto');
  liNew.addEventListener('click', () => {
    const name = prompt_inplace('Nome do novo projeto:');
    if (name) {
      const p = { id: uid('p'), name: name.trim(), created: new Date().toISOString().slice(0,10), description: '' };
      state.projects.push(p);
      publishCtx.projectId = p.id;
      $('[data-bind="publish-project-label"]').textContent = p.name;
      saveState();
      // re-render menu
      $('[data-bind="publish-project-select"]').classList.remove('is-open');
    }
  });
  menu.appendChild(liNew);

  // label inicial
  if (existingAsset) {
    const project = state.projects.find(p => p.id === existingAsset.projectId);
    $('[data-bind="publish-project-label"]').textContent = project?.name || '— escolher —';
    $('[data-bind="publish-overwrite-warn"]').hidden = false;
  } else {
    $('[data-bind="publish-project-label"]').textContent = '— escolher —';
    $('[data-bind="publish-overwrite-warn"]').hidden = true;
  }

  $('[data-bind="publish-asset-name"]').value = publishCtx.name;
  openModal('publish');
}

// fallback simples pra entrada de nome — em produção seria modal próprio
function prompt_inplace(msg) {
  return window.prompt(msg);
}

function confirmPublish() {
  if (!publishCtx.projectId) {
    toast('escolha um projeto-destino primeiro.');
    return;
  }
  const name = $('[data-bind="publish-asset-name"]').value.trim() || 'asset sem nome';
  const v = state.videos.find(x => x.id === state.currentVideoId);
  if (!v) return;

  let asset;
  if (v.publishedAssetId) {
    // republicar — sobrescreve
    asset = state.assets.find(a => a.id === v.publishedAssetId);
    asset.projectId = publishCtx.projectId;
    asset.name = name;
    asset.publishedAt = new Date().toISOString().slice(0,10);
  } else {
    asset = {
      id: uid('a'),
      projectId: publishCtx.projectId,
      videoId: v.id,
      name,
      status: 'pendente',
      publishedAt: new Date().toISOString().slice(0,10),
    };
    state.assets.push(asset);
    v.publishedAssetId = asset.id;
  }

  closeAllModals();
  toast(`asset "${name}" publicado.`);

  // leva pro detalhe do projeto onde apareceu (anuncia a transição)
  state.lastFromGallery = true;
  setTimeout(() => {
    playTransition('galeria', () => {
      state.space = 'galeria';
      state.screen = 'project';
      state.currentProjectId = asset.projectId;
      renderAll();
    });
  }, 300);
}

// ---------------------------------------------------------------------------
// criar projeto / vídeo / personagem
// ---------------------------------------------------------------------------

function confirmNewProject() {
  const name = $('[data-bind="new-project-name"]').value.trim();
  if (!name) { toast('precisa de um nome.'); return; }
  const p = { id: uid('p'), name, created: new Date().toISOString().slice(0,10), description: '' };
  state.projects.push(p);
  closeAllModals();
  $('[data-bind="new-project-name"]').value = '';
  toast(`projeto "${name}" criado.`);
  renderAll();
}

function pickFlow(flow) {
  closeAllModals();
  if (flow === 'A') {
    // simula upload
    const v = {
      id: uid('v'),
      name: `Novo upload ${new Date().toLocaleTimeString().slice(0,5)}`,
      origin: 'upload',
      duration: '00:05',
      publishedAssetId: null
    };
    state.videos.unshift(v);
    saveState();
    toast('vídeo carregado (mock). abrindo editor…');
    setTimeout(() => openEditorFromVideo(v.id), 300);
  } else if (flow === 'D') {
    // simula geração via Fluxo D
    const v = {
      id: uid('v'),
      name: `Personagem (gerado) ${new Date().toLocaleTimeString().slice(0,5)}`,
      origin: 'character',
      duration: '00:04',
      publishedAssetId: null
    };
    state.videos.unshift(v);
    saveState();
    toast('vídeo gerado (mock). abrindo editor…');
    setTimeout(() => openEditorFromVideo(v.id), 300);
  }
}

function confirmNewPersonagem() {
  const name = $('[data-bind="new-personagem-name"]').value.trim();
  if (!name) { toast('precisa de um nome.'); return; }
  const c = { id: uid('c'), name, variations: 1, usedInVideos: 0 };
  state.personagens.push(c);
  closeAllModals();
  $('[data-bind="new-personagem-name"]').value = '';
  toast(`personagem "${name}" criado.`);
  renderAll();
}

// ---------------------------------------------------------------------------
// toast
// ---------------------------------------------------------------------------

let toastTimer = null;
function toast(msg) {
  const t = $('[data-bind="toast"]');
  $('[data-bind="toast-msg"]').textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidden = true, 2400);
}

// ---------------------------------------------------------------------------
// event delegation
// ---------------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;

  switch (action) {
    case 'goto-space':
      gotoSpace(t.dataset.space);
      break;
    case 'goto-home':
      gotoHome();
      break;
    case 'goto-atelie-videos':
      gotoSpaceAndSub('atelie', 'videos');
      break;
    case 'goto-atelie-sub':
      gotoAtelieSub(t.dataset.sub);
      break;
    case 'new-project':
      openModal('new-project');
      break;
    case 'confirm-new-project':
      confirmNewProject();
      break;
    case 'new-video':
      openModal('new-video');
      break;
    case 'pick-flow':
      pickFlow(t.dataset.flow);
      break;
    case 'new-personagem':
      openModal('new-personagem');
      break;
    case 'confirm-new-personagem':
      confirmNewPersonagem();
      break;
    case 'new-enquadramento':
      toast('no produto real abre o viewport 3D (preset + FOV + orbit).');
      break;
    case 'open-publish':
      openPublishModal();
      break;
    case 'confirm-publish':
      confirmPublish();
      break;
    case 'modal-close':
      closeAllModals();
      break;
    case 'toggle-project-select':
      $('[data-bind="publish-project-select"]').classList.toggle('is-open');
      ev.stopPropagation();
      break;
    case 'reset-seed':
      resetState();
      break;
  }

  // filtros de asset
  if (t.classList.contains('chip') && t.dataset.filter) {
    state.assetFilter = t.dataset.filter;
    renderProject();
  }
});

// fecha custom-select clicando fora
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('.custom-select')) {
    $$('.custom-select.is-open').forEach(s => s.classList.remove('is-open'));
  }
});

// esc fecha modais
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeAllModals();
});

function gotoSpaceAndSub(space, sub) {
  if (state.space === space) {
    state.atelieSub = sub;
    state.screen = 'atelie';
    renderAll();
  } else {
    playTransition(space, () => {
      state.space = space;
      state.atelieSub = sub;
      state.screen = space === 'atelie' ? 'atelie' : 'home';
      renderAll();
    });
  }
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

renderAll();
