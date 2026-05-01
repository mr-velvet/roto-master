const { Router } = require('express');
const { requireUser } = require('../middleware/auth');

const router = Router();

router.get('/', requireUser, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT id, name, gcs_url, size_bytes, duration_s, width, height,
              edit_state, share_id, created_at, updated_at
         FROM videos
        WHERE owner_sub = $1
        ORDER BY updated_at DESC`,
      [req.user.sub]
    );
    res.json({ videos: rows });
  } catch (e) {
    console.error('list videos:', e);
    res.status(500).json({ error: 'list failed' });
  }
});

router.post('/', requireUser, async (req, res) => {
  const name = (req.body && typeof req.body.name === 'string' ? req.body.name : '').trim();
  if (!name) return res.status(400).json({ error: 'name é obrigatório' });
  if (name.length > 200) return res.status(400).json({ error: 'name muito longo (máx 200)' });
  try {
    const { rows } = await req.app.locals.pool.query(
      `INSERT INTO videos (owner_sub, owner_email, name, gcs_path, gcs_url)
       VALUES ($1, $2, $3, '', '')
       RETURNING id, name, gcs_url, size_bytes, duration_s, width, height,
                 edit_state, share_id, created_at, updated_at`,
      [req.user.sub, req.user.email || '', name]
    );
    res.status(201).json({ video: rows[0] });
  } catch (e) {
    console.error('create video:', e);
    res.status(500).json({ error: 'create failed' });
  }
});

router.get('/:id', requireUser, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT id, name, gcs_url, size_bytes, duration_s, width, height,
              edit_state, share_id, created_at, updated_at
         FROM videos
        WHERE id = $1 AND owner_sub = $2`,
      [req.params.id, req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    res.json({ video: rows[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('get video:', e);
    res.status(500).json({ error: 'get failed' });
  }
});

router.patch('/:id', requireUser, async (req, res) => {
  const updates = [];
  const params = [];
  let idx = 1;
  if (typeof req.body.name === 'string') {
    const n = req.body.name.trim();
    if (!n || n.length > 200) return res.status(400).json({ error: 'name inválido' });
    updates.push(`name = $${idx++}`); params.push(n);
  }
  if (req.body.edit_state && typeof req.body.edit_state === 'object') {
    updates.push(`edit_state = $${idx++}`); params.push(req.body.edit_state);
  }
  if (!updates.length) return res.status(400).json({ error: 'nada pra atualizar' });
  updates.push(`updated_at = NOW()`);
  params.push(req.params.id, req.user.sub);
  try {
    const { rows } = await req.app.locals.pool.query(
      `UPDATE videos SET ${updates.join(', ')}
        WHERE id = $${idx++} AND owner_sub = $${idx}
        RETURNING id, name, gcs_url, size_bytes, duration_s, width, height,
                  edit_state, share_id, created_at, updated_at`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    res.json({ video: rows[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('patch video:', e);
    res.status(500).json({ error: 'patch failed' });
  }
});

router.delete('/:id', requireUser, async (req, res) => {
  try {
    const { rowCount } = await req.app.locals.pool.query(
      `DELETE FROM videos WHERE id = $1 AND owner_sub = $2`,
      [req.params.id, req.user.sub]
    );
    if (!rowCount) return res.status(404).json({ error: 'não encontrado' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('delete video:', e);
    res.status(500).json({ error: 'delete failed' });
  }
});

module.exports = router;
