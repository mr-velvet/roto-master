try { require('dotenv').config(); } catch (_) { /* prod sem .env, ok */ }
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5031;

app.set('query parser', 'simple');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.locals.pool = pool;

app.use(express.json({ limit: '1mb' }));

app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`roto-master running on port ${PORT}`);
});
