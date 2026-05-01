// Fluxo de auth via Logto. Espera SDK carregar, processa callback,
// expõe usuário e helper de fetch autenticado.

const LOGTO_ENDPOINT = 'https://auth.did.lu';
// Substituído após primeiro deploy (new-app.sh imprime o ID criado).
const LOGTO_APP_ID = '36iz4iomybe4r1n67a7jc';

let logtoClient = null;
let currentUser = null;
let accessToken = null;

export async function initAuth() {
  await new Promise((resolve) => {
    if (window.LogtoAuthClient) return resolve();
    const check = setInterval(() => {
      if (window.LogtoAuthClient) { clearInterval(check); resolve(); }
    }, 30);
  });

  if (LOGTO_APP_ID === '__LOGTO_APP_ID__') {
    return { authenticated: false, error: 'Logto App ID não configurado.' };
  }

  logtoClient = new window.LogtoAuthClient({
    endpoint: LOGTO_ENDPOINT,
    appId: LOGTO_APP_ID,
  });
  await logtoClient.handleCallback();

  if (!(await logtoClient.isAuthenticated())) {
    return { authenticated: false };
  }

  accessToken = await logtoClient.getAccessToken();
  const me = await fetch('/api/config', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!me.ok) {
    await logtoClient.signOut();
    return { authenticated: false };
  }
  currentUser = await me.json();
  return { authenticated: true, user: currentUser };
}

export async function signIn() { return logtoClient.signIn(); }
export async function signOut() { return logtoClient.signOut(); }
export function getUser() { return currentUser; }

export async function authedFetch(url, opts = {}) {
  if (!accessToken) throw new Error('not authenticated');
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${accessToken}` };
  return fetch(url, { ...opts, headers });
}
