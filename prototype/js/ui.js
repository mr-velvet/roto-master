// Helpers de UI: modais custom, toasts, confirm. Nada nativo do browser.

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// ---------- modal ----------
export function openModal(node) {
  closeModal();
  const bg = el(`<div class="modal-bg open"></div>`);
  bg.appendChild(node);
  document.body.appendChild(bg);
  // Click no backdrop fecha
  bg.addEventListener('click', (e) => {
    if (e.target === bg) closeModal();
  });
  // Bind do botão close (data-close ou .modal-close)
  bg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
  });
  return bg;
}

export function closeModal() {
  document.querySelectorAll('.modal-bg').forEach(b => b.remove());
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ---------- confirm modal ----------
export function confirmModal({ title, body, danger = false, confirmLabel = 'confirmar', cancelLabel = 'cancelar' }) {
  return new Promise((resolve) => {
    const node = el(`
      <div class="modal modal-sm">
        <div class="modal-head">
          <div class="modal-title">${escapeHtml(title)}</div>
          <button class="modal-close" data-close>×</button>
        </div>
        <div class="modal-body">
          <p style="font-size:12px; line-height:1.55; color:var(--paper-2)">${escapeHtml(body)}</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="cancel">${escapeHtml(cancelLabel)}</button>
          <button class="btn ${danger ? '' : 'btn-primary'}" data-action="confirm" ${danger ? 'style="background:var(--rust);border-color:var(--rust);color:var(--paper)"' : ''}>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `);
    node.querySelector('[data-action="cancel"]').onclick = () => { closeModal(); resolve(false); };
    node.querySelector('[data-action="confirm"]').onclick = () => { closeModal(); resolve(true); };
    openModal(node);
  });
}

// ---------- toast ----------
function ensureToastStack() {
  let s = document.querySelector('.toast-stack');
  if (!s) {
    s = el(`<div class="toast-stack"></div>`);
    document.body.appendChild(s);
  }
  return s;
}

export function toast({ title, sub, glyph = '✓', timeout = 3500 }) {
  const stack = ensureToastStack();
  const t = el(`
    <div class="toast">
      <div class="toast-glyph">${glyph}</div>
      <div class="toast-body">
        <div class="toast-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="toast-sub">${escapeHtml(sub)}</div>` : ''}
      </div>
    </div>
  `);
  stack.appendChild(t);
  setTimeout(() => {
    t.classList.add('fade-out');
    setTimeout(() => t.remove(), 350);
  }, timeout);
}

// ---------- breadcrumbs (chrome center) ----------
export function setCrumbs(crumbs) {
  // crumbs: [{label, href}]  — último é "active".
  const c = document.querySelector('.chrome-center');
  if (!c) return;
  c.innerHTML = crumbs.map((cb, i) => {
    const last = i === crumbs.length - 1;
    const sep = i > 0 ? `<span class="crumb-sep">›</span>` : '';
    if (cb.href && !last) {
      return `${sep}<a href="${cb.href}" class="crumb">${escapeHtml(cb.label)}</a>`;
    }
    return `${sep}<span class="crumb ${last ? 'crumb-active' : ''}">${escapeHtml(cb.label)}</span>`;
  }).join('');
}

// ---------- ativação de uma "screen" (troca classe no body) ----------
export function showScreen(name) {
  const body = document.body;
  // Remove qualquer screen-* atual
  [...body.classList].forEach(c => {
    if (c.startsWith('screen-')) body.classList.remove(c);
  });
  body.classList.add('screen-' + name);
  // Scroll pro topo do screen-inner
  document.querySelectorAll('.screen-inner').forEach(s => { s.scrollTop = 0; });
}

// ---------- format helpers ----------
export function fmtDate(iso) {
  if (!iso) return '—';
  return iso; // já é YYYY-MM-DD
}

export function fmtRelative(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diff < 1) return 'hoje';
  if (diff === 1) return 'ontem';
  if (diff < 7) return `há ${diff} dias`;
  if (diff < 30) return `há ${Math.floor(diff / 7)} sem`;
  return iso;
}

// SVG placeholder reaproveitado de seed.js
export { svgPlaceholder } from './seed.js';
