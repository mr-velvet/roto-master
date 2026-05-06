// Roteador hash-based.
// Rotas:
//   #/                    → galeria, home (lista de projetos)
//   #/p/:project_id       → galeria, detalhe do projeto
//   #/trash               → lixeira global (assets descartados)
//   #/atelie              → ateliê, default = vídeos
//   #/atelie/videos       → ateliê, vídeos
//   #/atelie/generate     → ateliê, fluxo C (imagem → vídeo)
//   #/atelie/text2video   → ateliê, fluxo D (texto → vídeo)
//   #/v/:video_id         → editor

let handlers = {
  onHome: () => {},
  onProject: () => {},
  onTrash: () => {},
  onAtelie: () => {},
  onGenerate: () => {},
  onTextVideo: () => {},
  onEditor: () => {},
};

export function bindRouter(deps) {
  handlers = { ...handlers, ...deps };
}

function parseHash() {
  const h = window.location.hash || '#/';
  if (h === '#/' || h === '#' || h === '') return { route: 'home' };

  let m;
  if ((m = h.match(/^#\/p\/([0-9a-f-]+)$/i))) return { route: 'project', id: m[1] };
  if ((m = h.match(/^#\/v\/([0-9a-f-]+)$/i))) return { route: 'editor', id: m[1] };
  if (h === '#/trash') return { route: 'trash' };
  if (h === '#/atelie/generate') return { route: 'generate' };
  if (h === '#/atelie/text2video') return { route: 'text-video' };
  if (h === '#/atelie' || h === '#/atelie/videos') return { route: 'atelie', sub: 'videos' };

  return { route: 'home' };
}

function dispatch() {
  const r = parseHash();
  if (r.route === 'home') handlers.onHome();
  else if (r.route === 'project') handlers.onProject(r.id);
  else if (r.route === 'trash') handlers.onTrash();
  else if (r.route === 'atelie') handlers.onAtelie(r.sub);
  else if (r.route === 'generate') handlers.onGenerate();
  else if (r.route === 'text-video') handlers.onTextVideo();
  else if (r.route === 'editor') handlers.onEditor(r.id);
}

export function navigateHome() {
  setHash('#/');
}
export function navigateProject(id) {
  setHash(`#/p/${id}`);
}
export function navigateTrash() {
  setHash('#/trash');
}
export function navigateAtelie(sub = 'videos') {
  setHash(`#/atelie/${sub}`);
}
export function navigateGenerate() {
  setHash('#/atelie/generate');
}
export function navigateTextVideo() {
  setHash('#/atelie/text2video');
}
export function navigateEditor(id) {
  setHash(`#/v/${id}`);
}

function setHash(target) {
  if (window.location.hash !== target) window.location.hash = target;
  else dispatch();
}

export function currentRoute() {
  return parseHash();
}

export function startRouter() {
  window.addEventListener('hashchange', dispatch);
  dispatch();
}
