// Sistema simples de context menu.
// Uso:
//   showContextMenu(event, [
//     { label: 'baixar', icon: '↓', onClick: () => {...} },
//     { divider: true },
//     { label: 'apagar', icon: '×', danger: true, onClick: () => {...} },
//   ]);
//
// CSS posiciona; JS calcula clipping pra não sair da tela.

let activeMenu = null;
let outsideHandler = null;
let escHandler = null;

export function showContextMenu(event, items) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();

  const m = document.createElement('div');
  m.className = 'ctx-menu';
  for (const it of items) {
    if (it.divider) {
      const d = document.createElement('div');
      d.className = 'ctx-menu-divider';
      m.appendChild(d);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctx-menu-item' + (it.danger ? ' is-danger' : '') + (it.disabled ? ' is-disabled' : '');
    b.disabled = !!it.disabled;
    b.innerHTML = `
      <span class="ctx-menu-icon">${it.icon || ''}</span>
      <span class="ctx-menu-label">${escapeHtml(it.label)}</span>
      ${it.hint ? `<span class="ctx-menu-hint">${escapeHtml(it.hint)}</span>` : ''}
    `;
    b.addEventListener('click', () => {
      closeContextMenu();
      try { it.onClick?.(); } catch (e) { console.error(e); }
    });
    m.appendChild(b);
  }
  document.body.appendChild(m);

  // posição (clipa nas bordas)
  const margin = 4;
  const rect = m.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = event.clientX;
  let y = event.clientY;
  if (x + rect.width + margin > vw) x = vw - rect.width - margin;
  if (y + rect.height + margin > vh) y = vh - rect.height - margin;
  m.style.left = `${Math.max(margin, x)}px`;
  m.style.top = `${Math.max(margin, y)}px`;

  activeMenu = m;
  outsideHandler = (e) => {
    if (!m.contains(e.target)) closeContextMenu();
  };
  escHandler = (e) => { if (e.key === 'Escape') closeContextMenu(); };
  // próximo tick pra não consumir o click que abriu
  setTimeout(() => {
    document.addEventListener('mousedown', outsideHandler);
    document.addEventListener('contextmenu', outsideHandler);
    document.addEventListener('keydown', escHandler);
  }, 0);
}

export function closeContextMenu() {
  if (!activeMenu) return;
  activeMenu.remove();
  activeMenu = null;
  if (outsideHandler) document.removeEventListener('mousedown', outsideHandler);
  if (outsideHandler) document.removeEventListener('contextmenu', outsideHandler);
  if (escHandler) document.removeEventListener('keydown', escHandler);
  outsideHandler = null;
  escHandler = null;
}

window.addEventListener('blur', closeContextMenu);
window.addEventListener('resize', closeContextMenu);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
