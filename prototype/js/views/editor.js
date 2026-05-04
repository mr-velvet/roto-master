// Editor de vídeo em tela cheia. Mock visual — não toca em vídeo real.
// Header global continua visível (com breadcrumbs), botão "publicar como asset".
import { store, mutate } from '../store.js';
import { go } from '../router.js';
import { el, escapeHtml, openModal, closeModal, setCrumbs, showScreen, svgPlaceholder, fmtDate, toast } from '../ui.js';

// estado leve do editor (não persistido — protótipo)
const editorState = new Map(); // video_id → { fps, scale, in, out, preset }

function initState(videoId) {
  if (!editorState.has(videoId)) {
    editorState.set(videoId, { fps: 12, scale: 1.0, in: 0, out: 5, preset: 'cga', mode: 'roto' });
  }
  return editorState.get(videoId);
}

export function render({ id }) {
  const v = store.video(id);
  if (!v) { go('/'); return; }
  const asset = store.videoAsset(v.id);
  const project = asset ? store.project(asset.project_id) : null;
  const state = initState(v.id);

  showScreen('editor');
  setCrumbs([
    { label: 'projetos', href: '#/' },
    project ? { label: project.name, href: `#/p/${project.id}` } : { label: 'workbench', href: '#/wb/videos' },
    { label: v.name }
  ]);

  const root = document.querySelector('[data-screen="editor"] .editor-host');
  root.innerHTML = `
    <div class="editor-topbar">
      <div class="editor-topbar-left">
        <div class="editor-vname">${escapeHtml(v.name)}</div>
        ${asset ? `<div class="editor-pub-pill">publicado em <strong>${escapeHtml(project.name)}</strong></div>` : `<div class="editor-pub-pill editor-pub-draft">rascunho</div>`}
      </div>
      <div class="editor-topbar-right">
        <button class="btn btn-ghost" data-action="back">‹ voltar</button>
        <button class="btn btn-primary" data-action="publish">${asset ? 'republicar' : 'publicar como asset'}</button>
      </div>
    </div>

    <div class="editor-body">
      <div class="editor-canvas">
        <div class="editor-stage" style="background: linear-gradient(135deg, hsl(${v.hue}, 30%, 18%), hsl(${v.hue}, 25%, 8%))">
          <div class="editor-frame-overlay">
            <div class="frame-corner tl"></div>
            <div class="frame-corner tr"></div>
            <div class="frame-corner bl"></div>
            <div class="frame-corner br"></div>
            <div class="editor-frame-label">PREVIEW · MOCK</div>
            <div class="editor-frame-letter" style="color:hsl(${v.hue}, 60%, 70%)">${v.name.slice(0, 2).toUpperCase()}</div>
          </div>
        </div>
        <div class="editor-transport">
          <button class="transport-btn">▶</button>
          <div class="transport-time">00:00 / 00:0${v.duration_s}</div>
          <div class="transport-bar">
            <div class="transport-fill"></div>
            <div class="transport-handle handle-in" style="left:0%"><span>in</span></div>
            <div class="transport-handle handle-out" style="left:100%"><span>out</span></div>
          </div>
          <div class="transport-mode">
            <button class="mode-btn ${state.mode === 'src' ? 'active' : ''}" data-mode="src">original</button>
            <button class="mode-btn ${state.mode === 'roto' ? 'active' : ''}" data-mode="roto">rotoscopia</button>
          </div>
        </div>
      </div>

      <aside class="editor-side">
        <div class="side-section">
          <div class="side-header"><div class="side-label">vídeo</div></div>
          <div class="kv-grid">
            <div class="kv-row"><div class="kv-key">origem</div><div class="kv-val">${({uploaded:'upload', url:'URL', 'generated-generic':'IA · genérico', 'generated-from-character':'IA · personagem'}[v.origin] || '—')}</div></div>
            <div class="kv-row"><div class="kv-key">duração</div><div class="kv-val">${v.duration_s}s</div></div>
            ${v.character_id ? `<div class="kv-row"><div class="kv-key">personagem</div><div class="kv-val">${escapeHtml(store.character(v.character_id)?.name || '—')}</div></div>` : ''}
            ${v.framing_id ? `<div class="kv-row"><div class="kv-key">enquadr.</div><div class="kv-val">${escapeHtml(store.framing(v.framing_id)?.name || '—')}</div></div>` : ''}
          </div>
        </div>

        <div class="side-section">
          <div class="side-header"><div class="side-label">parâmetros</div></div>
          <div class="param-row">
            <span class="param-key">fps</span>
            <input type="range" class="slider" min="6" max="24" step="1" value="${state.fps}" id="p-fps"/>
            <span class="param-val" id="p-fps-v">${state.fps}</span>
          </div>
          <div class="param-row">
            <span class="param-key">scale</span>
            <input type="range" class="slider" min="0.25" max="2" step="0.05" value="${state.scale}" id="p-scale"/>
            <span class="param-val" id="p-scale-v">${state.scale.toFixed(2)}×</span>
          </div>
          <div class="param-row">
            <span class="param-key">in</span>
            <input type="range" class="slider" min="0" max="${v.duration_s}" step="0.1" value="${state.in}" id="p-in"/>
            <span class="param-val" id="p-in-v">${state.in.toFixed(1)}s</span>
          </div>
          <div class="param-row">
            <span class="param-key">out</span>
            <input type="range" class="slider" min="0" max="${v.duration_s}" step="0.1" value="${state.out}" id="p-out"/>
            <span class="param-val" id="p-out-v">${state.out.toFixed(1)}s</span>
          </div>
        </div>

        <div class="side-section">
          <div class="side-header"><div class="side-label">preset</div></div>
          <div class="preset-list">
            ${['none', 'cga', 'magenta', 'amber', 'scanlines', 'glitch'].map(p => `
              <button class="preset ${state.preset === p ? 'active' : ''}" data-preset="${p}">
                <span class="preset-glyph">◇</span>
                <span>${p}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="side-section">
          <div class="side-header"><div class="side-label">exportar</div></div>
          <button class="btn btn-ghost" style="width:100%; justify-content:center" data-action="export-aseprite">baixar .aseprite (rascunho)</button>
          <p style="font-size:10px; color:var(--paper-4); margin-top:10px; line-height:1.6">
            “publicar como asset” gera o .aseprite, sobe pro storage e cria o asset em um projeto. é o ato deliberado de entrega.
          </p>
        </div>
      </aside>
    </div>
  `;

  // Bindings
  root.querySelector('[data-action="back"]').addEventListener('click', () => {
    if (project) go(`/p/${project.id}`);
    else go('/wb/videos');
  });
  root.querySelector('[data-action="publish"]').addEventListener('click', () => openPublishModal(v));
  root.querySelector('[data-action="export-aseprite"]').addEventListener('click', () => toast({ title: 'protótipo: download simulado', sub: `${v.name}.aseprite` }));

  ['fps', 'scale', 'in', 'out'].forEach(k => {
    const slider = root.querySelector(`#p-${k}`);
    const valEl = root.querySelector(`#p-${k}-v`);
    slider.addEventListener('input', (e) => {
      const num = +e.target.value;
      state[k] = num;
      valEl.textContent = k === 'fps' ? `${num}` : (k === 'scale' ? `${num.toFixed(2)}×` : `${num.toFixed(1)}s`);
    });
  });
  root.querySelectorAll('[data-preset]').forEach(b => {
    b.addEventListener('click', () => {
      state.preset = b.dataset.preset;
      root.querySelectorAll('[data-preset]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });
  root.querySelectorAll('[data-mode]').forEach(b => {
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      root.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });
}

// ---------- modal de publicar ----------
function openPublishModal(v) {
  const projects = store.projects();
  const existingAsset = store.videoAsset(v.id);
  const existingProject = existingAsset ? store.project(existingAsset.project_id) : null;

  const node = el(`
    <div class="modal modal-md">
      <div class="modal-head">
        <div class="modal-step">${existingAsset ? 'republicar' : 'publicar'}</div>
        <div class="modal-title">${existingAsset ? 'republicar asset' : 'publicar como asset'}</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        ${existingAsset
          ? `<p style="font-size:12px; color:var(--paper-2); line-height:1.7">esse vídeo já está publicado em <strong style="color:var(--copper)">${escapeHtml(existingProject.name)}</strong> como <strong>${escapeHtml(existingAsset.name)}</strong>. republicar <strong>sobrescreve</strong> o .aseprite. para publicar em outro projeto, <em style="color:var(--paper-3)">duplique o vídeo na workbench</em> e publique a duplicata.</p>`
          : `<p style="font-size:12px; color:var(--paper-2); line-height:1.7">na primeira publicação você escolhe o projeto-destino. depois disso, qualquer republicação sobrescreve o .aseprite no mesmo asset.</p>`
        }

        ${existingAsset ? '' : `
        <div class="field">
          <label class="field-label">projeto-destino</label>
          <div class="picker-grid" id="pub-projects">
            ${projects.map(p => `
              <div class="picker-card" data-pick-project="${p.id}">
                <div class="picker-thumb" style="background-image:url('${svgPlaceholder(p.id, p.name.slice(0,6).toUpperCase(), p.cover_hue)}')"></div>
                <div class="picker-name">${escapeHtml(p.name)}</div>
              </div>
            `).join('')}
            <div class="picker-card picker-new" data-pick-project="__new__">
              <div class="picker-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--paper-4);font-size:32px;font-family:var(--font-display);font-style:italic">+</div>
              <div class="picker-name">novo</div>
            </div>
          </div>
        </div>
        `}

        <div class="field">
          <label class="field-label">nome do asset</label>
          <input type="text" class="textarea" id="pub-name" value="${escapeHtml(existingAsset?.name || v.name)}" style="resize:none; min-height:42px;"/>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close>cancelar</button>
        <button class="btn btn-primary" id="pub-go" ${existingAsset ? '' : 'disabled'}>
          ${existingAsset ? 'republicar (sobrescreve)' : 'publicar'}
        </button>
      </div>
    </div>
  `);

  let chosenProject = existingAsset ? existingAsset.project_id : null;
  if (!existingAsset) {
    node.querySelectorAll('[data-pick-project]').forEach(card => {
      card.addEventListener('click', () => {
        const pid = card.dataset.pickProject;
        if (pid === '__new__') {
          // protótipo: cria projeto com nome temporário; user renomeia depois.
          const np = mutate.createProject({ name: `projeto ${new Date().toISOString().slice(5, 10)}`, summary: 'criado durante publicação' });
          toast({ title: 'projeto criado', sub: np.name });
          // fecha e reabre o modal pra refletir o novo projeto + já marca como escolhido
          closeModal();
          setTimeout(() => {
            openPublishModal(v);
            const m = document.querySelector('.modal-bg .modal');
            const c2 = m?.querySelector(`[data-pick-project="${np.id}"]`);
            c2?.click();
          }, 50);
          return;
        }
        chosenProject = pid;
        node.querySelectorAll('[data-pick-project]').forEach(c => c.classList.remove('current'));
        card.classList.add('current');
        node.querySelector('#pub-go').disabled = false;
      });
    });
  }

  node.querySelector('#pub-go').addEventListener('click', () => {
    const name = node.querySelector('#pub-name').value.trim() || v.name;
    const a = mutate.publishVideoAsAsset({ video_id: v.id, project_id: chosenProject, asset_name: name });
    closeModal();
    toast({ title: existingAsset ? 'asset republicado' : 'asset publicado', sub: `${a.name} → ${store.project(chosenProject).name}` });
    go(`/p/${chosenProject}`);
  });

  openModal(node);
}
