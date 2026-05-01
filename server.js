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

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`roto-master running on port ${PORT}`);
});
