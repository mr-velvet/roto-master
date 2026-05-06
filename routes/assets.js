const { Router } = require('express');
const multer = require('multer');
const { requireUser } = require('../middleware/auth');
const { uploadBuffer, deleteFile } = require('../lib/gcs');

const router = Router();

// .aseprite pode passar de 50MB; 200MB cobre.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const ASSET_COLS = `id, project_id, video_id, name, status, gcs_path, gcs_url, version, created_at, updated_at`;

function asepritePath(assetId, version) {
  return `roto-master/assets/${assetId}/v${version}/${assetId}.aseprite`;
}

router.get('/', requireUser, async (req, res) => {
  const projectId = req.query.project_id;
  const status = req.query.status;
  try {
    const params = [];
    const where = ['a.deleted_at IS NULL'];
    if (projectId) {
      params.push(projectId);
      where.push(`a.project_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`a.status = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const { rows } = await req.app.locals.pool.query(
      `SELECT a.${ASSET_COLS.split(', ').join(', a.')},
              v.name AS video_name, v.origin AS video_origin, v.thumb_url AS video_thumb_url, v.gcs_url AS video_gcs_url
         FROM assets a
         JOIN videos v ON v.id = a.video_id
         ${whereSql}
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

// Lixeira global: lista todos os assets soft-deletados, com nome do projeto
// e do vídeo-fonte pra exibir contexto na tela de lixeira.
router.get('/trash', requireUser, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT a.${ASSET_COLS.split(', ').join(', a.')}, a.deleted_at,
              v.name AS video_name, v.origin AS video_origin, v.thumb_url AS video_thumb_url, v.gcs_url AS video_gcs_url,
              p.name AS project_name
         FROM assets a
         JOIN videos v ON v.id = a.video_id
         JOIN projects p ON p.id = a.project_id
        WHERE a.deleted_at IS NOT NULL
        ORDER BY a.deleted_at DESC`
    );
    res.json({ assets: rows });
  } catch (e) {
    console.error('list trash:', e);
    res.status(500).json({ error: 'list trash failed' });
  }
});

router.get('/:id', requireUser, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT a.${ASSET_COLS.split(', ').join(', a.')}, a.deleted_at,
              v.name AS video_name, v.origin AS video_origin, v.thumb_url AS video_thumb_url, v.gcs_url AS video_gcs_url
         FROM assets a
         JOIN videos v ON v.id = a.video_id
        WHERE a.id = $1`,
      [req.params.id]
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
  params.push(req.params.id);

  try {
    const { rows } = await req.app.locals.pool.query(
      `UPDATE assets SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${ASSET_COLS}`,
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

router.post('/:id/publish', requireUser, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'arquivo .aseprite é obrigatório' });
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, project_id, version FROM assets WHERE id = $1 FOR UPDATE`,
      [req.params.id]
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
        WHERE id = $4 RETURNING ${ASSET_COLS}`,
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

// DELETE = jogar na lixeira (soft delete). O vídeo-fonte volta a ser rascunho
// no Ateliê (videos.published_asset_id = NULL) — assim o asset some das
// listagens normais e o user pode republicar o vídeo se quiser. Restaurar
// depois reata o vínculo se o vídeo ainda não tem outro asset ativo.
router.delete('/:id', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, video_id, deleted_at FROM assets WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'não encontrado' });
    }
    if (rows[0].deleted_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'asset já está na lixeira' });
    }
    await client.query(
      `UPDATE assets SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    // Solta o vínculo do vídeo: vídeo volta a ser rascunho no Ateliê.
    await client.query(
      `UPDATE videos SET published_asset_id = NULL WHERE published_asset_id = $1`,
      [req.params.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('trash asset:', e);
    res.status(500).json({ error: 'delete failed' });
  } finally {
    client.release();
  }
});

// Restaura asset da lixeira. Se o vídeo-fonte ainda não tem outro asset
// ativo, reata o vínculo. Se já tem (user republicou enquanto estava na
// lixeira), restaura assim mesmo mas sem reatar — fica como asset solto
// pertencente ao mesmo vídeo (raro; no fluxo normal não acontece porque
// despublicar libera o vídeo).
router.post('/:id/restore', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, video_id, deleted_at FROM assets WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'não encontrado' });
    }
    if (!rows[0].deleted_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'asset não está na lixeira' });
    }
    // Checa se o vídeo já tem outro asset ATIVO (unique parcial garante max 1).
    const { rows: active } = await client.query(
      `SELECT id FROM assets WHERE video_id = $1 AND deleted_at IS NULL`,
      [rows[0].video_id]
    );
    if (active.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'o vídeo já tem outro asset ativo. apague-o ou jogue-o na lixeira primeiro.',
      });
    }
    await client.query(
      `UPDATE assets SET deleted_at = NULL, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    // Reata vínculo no vídeo (já está NULL desde o trash, mas defensivo).
    await client.query(
      `UPDATE videos SET published_asset_id = $1 WHERE id = $2 AND published_asset_id IS NULL`,
      [req.params.id, rows[0].video_id]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('restore asset:', e);
    res.status(500).json({ error: 'restore failed' });
  } finally {
    client.release();
  }
});

// Apagar de vez: remove row + arquivo do GCS. Só permite se já está na
// lixeira (proteção extra contra deleção acidental).
router.delete('/:id/purge', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const { rows } = await pool.query(
      `SELECT id, gcs_path, deleted_at FROM assets WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    if (!rows[0].deleted_at) {
      return res.status(400).json({ error: 'jogue na lixeira primeiro' });
    }
    // Apaga arquivo do GCS antes da row (se falhar, row continua e tentamos de novo).
    if (rows[0].gcs_path) {
      try { await deleteFile(rows[0].gcs_path); }
      catch (err) { console.warn('purge gcs:', err.message); }
    }
    await pool.query(`DELETE FROM assets WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('purge asset:', e);
    res.status(500).json({ error: 'purge failed' });
  }
});

module.exports = { router, asepritePath };
