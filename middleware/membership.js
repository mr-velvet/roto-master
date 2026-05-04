// Helpers de membership de projeto.
// Workbench (videos, personagens, etc.) é escopada por owner_sub direto.
// Projetos e seus assets são compartilhados via project_members.

async function isMember(pool, projectId, sub) {
  const { rows } = await pool.query(
    `SELECT role FROM project_members WHERE project_id = $1 AND member_sub = $2`,
    [projectId, sub]
  );
  return rows[0] || null;
}

async function isOwner(pool, projectId, sub) {
  const m = await isMember(pool, projectId, sub);
  return m && m.role === 'owner';
}

module.exports = { isMember, isOwner };
