const { Router } = require('express');
const multer = require('multer');
const { requireUser } = require('../middleware/auth');
const { isMember } = require('../middleware/membership');
const { uploadBuffer } = require('../lib/gcs');

const router = Router();

// .aseprite tipicamente <5MB; manter folga.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const ASSET_COLS = `id, project_id, video_id, owner_sub, name, status, gcs_path, gcs_url, version, created_at, updated_at`;

function asepritePath(assetId, version) {
  return `roto-master/assets/${assetId}/v${version}/${assetId}.aseprite`;
}

// Lista assets de projetos onde o usuário é membro.
router.get('/', requireUser, async (req, res) => {
  const projectId = req.query.project_id;
  const status = req.query.status;
  try {
    const params = [req.user.sub];
    let where = `a.project_id IN (SELECT project_id FROM project_members WHERE member_sub = $1)`;
    if (projectId) {
      params.push(projectId);
      where += ` AND a.project_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      where += ` AND a.status = $${params.length}`;
    }
    const { rows } = await req.app.locals.pool.query(
      `SELECT a.${ASSET_COLS.split(', ').join(', a.')},
              v.name AS video_name, v.origin AS video_origin,
              (SELECT member_email FROM project_members
                WHERE project_id = a.project_id AND member_sub = a.owner_sub
                LIMIT 1) AS owner_email
         FROM assets a
         JOIN videos v ON v.id = a.video_id
        WHERE ${where}
        ORDER BY a.updated_at DESC`,
      params
    );
    res.json({ assets: rows });
  } catch (e) {
    if (e.code === '22P02') return res.status(400).json({ error: 'parâmetro inválido' });
    console.error('list assets:', e);
    res.status(500).json({ error: 'list failed' });
  }
});

router.get('/:id', requireUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT a.${ASSET_COLS.split(', ').join(', a.')}, v.name AS video_name, v.origin AS video_origin
         FROM assets a
         JOIN videos v ON v.id = a.video_id
        WHERE a.id = $1
          AND a.project_id IN (SELECT project_id FROM project_members WHERE member_sub = $2)`,
      [req.params.id, req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    res.json({ asset: rows[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('get asset:', e);
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
  if (typeof req.body.status === 'string') {
    if (!['pending', 'done'].includes(req.body.status)) {
      return res.status(400).json({ error: 'status inválido' });
    }
    updates.push(`status = $${idx++}`); params.push(req.body.status);
  }
  if (!updates.length) return res.status(400).json({ error: 'nada pra atualizar' });
  updates.push(`updated_at = NOW()`);
  params.push(req.params.id, req.user.sub);

  try {
    const { rows } = await req.app.locals.pool.query(
      `UPDATE assets SET ${updates.join(', ')}
        WHERE id = $${idx++}
          AND project_id IN (SELECT project_id FROM project_members WHERE member_sub = $${idx})
        RETURNING ${ASSET_COLS}`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    res.json({ asset: rows[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('patch asset:', e);
    res.status(500).json({ error: 'patch failed' });
  }
});

// Republicação: cliente envia novo .aseprite, incrementa version, atualiza gcs_url.
router.post('/:id/publish', requireUser, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'arquivo .aseprite é obrigatório' });
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT a.id, a.project_id, a.version
         FROM assets a
        WHERE a.id = $1
          AND a.project_id IN (SELECT project_id FROM project_members WHERE member_sub = $2)
        FOR UPDATE`,
      [req.params.id, req.user.sub]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'não encontrado' });
    }
    const asset = rows[0];
    const newVersion = asset.version + 1;
    const path = asepritePath(asset.id, newVersion);
    const { gcs_path, gcs_url } = await uploadBuffer(path, req.file.buffer, 'application/octet-stream');

    const { rows: updated } = await client.query(
      `UPDATE assets SET version = $1, gcs_path = $2, gcs_url = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING ${ASSET_COLS}`,
      [newVersion, gcs_path, gcs_url, asset.id]
    );
    await client.query('COMMIT');
    res.json({ asset: updated[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('publish asset:', e);
    res.status(500).json({ error: 'publish failed' });
  } finally {
    client.release();
  }
});

// Despublicar: apaga o asset, vídeo-fonte volta a ser rascunho na workbench
// (videos.published_asset_id zera via ON DELETE SET NULL na FK).
router.delete('/:id', requireUser, async (req, res) => {
  try {
    const { rowCount } = await req.app.locals.pool.query(
      `DELETE FROM assets
        WHERE id = $1
          AND project_id IN (SELECT project_id FROM project_members WHERE member_sub = $2)`,
      [req.params.id, req.user.sub]
    );
    if (!rowCount) return res.status(404).json({ error: 'não encontrado' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('delete asset:', e);
    res.status(500).json({ error: 'delete failed' });
  }
});

module.exports = { router, asepritePath };
