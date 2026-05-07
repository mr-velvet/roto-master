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
  }
  finally { client.release(); }
});

// Upload do trabalho FINALIZADO. Pessoa baixou o .aseprite que a plataforma
// gerou, rotoscopou no Aseprite desktop, sobe de volta. Sobrescreve o arquivo
// no GCS (mesmo path, sem bump de versão por enquanto — sobrescrita simples
// conforme decidido), marca status='done'. Validação mínima: magic number
// .aseprite (0xA5E0 nos bytes 4-5 do header).
router.post('/:id/upload-final', requireUser, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'arquivo .aseprite é obrigatório' });
  // Magic number do .aseprite: bytes 4-5 = 0xE0 0xA5 (little-endian 0xA5E0).
  const buf = req.file.buffer;
  if (buf.length < 6 || buf[4] !== 0xE0 || buf[5] !== 0xA5) {
    return res.status(400).json({ error: 'arquivo não é um .aseprite válido' });
  }
  const pool = req.app.locals.pool;
  try {
    const { rows } = await pool.query(
      `SELECT id, gcs_path, version FROM assets WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    const asset = rows[0];
    // Sobrescreve no path atual. Se o asset não tem path (caso defensivo),
    // grava no path da versão atual.
    const path = asset.gcs_path || asepritePath(asset.id, asset.version || 1);
    const { gcs_path, gcs_url } = await uploadBuffer(path, buf, 'application/octet-stream');
    const { rows: updated } = await pool.query(
      `UPDATE assets SET gcs_path = $1, gcs_url = $2, status = 'done', updated_at = NOW()
        WHERE id = $3 RETURNING ${ASSET_COLS}`,
      [gcs_path, gcs_url, asset.id]
    );
    res.json({ asset: updated[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('upload-final asset:', e);
    res.status(500).json({ error: 'upload-final failed' });
  }
});

// DELETE = jogar na lixeira (soft delete). Asset e vídeo são entidades
// independentes: deletar asset NÃO toca em videos.published_asset_id. O Ateliê
// detecta "vídeo sem asset ativo" via JOIN filtrado por deleted_at IS NULL.
router.delete('/:id', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const { rows } = await pool.query(
      `SELECT id, deleted_at FROM assets WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    if (rows[0].deleted_at) return res.status(400).json({ error: 'asset já está na lixeira' });
    await pool.query(
      `UPDATE assets SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('trash asset:', e);
    res.status(500).json({ error: 'delete failed' });
  }
});

// Restaura asset da lixeira. Não toca no vídeo — eles são independentes.
// O unique parcial em assets (project_id, video_id) WHERE deleted_at IS NULL
// (após migration 016) impede restaurar se já existe asset ativo do mesmo
// vídeo no mesmo projeto.
router.post('/:id/restore', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const { rows } = await pool.query(
      `SELECT id, video_id, project_id, deleted_at FROM assets WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    if (!rows[0].deleted_at) return res.status(400).json({ error: 'asset não está na lixeira' });

    // Checa se já existe outro asset ativo do mesmo vídeo no mesmo projeto.
    // (Backstop pra fase 1 antes da migration 016 cair; e regra de UX coerente.)
    const { rows: active } = await pool.query(
      `SELECT id FROM assets
        WHERE video_id = $1 AND project_id = $2 AND deleted_at IS NULL AND id <> $3`,
      [rows[0].video_id, rows[0].project_id, req.params.id]
    );
    if (active.length) {
      return res.status(409).json({
        error: 'já existe um asset ativo desse vídeo neste projeto. apague-o ou jogue-o na lixeira primeiro.',
      });
    }
    await pool.query(
      `UPDATE assets SET deleted_at = NULL, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('restore asset:', e);
    res.status(500).json({ error: 'restore failed' });
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
