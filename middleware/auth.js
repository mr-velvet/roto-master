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
    next();
  } catch (err) {
    console.error('Token validation failed:', err.message);
    return res.status(401).json({ error: 'Token validation failed' });
  }
}

module.exports = { requireUser };
