// Detalhe do projeto = lista de assets + filtros + ordenação.
import { store, mutate } from '../store.js';
import { go } from '../router.js';
import { el, escapeHtml, openModal, closeModal, confirmModal, setCrumbs, showScreen, svgPlaceholder, fmtDate, fmtRelative, toast } from '../ui.js';

let currentFilter = 'todos'; // todos | pendente | feito
let currentSort   = 'recent'; // recent | name

export function render({ id }) {
  const p = store.project(id);
  if (!p) { go('/'); return; }

  showScreen('project');
  setCrumbs([
    { label: 'projetos', href: '#/' },
    { label: p.name }
  ]);

  const root = document.querySelector('[data-screen="project"] .screen-inner');
  const allAssets = store.assetsByProject(p.id);
  const labels = store.statusLabels();

  const filtered = allAssets
    .filter(a => currentFilter === 'todos' ? true : a.status === currentFilter)
    .sort((a, b) => currentSort === 'recent'
      ? b.published_at.localeCompare(a.published_at)
      : a.name.localeCompare(b.name)
    );

  const pendentes = allAssets.filter(a => a.status === 'pendente').length;
  const feitos    = allAssets.filter(a => a.status === 'feito').length;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          <span class="title-num">${p.id.replace('p_', '').slice(0, 3).toUpperCase()}</span>
          <span class="title-word">${escapeHtml(p.name)}</span>
        </h1>
        <div class="page-sub">${escapeHtml(p.summary || '—')}<span class="dot">·</span>${allAssets.length} ${allAssets.length === 1 ? 'asset' : 'assets'} <span class="dot">·</span> criado em ${fmtDate(p.created_at)}</div>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-ghost" data-action="open-workbench">
          <span class="btn-icon">▦</span>
          workbench
        </button>
        <button class="btn btn-primary btn-lg" data-action="new-asset">
          <span class="btn-icon">+</span>
          novo asset
        </button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-group">
        <button class="filter-pill ${currentFilter === 'todos' ? 'active' : ''}" data-filter="todos">todos · ${allAssets.length}</button>
        <button class="filter-pill ${currentFilter === 'pendente' ? 'active' : ''}" data-filter="pendente">${labels.pendente} · ${pendentes}</button>
        <button class="filter-pill ${currentFilter === 'feito' ? 'active' : ''}" data-filter="feito">${labels.feito} · ${feitos}</button>
      </div>
      <div class="filter-group">
        <button class="filter-pill ${currentSort === 'recent' ? 'active' : ''}" data-sort="recent">mais recentes</button>
        <button class="filter-pill ${currentSort === 'name' ? 'active' : ''}" data-sort="name">nome</button>
      </div>
    </div>

    <div class="asset-grid" id="asset-grid"></div>
  `;

  const grid = root.querySelector('#asset-grid');

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; display:flex;">
        <div class="empty-mark">VAZIO</div>
        <div class="empty-title">${allAssets.length === 0 ? 'projeto sem assets ainda' : 'nada nesse filtro'}</div>
        <div class="empty-sub">${allAssets.length === 0
          ? 'o caminho pra criar um asset começa na workbench: você fabrica um vídeo lá e publica nesse projeto.'
          : 'troque o filtro acima ou crie um novo asset.'}</div>
        <button class="btn btn-primary" data-action="empty-new-asset">+ novo asset</button>
      </div>
    `;
    grid.querySelector('[data-action="empty-new-asset"]')?.addEventListener('click', openNewAssetModal.bind(null, p));
  } else {
    for (const a of filtered) {
      const v = store.video(a.video_id);
      const card = el(`
        <div class="asset-card" data-asset-id="${a.id}">
          <div class="asset-thumb">
            <img src="${svgPlaceholder(a.id, a.name.slice(0, 8).toUpperCase(), v?.hue || p.cover_hue)}" alt=""/>
            <div class="asset-status status-${a.status}">${escapeHtml(labels[a.status] || a.status)}</div>
          </div>
          <div class="asset-body">
            <div class="asset-name">${escapeHtml(a.name)}</div>
            <div class="asset-meta">
              <span>${a.frames}f @ ${a.fps}fps</span>
              <span class="dot">·</span>
              <span>publicado ${fmtRelative(a.published_at)}</span>
            </div>
          </div>
          <div class="asset-actions">
            <button class="node-act" data-action="toggle-status">marcar ${a.status === 'pendente' ? labels.feito : labels.pendente}</button>
            <button class="node-act primary" data-action="open-editor">abrir editor</button>
            <button class="node-act" data-action="download">baixar .aseprite</button>
          </div>
        </div>
      `);

      card.querySelector('[data-action="toggle-status"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const next = a.status === 'pendente' ? 'feito' : 'pendente';
        mutate.setAssetStatus(a.id, next);
        toast({ title: 'status atualizado', sub: `${escapeHtml(a.name)} → ${labels[next]}` });
        render({ id: p.id });
      });
      card.querySelector('[data-action="open-editor"]').addEventListener('click', (e) => {
        e.stopPropagation();
        go(`/v/${a.video_id}`);
      });
      card.querySelector('[data-action="download"]').addEventListener('click', (e) => {
        e.stopPropagation();
        toast({ title: 'protótipo: download simulado', sub: `${a.name}.aseprite` });
      });
      card.addEventListener('click', () => openAssetDetail(a, p));
      grid.appendChild(card);
    }
  }

  // Filter / sort handlers
  root.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      render({ id: p.id });
    });
  });
  root.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSort = btn.dataset.sort;
      render({ id: p.id });
    });
  });

  root.querySelector('[data-action="new-asset"]').addEventListener('click', () => openNewAssetModal(p));
  root.querySelector('[data-action="open-workbench"]').addEventListener('click', () => go('/wb/videos'));
}

