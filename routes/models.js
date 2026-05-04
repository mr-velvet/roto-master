// Catálogo de modelos. UI consome pra montar dropdowns + mostrar custo previsto.

const { Router } = require('express');
const { requireUser } = require('../middleware/auth');

const router = Router();

router.get('/', requireUser, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT key, name, step, provider, cost_per_unit, unit, default_params
         FROM models
        WHERE enabled = TRUE
        ORDER BY step, name`
    );
    res.json({ models: rows });
  } catch (e) {
    console.error('list models:', e);
    res.status(500).json({ error: 'list failed' });
  }
});

module.exports = router;
