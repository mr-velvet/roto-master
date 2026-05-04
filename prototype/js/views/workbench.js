// Workbench — espaço de fabricação (do usuário). 4 subseções: vídeos, personagens, enquadramentos, câmeras.
import { store, mutate } from '../store.js';
import { go } from '../router.js';
import { el, escapeHtml, openModal, closeModal, confirmModal, setCrumbs, showScreen, svgPlaceholder, fmtDate, fmtRelative, toast } from '../ui.js';

const SECTIONS = [
  { key: 'videos',     label: 'vídeos',         num: '01' },
  { key: 'characters', label: 'personagens',    num: '02' },
  { key: 'framings',   label: 'enquadramentos', num: '03' },
  { key: 'cameras',    label: 'câmeras',        num: '04' }
];

export function renderVideos()     { renderShell('videos'); }
export function renderCharacters() { renderShell('characters'); }
export function renderFramings()   { renderShell('framings'); }
export function renderCameras()    { renderShell('cameras'); }

function renderShell(active) {
  showScreen('workbench');
  const sec = SECTIONS.find(s => s.key === active);
  setCrumbs([
    { label: 'projetos', href: '#/' },
    { label: 'workbench' },
    { label: sec.label }
  ]);

  const root = document.querySelector('[data-screen="workbench"] .screen-inner');
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          <span class="title-num">${sec.num}</span>
          <span class="title-word">${sec.label}</span>
        </h1>
        <div class="page-sub">
          workbench <span class="dot">·</span> espaço de fabricação <span class="dot">·</span> seus recursos atravessam projetos
        </div>
      </div>
      <div style="display:flex; gap:10px;">
        ${active === 'videos' ? `<button class="btn btn-primary btn-lg" data-action="new-video">
          <span class="btn-icon">+</span>
          criar vídeo
        </button>` : ''}
        ${active === 'characters' ? `<button class="btn btn-primary btn-lg" data-action="new-character">
          <span class="btn-icon">+</span>
          novo personagem
        </button>` : ''}
        ${active === 'framings' ? `<button class="btn btn-primary btn-lg" data-action="new-framing">
          <span class="btn-icon">+</span>
          novo enquadramento
        </button>` : ''}
        ${active === 'cameras' ? `<button class="btn btn-primary btn-lg" data-action="new-camera">
          <span class="btn-icon">+</span>
          salvar câmera
        </button>` : ''}
      </div>
    </div>

    <nav class="wb-nav">
      ${SECTIONS.map(s => `
        <a href="#/wb/${s.key}" class="wb-tab ${s.key === active ? 'active' : ''}">
          <span class="wb-tab-num">${s.num}</span>
          <span class="wb-tab-label">${s.label}</span>
          <span class="wb-tab-count">${countFor(s.key)}</span>
        </a>
      `).join('')}
    </nav>

    <div class="wb-body" id="wb-body"></div>
  `;

  const body = root.querySelector('#wb-body');
  if      (active === 'videos')     drawVideos(body);
  else if (active === 'characters') drawCharacters(body);
  else if (active === 'framings')   drawFramings(body);
  else if (active === 'cameras')    drawCameras(body);

  // Ações dos botões topo
  root.querySelector('[data-action="new-video"]')?.addEventListener('click', openNewVideoModal);
  root.querySelector('[data-action="new-character"]')?.addEventListener('click', openNewCharacterModal);
  root.querySelector('[data-action="new-framing"]')?.addEventListener('click', openNewFramingModal);
  root.querySelector('[data-action="new-camera"]')?.addEventListener('click', () => toast({ title: 'salvar câmera disponível dentro de "novo enquadramento"', glyph: 'i' }));
}

function countFor(section) {
  if (section === 'videos')     return store.videos().length;
  if (section === 'characters') return store.characters().length;
  if (section === 'framings')   return store.framings().length;
  if (section === 'cameras')    return store.savedCameras().length;
  return 0;
}

// ---------- VÍDEOS ----------
function drawVideos(body) {
  const videos = store.videos();
  if (videos.length === 0) {
    body.innerHTML = emptyState('VÍDEOS', 'workbench vazia', 'comece criando um vídeo. ele fica aqui na sua workbench até você decidir publicá-lo como asset em algum projeto.');
    body.querySelector('[data-action="empty-cta"]')?.addEventListener('click', openNewVideoModal);
    return;
  }
  const grid = el(`<div class="node-grid"></div>`);
  for (const v of videos) {
    const published = store.videoIsPublished(v.id);
    const asset = store.videoAsset(v.id);
    const project = asset ? store.project(asset.project_id) : null;
    const node = el(`
      <div class="node" data-video-id="${v.id}">
        <div class="node-thumb">
          <img src="${svgPlaceholder(v.id, v.name.slice(0, 8).toUpperCase(), v.hue)}" alt=""/>
          <div class="badge">${originGlyph(v.origin)} ${originLabel(v.origin)}</div>
          ${published ? `<div class="published-tag">publicado · ${escapeHtml(project?.name || '—')}</div>` : ''}
        </div>
        <div class="node-body">
          <div class="node-row">
            <div class="node-name">${escapeHtml(v.name)}</div>
            <div class="node-version">${v.duration_s}s</div>
          </div>
          <div class="node-meta">
            <span>${fmtRelative(v.created_at)}</span>
            <span class="meta-date">${v.origin === 'uploaded' ? `${v.size_mb}MB` : 'IA'}</span>
          </div>
        </div>
        <div class="node-actions">
          <button class="node-act primary" data-action="open">abrir editor</button>
          <button class="node-act" data-action="duplicate">duplicar</button>
          ${published ? '' : `<button class="node-act danger" data-action="delete">apagar</button>`}
        </div>
      </div>
    `);
    node.querySelector('[data-action="open"]').addEventListener('click', (e) => { e.stopPropagation(); go(`/v/${v.id}`); });
    node.querySelector('[data-action="duplicate"]').addEventListener('click', (e) => {
      e.stopPropagation();
      const c = mutate.duplicateVideo(v.id);
      toast({ title: 'vídeo duplicado', sub: c.name });
      renderVideos();
    });
    node.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmModal({ title: 'apagar vídeo', body: `apagar "${v.name}"? esta ação não pode ser desfeita no protótipo.`, danger: true, confirmLabel: 'apagar' });
      if (!ok) return;
      mutate.deleteVideo(v.id);
      toast({ title: 'vídeo apagado' });
      renderVideos();
    });
    node.addEventListener('click', () => openVideoDetail(v));
    grid.appendChild(node);
  }
  body.appendChild(grid);
}

function originLabel(origin) {
  return ({
    'uploaded': 'upload',
    'url': 'URL',
    'generated-generic': 'IA',
    'generated-from-character': 'personagem'
  })[origin] || '—';
}

function originGlyph(origin) {
  return ({
    'uploaded': '↑',
    'url': '⊙',
    'generated-generic': '✦',
    'generated-from-character': '☻'
  })[origin] || '·';
}

function openVideoDetail(v) {
  const asset = store.videoAsset(v.id);
  const project = asset ? store.project(asset.project_id) : null;
  const character = v.character_id ? store.character(v.character_id) : null;
  const framing = v.framing_id ? store.framing(v.framing_id) : null;

  const node = el(`
    <div class="modal modal-md">
      <div class="modal-head">
        <div class="modal-step">${originLabel(v.origin)}</div>
        <div class="modal-title">${escapeHtml(v.name)}</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="asset-preview">
          <img src="${svgPlaceholder(v.id, 'VIDEO', v.hue)}" alt=""/>
        </div>
        <div class="kv-grid">
          <div class="kv-row"><div class="kv-key">origem</div><div class="kv-val">${originLabel(v.origin)}</div></div>
          <div class="kv-row"><div class="kv-key">duração</div><div class="kv-val">${v.duration_s}s</div></div>
          <div class="kv-row"><div class="kv-key">criado</div><div class="kv-val">${fmtDate(v.created_at)}</div></div>
          ${v.origin === 'uploaded' ? `<div class="kv-row"><div class="kv-key">arquivo</div><div class="kv-val">${escapeHtml(v.file_name)} · ${v.size_mb}MB</div></div>` : ''}
          ${character ? `<div class="kv-row"><div class="kv-key">personagem</div><div class="kv-val">${escapeHtml(character.name)}</div></div>` : ''}
          ${framing ? `<div class="kv-row"><div class="kv-key">enquadramento</div><div class="kv-val">${escapeHtml(framing.name)}</div></div>` : ''}
          ${v.movement_prompt ? `<div class="kv-row"><div class="kv-key">movimento</div><div class="kv-val">${escapeHtml(v.movement_prompt)}</div></div>` : ''}
          <div class="kv-row"><div class="kv-key">publicação</div><div class="kv-val">${asset ? `<a href="#/p/${project.id}">${escapeHtml(project.name)} · ${escapeHtml(asset.name)}</a>` : '<span style="color:var(--paper-4)">não publicado</span>'}</div></div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close>fechar</button>
        <button class="btn btn-ghost" data-action="duplicate">duplicar</button>
        <button class="btn btn-primary" data-action="open-editor">abrir editor</button>
      </div>
    </div>
  `);
  node.querySelector('[data-action="open-editor"]').onclick = () => { closeModal(); go(`/v/${v.id}`); };
  node.querySelector('[data-action="duplicate"]').onclick = () => {
    const c = mutate.duplicateVideo(v.id);
    closeModal();
    renderVideos();
    toast({ title: 'vídeo duplicado', sub: c.name });
  };
  openModal(node);
}

// ---------- modal "criar vídeo" — escolha de fluxo ----------
function openNewVideoModal() {
  const node = el(`
    <div class="modal modal-xl">
      <div class="modal-head">
        <div class="modal-step">como você quer começar</div>
        <div class="modal-title">criar vídeo</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="flow-grid">
          ${flowCard('A', 'upload',     'arquivo de vídeo do seu computador',                'available', 'upload')}
          ${flowCard('B', 'URL',        'baixar vídeo de um link público',                   'soon',      'url')}
          ${flowCard('C', 'genérico',   'gerar vídeo via IA com prompt livre',                'soon',      'generic')}
          ${flowCard('D', 'personagem', 'pipeline opinionado: aparência → enquadramento → movimento', 'available', 'character')}
        </div>
      </div>
    </div>
  `);
  node.querySelectorAll('.flow-card').forEach(card => {
    card.addEventListener('click', () => {
      const flow = card.dataset.flow;
      closeModal();
      if      (flow === 'upload')    openUploadModal();
      else if (flow === 'character') openCharacterFlowModal();
      else                           openSoonModal(flow);
    });
  });
  openModal(node);
}

function flowCard(letter, name, sub, status, flow) {
  return `
    <div class="flow-card flow-${status}" data-flow="${flow}">
      <div class="flow-letter">${letter}</div>
      <div class="flow-info">
        <div class="flow-name">${name}</div>
        <div class="flow-sub">${sub}</div>
      </div>
      <div class="flow-status">${status === 'soon' ? 'em breve' : 'disponível'}</div>
    </div>
  `;
}

function openUploadModal() {
  const node = el(`
    <div class="modal modal-md">
      <div class="modal-head">
        <div class="modal-step">fluxo A · upload</div>
        <div class="modal-title">novo vídeo (upload)</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="upload-zone" id="upz">
          <div class="upload-glyph">↑</div>
          <div class="upload-title">arraste um arquivo aqui</div>
          <div class="upload-sub">protótipo: clique pra simular um upload</div>
        </div>
        <div class="field">
          <label class="field-label">nome do vídeo</label>
          <input type="text" class="textarea" id="up-name" placeholder="ex: animação de corrida" style="resize:none; min-height:42px;"/>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close>cancelar</button>
        <button class="btn btn-primary" id="up-create">criar vídeo</button>
      </div>
    </div>
  `);
  openModal(node);
  setTimeout(() => node.querySelector('#up-name').focus(), 50);
  node.querySelector('#upz').addEventListener('click', () => {
    node.querySelector('#upz').classList.add('uploaded');
    node.querySelector('#upz').innerHTML = `<div class="upload-glyph" style="color:var(--moss)">✓</div><div class="upload-title">arquivo carregado (simulado)</div><div class="upload-sub">corrida.mp4 · 14MB · 5s</div>`;
  });
  node.querySelector('#up-create').onclick = () => {
    const name = node.querySelector('#up-name').value.trim() || 'novo upload';
    const v = mutate.createVideoUpload({ name, file_name: 'corrida.mp4', size_mb: 14 });
    closeModal();
    toast({ title: 'vídeo criado', sub: 'agora você pode editar e publicar' });
    go(`/v/${v.id}`);
  };
}

function openSoonModal(flow) {
  const titles = { url: 'fluxo B · URL', generic: 'fluxo C · genérico via IA' };
  const node = el(`
    <div class="modal modal-md">
      <div class="modal-head">
        <div class="modal-step">${titles[flow]}</div>
        <div class="modal-title">em breve</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:12px; line-height:1.7; color:var(--paper-2)">
          este fluxo está reservado na UI mas a implementação foi adiada pra depois da v1.
          ${flow === 'url'
            ? ' a ideia: colar um link público de vídeo, a ferramenta baixa pro storage e cai no editor.'
            : ' a ideia: prompt livre + escolha de modelo, geração t2v sem pose inicial.'}
        </p>
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary" data-close>entendi</button>
      </div>
    </div>
  `);
  openModal(node);
}

function openCharacterFlowModal() {
  // Resumo curto + escolha simples; a árvore profunda já existe e detalha depois
  const characters = store.characters();
  const framings = store.framings();
  const node = el(`
    <div class="modal modal-xl">
      <div class="modal-head">
        <div class="modal-step">fluxo D · caminho personagem</div>
        <div class="modal-title">criar vídeo de personagem</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:12px; line-height:1.7; color:var(--paper-3)">
          este fluxo combina <em style="color:var(--copper)">aparência</em> → <em style="color:var(--copper)">enquadramento</em> → <em style="color:var(--copper)">movimento</em>.
          o protótipo v1 (em <code style="color:var(--paper)">/prototype-v1-personagem/</code>) detalha esse fluxo com viewport 3D real e árvore de variações — nesta v2 mostramos a entrada simplificada.
        </p>

        <div class="field">
          <label class="field-label">1 · personagem</label>
          <div class="picker-grid">
            ${characters.map(c => `
              <div class="picker-card" data-pick-character="${c.id}">
                <div class="picker-thumb" style="background-image:url('${svgPlaceholder(c.id, c.name.slice(0,6).toUpperCase(), c.hue)}')"></div>
                <div class="picker-name">${escapeHtml(c.name)}</div>
              </div>
            `).join('')}
            <div class="picker-card picker-new" data-pick-character="__new__">
              <div class="picker-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--paper-4);font-size:32px;font-family:var(--font-display);font-style:italic">+</div>
              <div class="picker-name">novo</div>
            </div>
          </div>
        </div>

        <div class="field" id="framing-step" style="display:none">
          <label class="field-label">2 · enquadramento</label>
          <div class="picker-grid" id="framing-picker"></div>
        </div>

        <div class="field" id="movement-step" style="display:none">
          <label class="field-label">3 · movimento</label>
          <textarea class="textarea" id="mov-prompt" placeholder="ex: dois passos à frente, saca a espada, postura de guarda"></textarea>
          <div class="field-row" style="margin-top:8px">
            <div class="field field-narrow">
              <label class="field-label">duração</label>
              <div class="seg" id="dur-seg">
                <button data-dur="3">3s</button>
                <button class="active" data-dur="5">5s</button>
                <button data-dur="8">8s</button>
              </div>
            </div>
            <div class="field field-inline" style="align-self:flex-end">
              <span class="cost-pill">custo estimado: $0.35</span>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close>cancelar</button>
        <button class="btn btn-primary" id="char-flow-go" disabled>gerar vídeo — $0.35</button>
      </div>
    </div>
  `);
  let pickedChar = null, pickedFraming = null, dur = 5;
  const framingStep = node.querySelector('#framing-step');
  const movementStep = node.querySelector('#movement-step');
  const goBtn = node.querySelector('#char-flow-go');

  node.querySelectorAll('[data-pick-character]').forEach(card => {
    card.addEventListener('click', () => {
      const cid = card.dataset.pickCharacter;
      if (cid === '__new__') {
        toast({ title: 'no produto: abriria a etapa 1 (gerar aparência)', sub: 'aqui no protótipo escolha um existente' });
        return;
      }
      pickedChar = cid;
      node.querySelectorAll('[data-pick-character]').forEach(c => c.classList.remove('current'));
      card.classList.add('current');
      // Mostra enquadramentos (filtrados pelo personagem ou todos)
      const opts = framings.filter(f => f.character_ref === cid);
      const list = opts.length ? opts : framings;
      framingStep.style.display = '';
      const fp = node.querySelector('#framing-picker');
      fp.innerHTML = list.map(f => `
        <div class="picker-card" data-pick-framing="${f.id}">
          <div class="picker-thumb" style="background-image:url('${svgPlaceholder(f.id, f.name.slice(0,6).toUpperCase(), 18)}')"></div>
          <div class="picker-name">${escapeHtml(f.name)}</div>
        </div>
      `).join('') + `
        <div class="picker-card picker-new" data-pick-framing="__new__">
          <div class="picker-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--paper-4);font-size:32px;font-family:var(--font-display);font-style:italic">+</div>
          <div class="picker-name">novo</div>
        </div>
      `;
      fp.querySelectorAll('[data-pick-framing]').forEach(card => {
        card.addEventListener('click', () => {
          const fid = card.dataset.pickFraming;
          if (fid === '__new__') {
            toast({ title: 'no produto: abriria viewport 3D pra criar enquadramento', sub: 'protótipo v1 faz isso' });
            return;
          }
          pickedFraming = fid;
          fp.querySelectorAll('[data-pick-framing]').forEach(c => c.classList.remove('current'));
          card.classList.add('current');
          movementStep.style.display = '';
          goBtn.disabled = false;
        });
      });
    });
  });

  node.querySelectorAll('[data-dur]').forEach(b => {
    b.addEventListener('click', () => {
      dur = +b.dataset.dur;
      node.querySelectorAll('[data-dur]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const cost = (dur * 0.07).toFixed(2);
      node.querySelector('.cost-pill').textContent = `custo estimado: $${cost}`;
      goBtn.textContent = `gerar vídeo — $${cost}`;
    });
  });

  goBtn.addEventListener('click', () => {
    const prompt = node.querySelector('#mov-prompt').value.trim() || 'movimento livre';
    if (!pickedChar || !pickedFraming) return;
    closeModal();
    showGeneratingModal(() => {
      const v = mutate.createVideoFromCharacter({
        name: prompt.slice(0, 40),
        character_id: pickedChar,
        framing_id: pickedFraming,
        movement_prompt: prompt,
        duration_s: dur
      });
      closeModal();
      toast({ title: 'vídeo gerado', sub: v.name });
      go(`/v/${v.id}`);
    });
  });

  openModal(node);
}

function showGeneratingModal(onDone) {
  const node = el(`
    <div class="modal modal-sm modal-passive" style="pointer-events:none">
      <div class="generating">
        <div class="gen-pulse">
          <div class="gen-ring"></div><div class="gen-ring"></div><div class="gen-ring"></div>
        </div>
        <div class="gen-stage">gerando vídeo</div>
        <div class="gen-detail">kling 2.5 turbo · i2v</div>
        <div class="gen-progress"><div class="gen-progress-fill" id="gpf"></div></div>
        <div class="gen-meta"><span id="gtime">0s</span><span>~10s</span></div>
      </div>
    </div>
  `);
  openModal(node);
  let elapsed = 0;
  const fill = node.querySelector('#gpf');
  const time = node.querySelector('#gtime');
  const start = performance.now();
  const total = 2200; // 2.2s no protótipo
  const tick = () => {
    const t = performance.now() - start;
    const p = Math.min(1, t / total);
    fill.style.width = `${p * 100}%`;
    time.textContent = `${(t/1000).toFixed(1)}s`;
    if (p < 1) requestAnimationFrame(tick);
    else onDone();
  };
  requestAnimationFrame(tick);
}

// ---------- PERSONAGENS ----------
function drawCharacters(body) {
  const chars = store.characters();
  if (chars.length === 0) {
    body.innerHTML = emptyState('PERSONAGENS', 'sem personagens', 'crie um personagem pra usá-lo no fluxo D (caminho personagem) ao gerar vídeos.');
    body.querySelector('[data-action="empty-cta"]')?.addEventListener('click', openNewCharacterModal);
    return;
  }
  const grid = el(`<div class="char-grid"></div>`);
  for (const c of chars) {
    const fav = c.appearances.find(a => a.favorite) || c.appearances[0];
    const card = el(`
      <div class="char-card" data-character-id="${c.id}">
        <div class="char-thumb">
          <img src="${svgPlaceholder(c.id, c.name.slice(0, 6).toUpperCase(), c.hue)}" alt=""/>
          <div class="char-card-num">${c.id.replace('c_', '').slice(0, 4).toUpperCase()}</div>
        </div>
        <div class="char-card-body">
          <div class="char-card-name">${escapeHtml(c.name)}</div>
          <div class="char-card-meta">
            <b>${c.appearances.length}</b> aparênc.
            <span class="dot">·</span>
            <span>${escapeHtml(c.style)}</span>
          </div>
        </div>
      </div>
    `);
    card.addEventListener('click', () => {
      toast({ title: 'workspace do personagem está no protótipo v1', sub: 'esta v2 foca a integração com a esteira' });
    });
    grid.appendChild(card);
  }
  // Card "novo"
  const newCard = el(`
    <div class="char-card-new">
      <div class="new-content">
        <div class="new-glyph">+</div>
        <div class="new-text">novo personagem</div>
      </div>
    </div>
  `);
  newCard.addEventListener('click', openNewCharacterModal);
  grid.appendChild(newCard);
  body.appendChild(grid);
}

function openNewCharacterModal() {
  const node = el(`
    <div class="modal modal-md">
      <div class="modal-head">
        <div class="modal-step">workbench</div>
        <div class="modal-title">novo personagem</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label class="field-label">nome (opcional, pode renomear depois)</label>
          <input type="text" class="textarea" id="nc-name" placeholder="ex: cavaleiro órfico" style="resize:none; min-height:42px;"/>
        </div>
        <div class="field">
          <label class="field-label">descrição</label>
          <textarea class="textarea" id="nc-desc" placeholder="ex: cavaleiro de armadura preta gasta, capa vermelha rasgada"></textarea>
        </div>
        <div class="field">
          <label class="field-label">estilo</label>
          <div class="seg" id="nc-style">
            <button data-style="realismo">realismo</button>
            <button class="active" data-style="semi-realista">semi-realista</button>
            <button data-style="cartoon">cartoon</button>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close>cancelar</button>
        <button class="btn btn-primary" id="nc-create">criar personagem</button>
      </div>
    </div>
  `);
  let style = 'semi-realista';
  node.querySelectorAll('[data-style]').forEach(b => {
    b.addEventListener('click', () => {
      style = b.dataset.style;
      node.querySelectorAll('[data-style]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });
  node.querySelector('#nc-create').onclick = () => {
    const name = node.querySelector('#nc-name').value.trim() || 'novo personagem';
    const description = node.querySelector('#nc-desc').value.trim();
    const c = mutate.createCharacter({ name, description, style });
    mutate.addAppearance(c.id);
    closeModal();
    toast({ title: 'personagem criado', sub: c.name });
    renderCharacters();
  };
  openModal(node);
}

// ---------- ENQUADRAMENTOS ----------
function drawFramings(body) {
  const fs = store.framings();
  if (fs.length === 0) {
    body.innerHTML = emptyState('ENQUADRAMENTOS', 'sem enquadramentos', 'enquadramento é uma especificação de câmera (posição, fov, framing) sobre um personagem. produzido no viewport 3D.');
    body.querySelector('[data-action="empty-cta"]')?.addEventListener('click', openNewFramingModal);
    return;
  }
  const grid = el(`<div class="node-grid"></div>`);
  for (const f of fs) {
    const ch = f.character_ref ? store.character(f.character_ref) : null;
    const node = el(`
      <div class="node">
        <div class="node-thumb">
          <img src="${svgPlaceholder(f.id, f.name.slice(0,6).toUpperCase(), 28)}" alt=""/>
          <div class="badge">⌖ ${f.preset_key}</div>
        </div>
        <div class="node-body">
          <div class="node-row">
            <div class="node-name">${escapeHtml(f.name)}</div>
            <div class="node-version">${f.fov}°</div>
          </div>
          <div class="node-meta">
            <span>${ch ? escapeHtml(ch.name) : '—'}</span>
            <span class="meta-date">${fmtDate(f.created_at)}</span>
          </div>
        </div>
      </div>
    `);
    grid.appendChild(node);
  }
  body.appendChild(grid);
}

function openNewFramingModal() {
  toast({ title: 'no produto: abriria viewport 3D', sub: 'protótipo v1 já demonstra esse fluxo' });
}

// ---------- CÂMERAS ----------
function drawCameras(body) {
  const cams = store.savedCameras();
  if (cams.length === 0) {
    body.innerHTML = emptyState('CÂMERAS', 'sem câmeras salvas', 'câmeras salvas viram presets reutilizáveis. você as cria dentro do viewport 3D ao definir um enquadramento.');
    return;
  }
  const list = el(`<div class="cam-list"></div>`);
  for (const cam of cams) {
    const item = el(`
      <div class="cam-item">
        <div class="cam-icon">⌖</div>
        <div class="cam-info">
          <div class="cam-item-name">${escapeHtml(cam.name)}</div>
          <div class="cam-item-meta">FOV ${cam.fov}° <span class="dot">·</span> pos [${cam.position.map(n => n.toFixed(1)).join(', ')}]</div>
        </div>
        <button class="btn btn-ghost btn-sm">usar</button>
      </div>
    `);
    list.appendChild(item);
  }
  body.appendChild(list);
}

// ---------- helper ----------
function emptyState(mark, title, sub) {
  return `
    <div class="empty-state" style="display:flex">
      <div class="empty-mark">${mark}</div>
      <div class="empty-title">${escapeHtml(title)}</div>
      <div class="empty-sub">${escapeHtml(sub)}</div>
      <button class="btn btn-primary" data-action="empty-cta">+ criar primeiro</button>
    </div>
  `;
}
