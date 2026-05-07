// Sistema de modais. Cada modal é um div data-modal="<nome>" hidden no HTML.
// API: openModal(name, opts), closeModal().

let activeModal = null;
const callbacks = {};

function getModal(name) {
  return document.querySelector(`[data-modal="${name}"]`);
}

export function openModal(name, opts = {}) {
  const m = getModal(name);
  if (!m) return console.warn('modal não encontrado:', name);
  if (activeModal && activeModal !== m) closeModal();
  m.removeAttribute('hidden');
  activeModal = m;
  callbacks[name] = opts;
  if (opts.onOpen) opts.onOpen(m);
  // foca primeiro input
  const firstInput = m.querySelector('input[type="text"], input[type="number"]');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

export function closeModal() {
  if (!activeModal) return;
  activeModal.setAttribute('hidden', '');
  const name = activeModal.getAttribute('data-modal');
  const cb = callbacks[name];
  if (cb && cb.onClose) cb.onClose();
  delete callbacks[name];
  activeModal = null;
}

// fecha ao clicar no backdrop ou em [data-action="modal-close"]
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action="modal-close"]');
  if (target) {
    e.preventDefault();
    closeModal();
  }
});

// ESC fecha
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeModal) closeModal();
});

// confirma com Enter em input dentro do modal
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !activeModal) return;
  if (!(e.target.tagName === 'INPUT' && e.target.type === 'text')) return;
  const primary = activeModal.querySelector('.btn-primary, .btn-publish');
  if (primary) {
    e.preventDefault();
    primary.click();
  }
});

// confirmModal é um modal SECUNDÁRIO que sobrepõe o activeModal sem fechá-lo.
// Razão: handlers em modais (ex: "jogar na lixeira" no detalhe do asset) chamavam
// await confirmModal(...) e quando o openModal fechava o modal principal, o
// onClose do principal zerava o estado (currentAsset = null), e o handler
// explodia silenciosamente ao tentar usar esse estado depois do confirm. Em vez
// de exigir que cada handler salve estado antes do confirm, o confirm agora
// não toca no activeModal — empilha por cima com z-index maior.
export function confirmModal({ title, message, danger = true, confirmLabel = 'apagar' }) {
  return new Promise((resolve) => {
    const m = getModal('confirm');
    m.querySelector('[data-bind="confirm-title"]').textContent = title;
    m.querySelector('[data-bind="confirm-msg"]').textContent = message;
    const btnYes = m.querySelector('[data-action="confirm-yes"]');
    btnYes.textContent = confirmLabel;
    btnYes.className = danger ? 'btn btn-danger' : 'btn btn-primary';

    let settled = false;
    const cleanup = () => {
      m.setAttribute('hidden', '');
      m.classList.remove('modal-stacked');
      btnYes.removeEventListener('click', onYes);
      m.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
    };
    const finish = (val) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };
    const onYes = (e) => { e.stopPropagation(); finish(true); };
    const onBackdrop = (e) => {
      if (e.target.closest('[data-action="modal-close"]')) {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    };

    btnYes.addEventListener('click', onYes);
    m.addEventListener('click', onBackdrop);
    // captura: precede o ESC handler global de closeModal pra ele não fechar
    // o modal principal por baixo.
    document.addEventListener('keydown', onKey, true);

    m.classList.add('modal-stacked');
    m.removeAttribute('hidden');
    setTimeout(() => btnYes.focus(), 50);
  });
}

// toast simples
let toastTimer = null;
export function showToast(msg, ms = 2500) {
  const t = document.querySelector('[data-bind="toast"]');
  if (!t) return;
  t.querySelector('[data-bind="toast-msg"]').textContent = msg;
  t.removeAttribute('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.setAttribute('hidden', ''), ms);
}
