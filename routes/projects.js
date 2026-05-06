const { Router } = require('express');
const { requireUser } = require('../middleware/auth');

const router = Router();

const PROJECT_COLS = `id, name, description, created_at, updated_at`;

// Lista todos os projetos. Sem filtro de membership — quem tem o token vê tudo.
router.get('/', requireUser, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT ${PROJECT_COLS},
              (SELECT COUNT(*)::int FROM assets a WHERE a.project_id = projects.id) AS asset_count
         FROM projects
        ORDER BY updated_at DESC`
    );
    res.json({ projects: rows });
  } catch (e) {
    console.error('list projects:', e);
    res.status(500).json({ error: 'list failed' });
  }
});

router.post('/', requireUser, async (req, res) => {
  const name = (req.body && typeof req.body.name === 'string' ? req.body.name : '').trim();
  if (!name) return res.status(400).json({ error: 'name é obrigatório' });
  if (name.length > 200) return res.status(400).json({ error: 'name muito longo (máx 200)' });
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : null;

  try {
    const { rows } = await req.app.locals.pool.query(
      `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING ${PROJECT_COLS}`,
      [name, description]
    );
    res.status(201).json({ project: { ...rows[0], asset_count: 0 } });
  } catch (e) {
    console.error('create project:', e);
    res.status(500).json({ error: 'create failed' });
  }
});

router.get('/:id', requireUser, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT ${PROJECT_COLS} FROM projects WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    res.json({ project: rows[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('get project:', e);
    res.status(500).json({ error: 'get failed' });
  }
});

router.patch('/:id', requireUser, async (req, res) => {
  try {
    const updates = [];
    const params = [];
    let idx = 1;
    if (typeof req.body.name === 'string') {
      const n = req.body.name.trim();
      if (!n || n.length > 200) return res.status(400).json({ error: 'name inválido' });
      updates.push(`name = $${idx++}`); params.push(n);
    }
    if (typeof req.body.description === 'string') {
      updates.push(`description = $${idx++}`); params.push(req.body.description.trim() || null);
    }
    if (!updates.length) return res.status(400).json({ error: 'nada pra atualizar' });
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const { rows } = await req.app.locals.pool.query(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${PROJECT_COLS}`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    res.json({ project: rows[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('patch project:', e);
    res.status(500).json({ error: 'patch failed' });
  }
});

router.delete('/:id', requireUser, async (req, res) => {
  try {
    const { rowCount } = await req.app.locals.pool.query(
      `DELETE FROM projects WHERE id = $1`,
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'não encontrado' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    if (e.code === '23503') {
      return res.status(409).json({ error: 'projeto tem assets publicados; despublique antes' });
    }
    console.error('delete project:', e);
    res.status(500).json({ error: 'delete failed' });
  }
});

module.exports = router;
