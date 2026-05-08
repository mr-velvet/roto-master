// Wrapper de auto-restart pro server.js. Sem deps externas.
// Se o server morrer (ex.: túnel IAP cai e o `pg.Pool` emite error não tratado),
// reinicia em 2s. Mantém vivo num ciclo de DX onde o user pode fechar/reabrir
// o browser sem se importar com o backend.
//
// Uso: node scripts/dev-loop.js
//
// Variáveis respeitadas: PORT, RESTART_DELAY_MS (default 2000)
//
// Bonus: pinga `gcloud compute start-iap-tunnel` se 127.0.0.1:5433 cair.
//        Isso evita o cenário "túnel cai → server quebra → restart eterno".

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RESTART_DELAY_MS = parseInt(process.env.RESTART_DELAY_MS, 10) || 2000;
let child = null;
let stopping = false;

function checkPort(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

async function ensureTunnel() {
  if (process.env.SKIP_TUNNEL === '1') return;
  const ok = await checkPort('127.0.0.1', 5433, 800);
  if (ok) return;
  console.log('[dev-loop] tunel IAP caiu — subindo de novo...');
  const gcloud = 'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd';
  spawn(gcloud, [
    'compute', 'start-iap-tunnel', 'adorable-claude', '5433',
    '--zone=us-central1-a', '--local-host-port=localhost:5433',
  ], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  // espera até 30s
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await checkPort('127.0.0.1', 5433, 800)) {
      console.log('[dev-loop] tunel pronto.');
      return;
    }
  }
  console.warn('[dev-loop] AVISO: tunel ainda nao subiu — server vai tentar mesmo assim.');
}

async function startServer() {
  await ensureTunnel();
  const port = process.env.PORT || '5070';
  process.env.PORT = port;
  console.log(`[dev-loop] iniciando server em http://localhost:${port}`);
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  child.on('exit', (code, sig) => {
    child = null;
    if (stopping) return;
    console.error(`[dev-loop] server saiu (code=${code} sig=${sig}). Reiniciando em ${RESTART_DELAY_MS}ms…`);
    setTimeout(startServer, RESTART_DELAY_MS);
  });
}

// graceful shutdown
['SIGINT', 'SIGTERM'].forEach((s) => {
  process.on(s, () => {
    stopping = true;
    if (child) try { child.kill(); } catch {}
    process.exit(0);
  });
});

// monitor periódico do túnel — se cair, ressuscita em background; o server
// pode até morrer no meio mas o auto-restart pega.
setInterval(() => { ensureTunnel().catch(() => {}); }, 30000);

startServer();
