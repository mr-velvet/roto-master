const { Router } = require('express');
const { requireUser } = require('../middleware/auth');

const router = Router();

// Antes retornava userId/userEmail do Logto. Sem auth, retorna constante.
// Frontend ainda chama isso pra validar token; se chegou aqui, token OK.
router.get('/', requireUser, (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
