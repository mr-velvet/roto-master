const { Router } = require('express');
const { requireUser } = require('../middleware/auth');
const { isMember, isOwner } = require('../middleware/membership');

const router = Router();

const PROJECT_COLS = `id, owner_sub, name, description, created_at, updated_at`;

// Lista projetos onde o usuário é membro.
router.get('/', requireUser, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT p.${PROJECT_COLS.split(', ').join(', p.')},
              pm.role AS my_role,
              (SELECT COUNT(*)::int FROM assets a WHERE a.project_id = p.id) AS asset_count,
              (SELECT COUNT(*)::int FROM project_members WHERE project_id = p.id) AS member_count
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
        WHERE pm.member_sub = $1
        ORDER BY p.updated_at DESC`,
      [req.user.sub]
    );
    res.json({ projects: rows });
  } catch (e) {
    console.error('list projects:', e);
    res.status(500).json({ error: 'list failed' });
  }
});

// Cria projeto + insere creator como owner em transação.
router.post('/', requireUser, async (req, res) => {
  const name = (req.body && typeof req.body.name === 'string' ? req.body.name : '').trim();
  if (!name) return res.status(400).json({ error: 'name é obrigatório' });
  if (name.length > 200) return res.status(400).json({ error: 'name muito longo (máx 200)' });
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : null;

  const client = await req.app.locals.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pRows } = await client.query(
      `INSERT INTO projects (owner_sub, name, description)
       VALUES ($1, $2, $3)
       RETURNING ${PROJECT_COLS}`,
      [req.user.sub, name, description]
    );
    const project = pRows[0];
    await client.query(
      `INSERT INTO project_members (project_id, member_sub, member_email, role, added_by)
       VALUES ($1, $2, $3, 'owner', $2)`,
      [project.id, req.user.sub, req.user.email || '']
    );
    await client.query('COMMIT');
    res.status(201).json({ project: { ...project, my_role: 'owner', asset_count: 0, member_count: 1 } });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('create project:', e);
    res.status(500).json({ error: 'create failed' });
  } finally {
    client.release();
  }
});

// Detalhe do projeto + lista de membros.
router.get('/:id', requireUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const m = await isMember(pool, req.params.id, req.user.sub);
    if (!m) return res.status(404).json({ error: 'não encontrado' });

    const { rows: pRows } = await pool.query(
      `SELECT ${PROJECT_COLS} FROM projects WHERE id = $1`,
      [req.params.id]
    );
    if (!pRows.length) return res.status(404).json({ error: 'não encontrado' });

    const { rows: members } = await pool.query(
      `SELECT member_sub, member_email, role, added_by, added_at
         FROM project_members WHERE project_id = $1 ORDER BY added_at ASC`,
      [req.params.id]
    );

    res.json({ project: { ...pRows[0], my_role: m.role }, members });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('get project:', e);
    res.status(500).json({ error: 'get failed' });
  }
});

// Renomear / atualizar descrição. Só owner pode.
router.patch('/:id', requireUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!(await isOwner(pool, req.params.id, req.user.sub))) {
      return res.status(403).json({ error: 'só owner pode editar' });
    }
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
    const { rows } = await pool.query(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${PROJECT_COLS}`,
      params
    );
    res.json({ project: rows[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('patch project:', e);
    res.status(500).json({ error: 'patch failed' });
  }
});

// Deletar projeto. Só owner. CASCADE em assets e project_members.
router.delete('/:id', requireUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!(await isOwner(pool, req.params.id, req.user.sub))) {
      return res.status(403).json({ error: 'só owner pode deletar' });
    }
    const { rowCount } = await pool.query(`DELETE FROM projects WHERE id = $1`, [req.params.id]);
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

// Adiciona membro por email. Só owner pode.
// v1: insere "pending:<email>" se o sub real não estiver no banco;
// auth.js resolve pro sub real no primeiro login.
router.post('/:id/members', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  const email = (req.body && typeof req.body.email === 'string' ? req.body.email : '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'email inválido' });
  if (email.length > 200) return res.status(400).json({ error: 'email muito longo' });

  try {
    if (!(await isOwner(pool, req.params.id, req.user.sub))) {
      return res.status(403).json({ error: 'só owner pode adicionar membros' });
    }

    // já existe linha com esse email (sub real ou pending)?
    const { rows: existing } = await pool.query(
      `SELECT member_sub, member_email, role FROM project_members
        WHERE project_id = $1 AND lower(member_email) = $2`,
      [req.params.id, email]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'usuário já é membro', member: existing[0] });
    }

    // tenta resolver pelo banco: alguém com esse email já logou em outro projeto?
    const { rows: known } = await pool.query(
      `SELECT DISTINCT member_sub FROM project_members
        WHERE lower(member_email) = $1 AND member_sub NOT LIKE 'pending:%'
        LIMIT 1`,
      [email]
    );
    const memberSub = known.length ? known[0].member_sub : `pending:${email}`;

    const { rows: ins } = await pool.query(
      `INSERT INTO project_members (project_id, member_sub, member_email, role, added_by)
       VALUES ($1, $2, $3, 'member', $4)
       RETURNING member_sub, member_email, role, added_by, added_at`,
      [req.params.id, memberSub, email, req.user.sub]
    );
    res.status(201).json({ member: ins[0], pending: memberSub.startsWith('pending:') });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    if (e.code === '23505') return res.status(409).json({ error: 'já é membro' });
    console.error('add member:', e);
    res.status(500).json({ error: 'add member failed' });
  }
});

// Remove membro. Só owner. Bloqueia remoção do último owner.
router.delete('/:id/members/:sub', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    if (!(await isOwner(pool, req.params.id, req.user.sub))) {
      return res.status(403).json({ error: 'só owner pode remover membros' });
    }
    const { rows: target } = await pool.query(
      `SELECT role FROM project_members WHERE project_id = $1 AND member_sub = $2`,
      [req.params.id, req.params.sub]
    );
    if (!target.length) return res.status(404).json({ error: 'membro não encontrado' });

    if (target[0].role === 'owner') {
      const { rows: counted } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM project_members
          WHERE project_id = $1 AND role = 'owner'`,
        [req.params.id]
      );
      if (counted[0].n <= 1) {
        return res.status(409).json({ error: 'não pode remover o último owner' });
      }
    }

    const { rowCount } = await pool.query(
      `DELETE FROM project_members WHERE project_id = $1 AND member_sub = $2`,
      [req.params.id, req.params.sub]
    );
    if (!rowCount) return res.status(404).json({ error: 'membro não encontrado' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('remove member:', e);
    res.status(500).json({ error: 'remove member failed' });
  }
});

module.exports = router;