// Modal de detalhe do asset (preview + ações)
function openAssetDetail(a, p) {
  const v = store.video(a.video_id);
  const labels = store.statusLabels();
  const node = el(`
    <div class="modal modal-md">
      <div class="modal-head">
        <div class="modal-step">asset</div>
        <div class="modal-title">${escapeHtml(a.name)}</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="asset-preview">
          <img src="${svgPlaceholder(a.id, 'PREVIEW', v?.hue || p.cover_hue)}" alt=""/>
        </div>
        <div class="kv-grid">
          <div class="kv-row"><div class="kv-key">projeto</div><div class="kv-val">${escapeHtml(p.name)}</div></div>
          <div class="kv-row"><div class="kv-key">vídeo fonte</div><div class="kv-val">${escapeHtml(v?.name || '—')}</div></div>
          <div class="kv-row"><div class="kv-key">origem do vídeo</div><div class="kv-val">${originLabel(v?.origin)}</div></div>
          <div class="kv-row"><div class="kv-key">frames</div><div class="kv-val">${a.frames} @ ${a.fps}fps</div></div>
          <div class="kv-row"><div class="kv-key">publicado</div><div class="kv-val">${fmtDate(a.published_at)}</div></div>
          <div class="kv-row"><div class="kv-key">status</div><div class="kv-val">
            <button class="status-toggle status-${a.status}" data-action="toggle-status">${escapeHtml(labels[a.status])} · clique pra trocar</button>
          </div></div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close>fechar</button>
        <button class="btn btn-ghost" data-action="download">baixar .aseprite</button>
        <button class="btn btn-primary" data-action="open-editor">abrir editor</button>
      </div>
    </div>
  `);
  node.querySelector('[data-action="open-editor"]').onclick = () => { closeModal(); go(`/v/${a.video_id}`); };
  node.querySelector('[data-action="download"]').onclick = () => toast({ title: 'protótipo: download simulado', sub: `${a.name}.aseprite` });
  node.querySelector('[data-action="toggle-status"]').onclick = () => {
    const next = a.status === 'pendente' ? 'feito' : 'pendente';
    mutate.setAssetStatus(a.id, next);
    closeModal();
    render({ id: p.id });
    toast({ title: 'status atualizado', sub: labels[next] });
  };
  openModal(node);
}

function originLabel(origin) {
  return ({
    'uploaded': 'upload',
    'url': 'URL',
    'generated-generic': 'IA · genérico',
    'generated-from-character': 'IA · personagem'
  })[origin] || '—';
}

// "Novo asset" abre a workbench/vídeos. Asset nasce na publicação.
function openNewAssetModal(p) {
  const node = el(`
    <div class="modal modal-md">
      <div class="modal-head">
        <div class="modal-step">como funciona</div>
        <div class="modal-title">criar asset</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:12px; line-height:1.7; color:var(--paper-2)">
          Asset nasce no <em style="color:var(--copper); font-style: italic;">ato de publicar um vídeo</em>. Você fabrica o vídeo na workbench (upload, URL, geração) e ao terminar de editar, clica em <strong style="color:var(--paper)">publicar como asset</strong>. É lá que o vídeo se vincula a este projeto.
        </p>
        <p style="font-size:12px; line-height:1.7; color:var(--paper-3)">
          Atalho: ir direto pra workbench/vídeos e escolher um vídeo já fabricado pra publicar aqui.
        </p>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close>cancelar</button>
        <button class="btn btn-primary" data-action="go-workbench">ir pra workbench</button>
      </div>
    </div>
  `);
  node.querySelector('[data-action="go-workbench"]').onclick = () => { closeModal(); go('/wb/videos'); };
  openModal(node);
}
