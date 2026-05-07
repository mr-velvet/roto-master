// Chrome global: alternador Galeria/Ateliê + breadcrumb + transição animada.
// Atributos no <body>:
//   data-space = "galeria" | "atelie"
//   data-screen = "home" | "project" | "atelie" | "editor"

const $body = document.body;
const $spaceName = document.querySelector('[data-bind="space-name"]');
const $breadcrumb = document.querySelector('[data-bind="breadcrumb"]');
const $transition = document.querySelector('[data-bind="transition"]');
const $transitionLabel = document.querySelector('[data-bind="transition-label"]');
const $switchBtns = document.querySelectorAll('[data-action="goto-space"]');

let onSwitchSpace = null;

export function bindChrome(handlers) {
  onSwitchSpace = handlers.onSwitchSpace;
  $switchBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      // Click no botão sempre vai pra raiz daquele espaço — mesmo se você já
      // está nele. Sem isso, estar em /trash ou /p/:id não te deixa voltar pra
      // raiz da Galeria sem dar uma volta pelo Ateliê.
      const target = btn.getAttribute('data-space');
      onSwitchSpace?.(target);
    });
  });
}

// chama com space="galeria"|"atelie" e screen="home"|"project"|"atelie"|"editor"
export function setSpace(space, screen) {
  const prevSpace = $body.getAttribute('data-space');
  $body.setAttribute('data-space', space);
  $body.setAttribute('data-screen', screen);
  $spaceName.textContent = space === 'galeria' ? 'Galeria' : 'Ateliê';

  $switchBtns.forEach((btn) => {
    const isActive = btn.getAttribute('data-space') === space;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  // anima transição apenas quando o espaço muda de fato
  if (prevSpace && prevSpace !== space) {
    playTransition(space);
  }
}

export function setBreadcrumb(items) {
  // items = [{ label, action? }]
  $breadcrumb.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    if (item.action) {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.style.background = 'none';
      btn.style.border = 0;
      btn.style.color = 'inherit';
      btn.style.font = 'inherit';
      btn.style.cursor = 'pointer';
      btn.style.padding = 0;
      btn.addEventListener('click', item.action);
      li.appendChild(btn);
    } else {
      li.textContent = item.label;
    }
    $breadcrumb.appendChild(li);
  });
}

function playTransition(targetSpace) {
  $transitionLabel.textContent = targetSpace === 'galeria' ? 'Galeria' : 'Ateliê';
  $transition.classList.add('is-on');
  $transition.setAttribute('data-target', targetSpace);
  setTimeout(() => $transition.classList.remove('is-on'), 480);
}
