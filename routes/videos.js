const { Router } = require('express');
const multer = require('multer');
const { requireUser } = require('../middleware/auth');
const { isMember } = require('../middleware/membership');
const { uploadBuffer } = require('../lib/gcs');
const { asepritePath } = require('./assets');

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const VIDEO_COLS = `id, name, origin, gcs_path, gcs_url, size_bytes, duration_s, width, height,
                    edit_state, share_id, published_asset_id,
                    source_aparencia_id, source_enquadramento_id, source_enquadramento_kind,
                    source_motion_prompt, source_model_key,
                    created_at, updated_at`;

router.get('/', requireUser, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT ${VIDEO_COLS}
         FROM videos
        WHERE owner_sub = $1
        ORDER BY updated_at DESC`,
      [req.user.sub]
    );
    res.json({ videos: rows });
  } catch (e) {
    console.error('list videos:', e);
    res.status(500).json({ error: 'list failed' });
  }
});

router.post('/', requireUser, async (req, res) => {
  const name = (req.body && typeof req.body.name === 'string' ? req.body.name : '').trim();
  if (!name) return res.status(400).json({ error: 'name é obrigatório' });
  if (name.length > 200) return res.status(400).json({ error: 'name muito longo (máx 200)' });
  try {
    const { rows } = await req.app.locals.pool.query(
      `INSERT INTO videos (owner_sub, owner_email, name, gcs_path, gcs_url)
       VALUES ($1, $2, $3, '', '')
       RETURNING ${VIDEO_COLS}`,
      [req.user.sub, req.user.email || '', name]
    );
    res.status(201).json({ video: rows[0] });
  } catch (e) {
    console.error('create video:', e);
    res.status(500).json({ error: 'create failed' });
  }
});

router.get('/:id', requireUser, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT ${VIDEO_COLS}
         FROM videos
        WHERE id = $1 AND owner_sub = $2`,
      [req.params.id, req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    res.json({ video: rows[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('get video:', e);
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
  if (req.body.edit_state && typeof req.body.edit_state === 'object') {
    updates.push(`edit_state = $${idx++}`); params.push(req.body.edit_state);
  }
  if (!updates.length) return res.status(400).json({ error: 'nada pra atualizar' });
  updates.push(`updated_at = NOW()`);
  params.push(req.params.id, req.user.sub);
  try {
    const { rows } = await req.app.locals.pool.query(
      `UPDATE videos SET ${updates.join(', ')}
        WHERE id = $${idx++} AND owner_sub = $${idx}
        RETURNING ${VIDEO_COLS}`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    res.json({ video: rows[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('patch video:', e);
    res.status(500).json({ error: 'patch failed' });
  }
});

// Upload do vídeo bruto pro GCS. Body multipart: file. Atualiza gcs_*, size_bytes.
// Metadata de mídia (duração/largura/altura) é extraída pelo cliente e enviada no body.
router.post('/:id/upload', requireUser, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'arquivo de vídeo é obrigatório' });
  const sizeMb = req.file.size / (1024 * 1024);
  if (sizeMb > 100) return res.status(413).json({ error: 'vídeo excede 100MB' });

  const duration_s = req.body.duration_s ? parseFloat(req.body.duration_s) : null;
  const width = req.body.width ? parseInt(req.body.width, 10) : null;
  const height = req.body.height ? parseInt(req.body.height, 10) : null;

  const pool = req.app.locals.pool;
  try {
    const { rows: vRows } = await pool.query(
      `SELECT id FROM videos WHERE id = $1 AND owner_sub = $2`,
      [req.params.id, req.user.sub]
    );
    if (!vRows.length) return res.status(404).json({ error: 'não encontrado' });

    const ext = (req.file.originalname.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `roto-master/videos/${req.params.id}/source.${ext || 'mp4'}`;
    const contentType = req.file.mimetype || 'video/mp4';
    const { gcs_path, gcs_url } = await uploadBuffer(path, req.file.buffer, contentType);

    const { rows } = await pool.query(
      `UPDATE videos
          SET gcs_path = $1, gcs_url = $2, size_bytes = $3,
              duration_s = COALESCE($4, duration_s),
              width = COALESCE($5, width),
              height = COALESCE($6, height),
              updated_at = NOW()
        WHERE id = $7 AND owner_sub = $8
        RETURNING ${VIDEO_COLS}`,
      [gcs_path, gcs_url, req.file.size, duration_s, width, height, req.params.id, req.user.sub]
    );
    res.json({ video: rows[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('upload video:', e);
    res.status(500).json({ error: 'upload failed' });
  }
});

// Primeira publicação: cria asset, vincula video.published_asset_id, sobe .aseprite.
// Body multipart: file (.aseprite), project_id, asset_name (opcional, default = nome do vídeo).
router.post('/:id/publish', requireUser, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'arquivo .aseprite é obrigatório' });
  const projectId = req.body.project_id;
  if (!projectId) return res.status(400).json({ error: 'project_id é obrigatório' });
  const assetNameOverride = typeof req.body.asset_name === 'string' ? req.body.asset_name.trim() : '';

  const pool = req.app.locals.pool;
  const member = await isMember(pool, projectId, req.user.sub);
  if (!member) return res.status(403).json({ error: 'não é membro do projeto' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, name, owner_sub, published_asset_id FROM videos
        WHERE id = $1 AND owner_sub = $2 FOR UPDATE`,
      [req.params.id, req.user.sub]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'vídeo não encontrado' });
    }
    const video = rows[0];
    if (video.published_asset_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'vídeo já publicado; use republicar', published_asset_id: video.published_asset_id });
    }

    const assetName = assetNameOverride || video.name;
    const { rows: aRows } = await client.query(
      `INSERT INTO assets (project_id, video_id, owner_sub, name, status, gcs_path, gcs_url, version)
       VALUES ($1, $2, $3, $4, 'pending', '', '', 1)
       RETURNING id`,
      [projectId, video.id, req.user.sub, assetName]
    );
    const assetId = aRows[0].id;
    const path = asepritePath(assetId, 1);
    const { gcs_path, gcs_url } = await uploadBuffer(path, req.file.buffer, 'application/octet-stream');

    const { rows: finalAsset } = await client.query(
      `UPDATE assets SET gcs_path = $1, gcs_url = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, project_id, video_id, owner_sub, name, status, gcs_path, gcs_url, version, created_at, updated_at`,
      [gcs_path, gcs_url, assetId]
    );
    await client.query(
      `UPDATE videos SET published_asset_id = $1, updated_at = NOW() WHERE id = $2`,
      [assetId, video.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ asset: finalAsset[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('publish video:', e);
    res.status(500).json({ error: 'publish failed' });
  } finally {
    client.release();
  }
});

router.delete('/:id', requireUser, async (req, res) => {
  try {
    const { rowCount } = await req.app.locals.pool.query(
      `DELETE FROM videos WHERE id = $1 AND owner_sub = $2`,
      [req.params.id, req.user.sub]
    );
    if (!rowCount) return res.status(404).json({ error: 'não encontrado' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('delete video:', e);
    res.status(500).json({ error: 'delete failed' });
  }
});

module.exports = router;
