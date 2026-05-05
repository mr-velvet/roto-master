// Wrapper do yt-dlp pra obter streaming URL e extrair trechos sem baixar
// o vídeo inteiro. Usado pelo Fluxo B (vídeo de URL/YouTube).
//
// Em prod (Linux): yt-dlp e ffmpeg estão no PATH (instalados via Dockerfile).
// Em dev local (Windows): caminhos absolutos via env YTDLP_BIN / FFMPEG_DIR.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const FFMPEG_DIR = process.env.FFMPEG_DIR || ''; // se vazio, usa PATH

function spawnYtDlp(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (FFMPEG_DIR) {
      const sep = process.platform === 'win32' ? ';' : ':';
      env.PATH = `${env.PATH}${sep}${FFMPEG_DIR}`;
    }
    const child = spawn(YTDLP_BIN, args, { env, ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const tail = stderr.split('\n').filter((l) => l.toLowerCase().startsWith('error')).slice(-3).join(' | ') || stderr.slice(-300);
        reject(new Error(`yt-dlp exit ${code}: ${tail}`));
      } else resolve({ stdout, stderr });
    });
  });
}

// Pega URL direta de streaming do CDN (ex: googlevideo.com).
// Tocável em <video> HTML5 com formato mp4 + h264.
// Expira em ~6h — frontend deve re-pedir em caso de 403.
async function getStreamUrl(url) {
  const args = [
    '-g',
    '-f', 'best[ext=mp4][vcodec*=avc1][height<=720]/best[ext=mp4][height<=720]/best',
    '--no-playlist',
    '--no-warnings',
    url,
  ];
  const { stdout } = await spawnYtDlp(args);
  const lines = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) throw new Error('yt-dlp: sem URL no stdout');
  // -g pode retornar 1 (combined) ou 2 linhas (video + audio); pegamos a primeira.
  return lines[0];
}

// Detecta se URL é do YouTube. Outros sites (Vimeo, etc.) podem entrar depois.
function isYouTube(url) {
  try {
    const u = new URL(url);
    return /(^|\.)youtube\.com$/.test(u.hostname) || /(^|\.)youtu\.be$/.test(u.hostname);
  } catch { return false; }
}

// Metadata leve (título, duração, thumb) sem baixar nada.
// Usa --dump-json. Pra YouTube poderíamos usar oEmbed (mais leve) — fica
// pra depois, manter um caminho só simplifica.
async function getInfo(url) {
  const args = [
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    '--skip-download',
    url,
  ];
  const { stdout } = await spawnYtDlp(args);
  const data = JSON.parse(stdout);
  return {
    id: data.id,
    title: data.title,
    duration_s: data.duration,
    thumbnail: data.thumbnail,
    width: data.width,
    height: data.height,
  };
}

// Baixa SÓ o trecho [in_s, out_s] via --download-sections + --force-keyframes-at-cuts.
// Resultado: arquivo .mp4 local com exatamente o intervalo. Caller sobe pro GCS.
async function extractSection(url, in_s, out_s) {
  const dur = out_s - in_s;
  if (dur <= 0) throw new Error('intervalo inválido');
  if (dur > 30) throw new Error(`trecho muito longo (${dur.toFixed(1)}s) — máx 30s`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roto-extract-'));
  const outFile = path.join(tmpDir, 'cut.mp4');
  const range = `*${in_s.toFixed(2)}-${out_s.toFixed(2)}`;
  const args = [
    '--download-sections', range,
    '--force-keyframes-at-cuts',
    '-f', 'best[ext=mp4][vcodec*=avc1][height<=720]/best[ext=mp4][height<=720]/best',
    '--no-playlist',
    '--no-warnings',
    '-o', outFile,
    url,
  ];
  try {
    await spawnYtDlp(args);
    const buffer = await fs.readFile(outFile);
    return { buffer, contentType: 'video/mp4', tmpDir };
  } finally {
    // limpa temporário (assíncrono best-effort)
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { getStreamUrl, getInfo, extractSection, isYouTube };
