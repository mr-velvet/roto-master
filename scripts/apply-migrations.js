// Aplica migrations pendentes contra o DATABASE_URL configurado.
// Cria tabela _migrations se não existir, lista as já aplicadas,
// roda as faltantes em ordem alfabética.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id serial PRIMARY KEY,
      filename text UNIQUE NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await pool.query('SELECT filename FROM _migrations');
  const applied = new Set(rows.map(r => r.filename));

  for (const f of files) {
    if (applied.has(f)) {
      console.log(`[skip] ${f}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log(`[apply] ${f}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations(filename) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log(`[ok] ${f}`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`[fail] ${f}:`, e.message);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log('done');
})();
