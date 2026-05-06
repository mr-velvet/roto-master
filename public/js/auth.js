// Auth simples: token único compartilhado, salvo em localStorage.
// Sem Logto, sem OAuth, sem expiração. Quem tem o token vê e mexe em tudo.
// Decisão (2026-05-05): time pequeno interno, fricção de login causou
// dor de cabeça desproporcional. Ver PROGRESS.md "Auth simples".

const TOKEN_KEY = 'roto-master.token';
const DEV_BYPASS = ['localhost', '127.0.0.1'].includes(window.location.hostname);

let token = null;

export async function initAuth() {
  if (DEV_BYPASS) {
    // Em dev local o backend já bypassa via DEV_BYPASS=1; manda qualquer
    // string só pra não dar throw em authedFetch.
    token = 'dev-bypass';
    return { authenticated: true };
  }
  token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    const v = window.prompt('Cole o token de acesso (compartilhado pelo time):');
    if (!v || !v.trim()) return { authenticated: false, error: 'token vazio' };
    token = v.trim();
    localStorage.setItem(TOKEN_KEY, token);
  }
  // Valida contra /api/config — se 401, limpa e pede de novo.
  const r = await fetch('/api/config', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    localStorage.removeItem(TOKEN_KEY);
    token = null;
    return { authenticated: false, error: r.status === 401 ? 'token inválido' : `erro ${r.status}` };
  }
  return { authenticated: true };
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  token = null;
}

export async function authedFetch(url, opts = {}) {
  if (DEV_BYPASS) return fetch(url, opts);
  if (!token) throw new Error('not authenticated');
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
  return fetch(url, { ...opts, headers });
}
