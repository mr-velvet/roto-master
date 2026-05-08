// Endpoints da bandeja de notificações.
//
// GET  /api/jobs?status=...&since=...        lista visível (não-dispensada)
// POST /api/jobs/:id/dismiss                 marca dismissed_at=NOW()
// POST /api/jobs/dismiss-many                body: { ids: [] } — em batch
//
// Sem cancelamento de running (alinhado com decisão: Fal já cobrou).
// Jobs queued também não são canceláveis — modelo simples enquanto não vira
// problema real.

const { Router } = require('express');
const { requireUser } = require('../middleware/auth');

const router = Router();

const JOB_COLS = `id, kind, status, params, result, error_message,
                  cost_estimated, cost_actual, video_id,
                  started_at, completed_at, dismissed_at, created_at, updated_at`;

router.get('/', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  // status default: ativos + completados/falhados não dispensados.
  const statusFilter = (req.query.status || 'queued,running,completed,failed')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const since = req.query.since ? new Date(req.query.since) : null;
  const includeDismissed = req.query.include_dismissed === '1';

  const wheres = [];
  const args = [];
  if (statusFilter.length) {
    wheres.push(`status = ANY($${args.length + 1})`);
    args.push(statusFilter);
  }
  if (since && !Number.isNaN(since.getTime())) {
    wheres.push(`updated_at > $${args.length + 1}`);
    args.push(since.toISOString());
  }
  if (!includeDismissed) {
    wheres.push(`dismissed_at IS NULL`);
  }
  // Por enquanto: jobs de vídeo apenas (Frames Editor não usa esta tabela).
  wheres.push(`kind IN ('generate-video', 'generate-text-video')`);

  const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT ${JOB_COLS} FROM jobs ${where}
        ORDER BY created_at DESC
        LIMIT 100`,
      args
    );
    res.json({ jobs: rows });
  } catch (e) {
    console.error('jobs list:', e.message);
    res.status(500).json({ error: 'falha ao listar' });
  }
});

router.post('/:id/dismiss', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const { rowCount } = await pool.query(
      `UPDATE jobs SET dismissed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND dismissed_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'job não encontrado ou já dispensado' });
    res.json({ ok: true });
  } catch (e) {
    console.error('jobs dismiss:', e.message);
    res.status(500).json({ error: 'falha ao dispensar' });
  }
});

router.post('/dismiss-many', requireUser, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.json({ ok: true, count: 0 });
  const pool = req.app.locals.pool;
  try {
    const { rowCount } = await pool.query(
      `UPDATE jobs SET dismissed_at = NOW(), updated_at = NOW()
        WHERE id = ANY($1) AND dismissed_at IS NULL`,
      [ids]
    );
    res.json({ ok: true, count: rowCount });
  } catch (e) {
    console.error('jobs dismiss-many:', e.message);
    res.status(500).json({ error: 'falha ao dispensar' });
  }
});

module.exports = router;
