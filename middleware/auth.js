// Auth simples: bate `Authorization: Bearer <token>` contra APP_TOKEN do env.
// Sem usuário, sem sessão, sem owner. Quem tem o token vê e mexe em tudo.
// Decisão deliberada (2026-05-05): ferramenta interna, time pequeno, fricção
// de login causou dor de cabeça desproporcional. Ver PROGRESS.md "Auth simples".

const APP_TOKEN = process.env.APP_TOKEN;
const DEV_BYPASS = process.env.DEV_BYPASS === '1';

if (!APP_TOKEN && !DEV_BYPASS) {
  console.warn('[auth] APP_TOKEN não definido — todas as requests vão dar 500');
}
if (DEV_BYPASS) {
  console.log('[auth] DEV_BYPASS=1 — pulando validação de token');
}

function requireUser(req, res, next) {
  if (DEV_BYPASS) return next();
  if (!APP_TOKEN) return res.status(500).json({ error: 'APP_TOKEN não configurado no servidor' });
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'token obrigatório' });
  if (h.slice(7) !== APP_TOKEN) return res.status(401).json({ error: 'token inválido' });
  next();
}

module.exports = { requireUser };
