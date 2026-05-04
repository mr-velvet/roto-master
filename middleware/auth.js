const LOGTO_ENDPOINT = process.env.LOGTO_ENDPOINT || 'https://auth.did.lu';

async function requireUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.slice(7);
  try {
    const response = await fetch(`${LOGTO_ENDPOINT}/oidc/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return res.status(401).json({ error: 'Invalid token' });
    const profile = await response.json();
    if (!profile.sub) return res.status(401).json({ error: 'Token has no subject' });
    req.user = {
      sub: profile.sub,
      email: profile.email || null,
      name: profile.name || null,
      picture: profile.picture || null,
    };
    // resolve convites "pending:<email>" pro sub real do usuário logado
    if (req.user.email) {
      const pool = req.app.locals.pool;
      if (pool) {
        try {
          await pool.query(
            `UPDATE project_members
                SET member_sub = $1
              WHERE member_sub = $2
                AND NOT EXISTS (
                  SELECT 1 FROM project_members pm2
                   WHERE pm2.project_id = project_members.project_id
                     AND pm2.member_sub = $1
                )`,
            [req.user.sub, `pending:${req.user.email.toLowerCase()}`]
          );
        } catch (err) {
          console.warn('resolve pending invites failed:', err.message);
        }
      }
    }
    next();
  } catch (err) {
    console.error('Token validation failed:', err.message);
    return res.status(401).json({ error: 'Token validation failed' });
  }
}

module.exports = { requireUser };
