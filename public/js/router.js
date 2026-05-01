// Roteador hash-based simples: #/list ou #/v/:id
// Notifica callbacks ao mudar de rota.

let onList = () => {};
let onVideo = () => {};

export function bindRouter(deps) {
  onList = deps.onList;
  onVideo = deps.onVideo;
}

function parseHash() {
  const h = window.location.hash || '#/list';
  if (h === '#/list' || h === '#/' || h === '#') return { route: 'list' };
  const m = h.match(/^#\/v\/([0-9a-f-]+)$/i);
  if (m) return { route: 'video', id: m[1] };
  return { route: 'list' };
}

function dispatch() {
  const r = parseHash();
  if (r.route === 'list') onList();
  else onVideo(r.id);
}

export function navigateList() {
  if (window.location.hash !== '#/list') window.location.hash = '#/list';
  else dispatch();
}
export function navigateVideo(id) {
  const target = `#/v/${id}`;
  if (window.location.hash !== target) window.location.hash = target;
  else dispatch();
}

export function startRouter() {
  window.addEventListener('hashchange', dispatch);
  dispatch();
}
