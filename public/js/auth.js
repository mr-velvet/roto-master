// Auth simples: token único compartilhado, salvo em localStorage.
// Sem Logto, sem OAuth, sem expiração. Quem tem o token vê e mexe em tudo.
// Decisão (2026-05-05): time pequeno interno, fricção de login causou
// dor de cabeça desproporcional. Ver PROGRESS.md "Auth simples".
//
// Bypass agressivo pra dev local funcionar sempre:
//   - hostname inclui localhost/127.0.0.1/0.0.0.0/.local
//   - query string ?dev=1 (atalho universal)
//   - resposta de /api/config sem header é 200 (backend tá com DEV_BYPASS)
// Qualquer um acima → entra direto sem pedir token.

const TOKEN_KEY = 'roto-master.token';

function isDevHost() {
  const h = window.location.hostname;
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return true;
  if (h.endsWith('.local')) return true;
  if (h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('172.')) return true;
  if (new URLSearchParams(window.location.search).get('dev') === '1') return true;
  return false;
}

let token = null;

export async function initAuth() {
  // Antes de qualquer coisa: testa se o backend aceita request sem header.
  // Se 200, está em DEV_BYPASS no servidor — frontend só precisa entrar.
  // Isso resolve o caso de você abrir via IP da rede ou um domínio custom.
  try {
    const probe = await fetch('/api/config', { method: 'GET' });
    if (probe.ok) {
      token = 'dev-bypass';
      return { authenticated: true };
    }
  } catch (e) {
    // network error — segue pro fluxo normal
  }

  if (isDevHost()) {
    token = 'dev-bypass';
    return { authenticated: true };
  }

  // prod: precisa de token
  token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    const r = await fetch('/api/config', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) return { authenticated: true };
    localStorage.removeItem(TOKEN_KEY);
    token = null;
    return { authenticated: false, error: r.status === 401 ? 'token inválido' : `erro ${r.status}` };
  }
  return { authenticated: false, error: 'cole o token pra entrar' };
}

// Aceita um token vindo do prompt visual (login-screen). Valida e persiste.
export async function setTokenAndValidate(raw) {
  const v = (raw || '').trim();
  if (!v) return { ok: false, error: 'token vazio' };
  const r = await fetch('/api/config', { headers: { Authorization: `Bearer ${v}` } });
  if (!r.ok) return { ok: false, error: r.status === 401 ? 'token inválido' : `erro ${r.status}` };
  token = v;
  localStorage.setItem(TOKEN_KEY, v);
  return { ok: true };
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  token = null;
}

export function getToken() {
  return token;
}

export async function authedFetch(url, opts = {}) {
  if (!token || token === 'dev-bypass') return fetch(url, opts);
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
  return fetch(url, { ...opts, headers });
}
