try { require('dotenv').config(); } catch (_) { /* prod sem .env, ok */ }
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5031;

app.set('query parser', 'simple');

// min:1 mantém uma conexão sempre quente — primeira request do app não
// paga TLS handshake + auth (em VM com túnel IAP isso era 1-2s só de cold).
// max:25 cobre paralelismo do fe-prompts (até 15 simultaneas) + job runner
// de video (concurrency 3) + rotas normais sem starvation. Default eh 10.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: 1,
  max: 25,
  idleTimeoutMillis: 0,
});
app.locals.pool = pool;

// CRÍTICO: pg.Pool emite 'error' quando uma conexão idle morre (ex: túnel IAP
// cai). Sem listener, Node mata o processo. Em dev local com túnel instável
// isso era a causa real do "frontend trava no verificando token" — o backend
// morria silenciosamente e o /api/config nunca respondia. Logamos e seguimos.
pool.on('error', (err) => {
  console.error('[pg] idle client error (server segue vivo):', err.message);
});

// Garante que crashes de promessas órfãs não derrubem o processo.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

app.use(express.json({ limit: '1mb' }));

app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Cache-busting do index.html: injeta ?v=<startup_ts> em todos os
// <script src> e <link href>. O index sai com Cache-Control: no-store
// (sempre revalidado), mas os arquivos versionados podem cachear pra
// sempre — porque ?v muda no próximo deploy. Resolve dois problemas:
//   - dev: refresh sempre pega a versão nova de fe_editor.js etc.
//   - prod: visita seguinte do user pula 100% dos GETs de JS/CSS,
//           que era o que mais bloqueava percepção de loading.
const isDev = !!process.env.DEV_BYPASS;
const fs = require('fs');
const startupTs = Date.now();
const indexPath = path.join(__dirname, 'public', 'index.html');

app.get(['/', '/index.html'], (req, res) => {
  fs.readFile(indexPath, 'utf-8', (err, html) => {
    if (err) return res.status(500).send('falha ao ler index');
    const v = `v=${startupTs}`;
    const patched = html
      .replace(/(<script[^>]*\bsrc=")([^"?]+)(")/g, (_, a, src, c) => `${a}${src}?${v}${c}`)
      .replace(/(<link[^>]*\bhref=")(\.\/[^"?]+)(")/g, (_, a, src, c) => `${a}${src}?${v}${c}`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(patched);
  });
});

// Middleware de cache: precisa rodar ANTES do express.static pra ler o
// querystring (que express.static não passa pro setHeaders).
app.use((req, res, next) => {
  if (isDev) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
  } else if (/\.(js|css|woff2?|ttf|svg|png|jpg|jpeg|webp)$/i.test(req.path)) {
    // URL com ?v= veio do index versionado → pode cachear pra sempre.
    // URL sem ?v= é navegação direta (ou worker) → revalidar curto.
    if (req.query && req.query.v) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    }
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'roto-master' });
});

app.use('/api/config', require('./routes/config'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/assets', require('./routes/assets').router);
app.use('/api/models', require('./routes/models'));
app.use('/api/generate', require('./routes/generate'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/fe', require('./routes/fe'));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Error handler — captura erros do multer (LIMIT_FILE_SIZE etc.) e
// devolve JSON com mensagem clara em vez de 500 genérico.
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'arquivo muito grande (limite 200MB)' });
    }
    return res.status(400).json({ error: `upload: ${err.message}` });
  }
  console.error('unhandled error:', err);
  res.status(500).json({ error: err.message || 'internal error' });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`roto-master running on port ${PORT}`);
  // Esquenta o pool: SELECT 1 + cache de plan da listagem mais usada.
  // Sem isso, primeira chamada de /api/videos paga handshake + parser.
  try {
    await pool.query('SELECT 1');
    await pool.query('EXPLAIN SELECT 1 FROM videos ORDER BY updated_at DESC LIMIT 1');
  } catch (e) { /* warm-up best-effort */ }
  try {
    await require('./lib/job-runner').init(pool);
  } catch (e) {
    console.error('[jobs] init falhou:', e.message);
  }
});
