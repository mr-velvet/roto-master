// Home global = lista de projetos do usuário.
import { store, mutate } from '../store.js';
import { go } from '../router.js';
import { el, escapeHtml, openModal, closeModal, setCrumbs, showScreen, svgPlaceholder, fmtDate, toast } from '../ui.js';

export function render() {
  showScreen('home');
  setCrumbs([{ label: 'projetos' }]);

  const root = document.querySelector('[data-screen="home"] .screen-inner');
  const projects = store.projects();

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          <span class="title-num">00</span>
          <span class="title-word">projetos</span>
        </h1>
        <div class="page-sub">${projects.length} ${projects.length === 1 ? 'projeto' : 'projetos'} <span class="dot">·</span> esteira de produção de assets de rotoscopia</div>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-ghost" data-action="open-workbench">
          <span class="btn-icon">▦</span>
          workbench
        </button>
        <button class="btn btn-primary btn-lg" data-action="new-project">
          <span class="btn-icon">+</span>
          novo projeto
        </button>
      </div>
    </div>

    <div class="char-grid" id="proj-grid"></div>
  `;

  const grid = root.querySelector('#proj-grid');

  for (const p of projects) {
    const assets = store.assetsByProject(p.id);
    const pendentes = assets.filter(a => a.status === 'pendente').length;
    const card = el(`
      <div class="char-card" data-project-id="${p.id}">
        <div class="char-thumb">
          <img src="${svgPlaceholder(p.id, p.name.toUpperCase().slice(0, 6), p.cover_hue)}" alt=""/>
          <div class="char-card-num">${p.id.replace('p_', '').slice(0, 4).toUpperCase()}</div>
        </div>
        <div class="char-card-body">
          <div class="char-card-name">${escapeHtml(p.name)}</div>
          <div class="char-card-meta">
            <b>${assets.length}</b> ${assets.length === 1 ? 'asset' : 'assets'}
            <span class="dot">·</span>
            <span>${pendentes ? `${pendentes} pendente${pendentes > 1 ? 's' : ''}` : 'tudo feito'}</span>
            <span class="dot">·</span>
            <span>${fmtDate(p.created_at)}</span>
          </div>
        </div>
      </div>
    `);
    card.addEventListener('click', () => go(`/p/${p.id}`));
    grid.appendChild(card);
  }

  // Card "novo projeto" extra ao final do grid
  const newCard = el(`
    <div class="char-card-new" data-action="new-project">
      <div class="new-content">
        <div class="new-glyph">+</div>
        <div class="new-text">novo projeto</div>
      </div>
    </div>
  `);
  newCard.addEventListener('click', openNewProjectModal);
  grid.appendChild(newCard);

  // Botões do head
  root.querySelector('[data-action="new-project"]').addEventListener('click', openNewProjectModal);
  root.querySelector('[data-action="open-workbench"]').addEventListener('click', () => go('/wb/videos'));
}

function openNewProjectModal() {
  const node = el(`
    <div class="modal modal-md">
      <div class="modal-head">
        <div class="modal-step">novo</div>
        <div class="modal-title">criar projeto</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label class="field-label">nome do projeto</label>
          <input type="text" class="textarea" id="np-name" placeholder="ex: Orpheus Descending" style="resize:none; min-height:42px;"/>
        </div>
        <div class="field">
          <label class="field-label">resumo (opcional)</label>
          <textarea class="textarea textarea-sm" id="np-sum" placeholder="breve descrição do projeto"></textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close>cancelar</button>
        <button class="btn btn-primary" id="np-create">criar projeto</button>
      </div>
    </div>
  `);
  openModal(node);
  setTimeout(() => node.querySelector('#np-name').focus(), 50);

  node.querySelector('#np-create').onclick = () => {
    const name = node.querySelector('#np-name').value.trim();
    const summary = node.querySelector('#np-sum').value.trim();
    if (!name) {
      toast({ title: 'dá um nome pro projeto', glyph: '!' });
      return;
    }
    const p = mutate.createProject({ name, summary });
    closeModal();
    toast({ title: 'projeto criado', sub: p.name });
    go(`/p/${p.id}`);
  };
}
