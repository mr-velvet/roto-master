const { Router } = require('express');
const { requireUser } = require('../middleware/auth');

const router = Router();

const FOLDER_COLS = `id, nome, created_at, updated_at`;

// GET /api/folders — lista pastas com count de videos em cada uma.
// Frontend usa pra montar a sidebar do Atelie. Conta tambem inclui a raiz
// (folder_id IS NULL) como entry separada — o front trata como item especial.
router.get('/', requireUser, async (req, res) => {
  try {
    const { rows: folders } = await req.app.locals.pool.query(
      `SELECT f.${FOLDER_COLS.replace(/, /g, ', f.')},
              COALESCE(c.n, 0)::int AS video_count
         FROM video_folders f
         LEFT JOIN (
           SELECT folder_id, COUNT(*)::int AS n
             FROM videos
            WHERE folder_id IS NOT NULL
            GROUP BY folder_id
         ) c ON c.folder_id = f.id
        ORDER BY LOWER(f.nome) ASC`
    );
    const { rows: raiz } = await req.app.locals.pool.query(
      `SELECT COUNT(*)::int AS n FROM videos WHERE folder_id IS NULL`
    );
    res.json({ folders, root_count: raiz[0].n });
  } catch (e) {
    console.error('list folders:', e);
    res.status(500).json({ error: 'list failed' });
  }
});

// POST /api/folders { nome } — cria pasta. 409 se nome ja existe (case-insens).
router.post('/', requireUser, async (req, res) => {
  const nome = (req.body && typeof req.body.nome === 'string' ? req.body.nome : '').trim();
  if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });
  if (nome.length > 80) return res.status(400).json({ error: 'nome muito longo (máx 80)' });
  try {
    const { rows } = await req.app.locals.pool.query(
      `INSERT INTO video_folders (nome) VALUES ($1) RETURNING ${FOLDER_COLS}`,
      [nome]
    );
    res.status(201).json({ folder: { ...rows[0], video_count: 0 } });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'já existe uma pasta com esse nome' });
    }
    console.error('create folder:', e);
    res.status(500).json({ error: 'create failed' });
  }
});

// PATCH /api/folders/:id { nome } — renomeia.
router.patch('/:id', requireUser, async (req, res) => {
  const nome = (req.body && typeof req.body.nome === 'string' ? req.body.nome : '').trim();
  if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });
  if (nome.length > 80) return res.status(400).json({ error: 'nome muito longo (máx 80)' });
  try {
    const { rows } = await req.app.locals.pool.query(
      `UPDATE video_folders SET nome = $1, updated_at = NOW()
        WHERE id = $2 RETURNING ${FOLDER_COLS}`,
      [nome, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'pasta não encontrada' });
    res.json({ folder: rows[0] });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'já existe uma pasta com esse nome' });
    }
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('rename folder:', e);
    res.status(500).json({ error: 'rename failed' });
  }
});

// DELETE /api/folders/:id — apaga pasta. Videos voltam pra raiz via
// ON DELETE SET NULL da FK; nao deletamos videos.
router.delete('/:id', requireUser, async (req, res) => {
  try {
    const { rowCount } = await req.app.locals.pool.query(
      `DELETE FROM video_folders WHERE id = $1`,
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'pasta não encontrada' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('delete folder:', e);
    res.status(500).json({ error: 'delete failed' });
  }
});

module.exports = router;
