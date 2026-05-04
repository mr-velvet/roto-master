// Hash router. Rotas:
//   #/              → home global (lista de projetos)
//   #/p/:id         → detalhe do projeto (lista de assets)
//   #/wb/videos     → workbench / vídeos
//   #/wb/characters → workbench / personagens
//   #/wb/framings   → workbench / enquadramentos
//   #/wb/cameras    → workbench / câmeras salvas
//   #/v/:id         → editor de vídeo (tela cheia)
//
// Modais NÃO viram rota — abrem como overlay e fecham via ESC ou backdrop.

const handlers = [];
let currentRoute = null;

export function on(pattern, handler) {
  // pattern: '/p/:id' → /^\/p\/([^/]+)$/
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([^/]+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  }) + '$');
  handlers.push({ pattern, re, keys, handler });
}

function parseHash() {
  const h = location.hash || '#/';
  return h.startsWith('#') ? h.slice(1) : h;
}

function dispatch() {
  const path = parseHash();
  for (const h of handlers) {
    const m = path.match(h.re);
    if (m) {
      const params = {};
      h.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
      currentRoute = { path, pattern: h.pattern, params };
      h.handler(params, path);
      return;
    }
  }
  // Rota desconhecida → home.
  location.hash = '#/';
}

export function start() {
  window.addEventListener('hashchange', dispatch);
  dispatch();
}

export function go(path) {
  if (path.startsWith('#')) path = path.slice(1);
  if (location.hash === '#' + path) {
    dispatch();
  } else {
    location.hash = '#' + path;
  }
}

export function current() { return currentRoute; }
