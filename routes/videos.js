const { Router } = require('express');
const multer = require('multer');
const { requireUser } = require('../middleware/auth');
const { isMember } = require('../middleware/membership');
const { uploadBuffer, copyObject } = require('../lib/gcs');
const ytdlp = require('../lib/providers/yt-dlp');
const { asepritePath } = require('./assets');

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const VIDEO_COLS = `id, name, origin, gcs_path, gcs_url, thumb_url, size_bytes, duration_s, width, height,
                    edit_state, share_id, published_asset_id,
                    source_aparencia_id, source_enquadramento_id, source_enquadramento_kind,
                    source_motion_prompt, source_model_key,
                    source_url, source_segment_in_s, source_segment_out_s,
                    generation_meta,
                    created_at, updated_at`;

router.get('/', requireUser, async (req, res) => {
  // normaliza VIDEO_COLS pra lista de nomes limpos, prefixa com v.
  const cols = VIDEO_COLS.replace(/\s+/g, ' ').split(',').map((c) => `v.${c.trim()}`).join(', ');
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT ${cols},
              a.project_id AS published_project_id,
              p.name AS published_project_name
         FROM videos v
         LEFT JOIN assets a   ON a.id = v.published_asset_id
         LEFT JOIN projects p ON p.id = a.project_id
        WHERE v.owner_sub = $1
        ORDER BY v.updated_at DESC`,
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

// Republicar como novo asset: o usuário re-editou um vídeo já publicado
// e mudou nome ou projeto. Por baixo, duplica o vídeo (linhagem
// 1:1 vídeo↔asset) e publica a cópia como asset novo. O vídeo/asset
// originais ficam intactos.
//
// Body multipart: file (.aseprite), project_id, asset_name.
router.post('/:id/publish-as-new', requireUser, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'arquivo .aseprite é obrigatório' });
  const projectId = req.body.project_id;
  if (!projectId) return res.status(400).json({ error: 'project_id é obrigatório' });
  const assetName = (typeof req.body.asset_name === 'string' ? req.body.asset_name.trim() : '');
  if (!assetName) return res.status(400).json({ error: 'asset_name é obrigatório' });

  const pool = req.app.locals.pool;
  const member = await isMember(pool, projectId, req.user.sub);
  if (!member) return res.status(403).json({ error: 'não é membro do projeto' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, name, origin, gcs_path, size_bytes, duration_s, width, height, edit_state
         FROM videos WHERE id = $1 AND owner_sub = $2 FOR SHARE`,
      [req.params.id, req.user.sub]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'vídeo não encontrado' });
    }
    const src = rows[0];

    // 1) duplica o vídeo (mesma lógica do /duplicate, sem o sufixo "(cópia)" —
    // aqui o user já está dando um nome explícito ao asset).
    const { rows: ins } = await client.query(
      `INSERT INTO videos (owner_sub, owner_email, name, origin, gcs_path, gcs_url,
                           size_bytes, duration_s, width, height, edit_state)
       VALUES ($1, $2, $3, $4, '', '', $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        req.user.sub, req.user.email || '', assetName, src.origin || 'uploaded',
        src.size_bytes || 0, src.duration_s, src.width, src.height, src.edit_state || {},
      ]
    );
    const newVideoId = ins[0].id;

    if (src.gcs_path) {
      const ext = (src.gcs_path.split('.').pop() || 'mp4').toLowerCase();
      const dstVideo = `roto-master/videos/${newVideoId}/source.${ext}`;
      const copied = await copyObject(src.gcs_path, dstVideo);
      await client.query(
        `UPDATE videos SET gcs_path = $1, gcs_url = $2, updated_at = NOW() WHERE id = $3`,
        [copied.gcs_path, copied.gcs_url, newVideoId]
      );
    }

    // 2) cria asset novo apontando pro vídeo duplicado
    const { rows: aRows } = await client.query(
      `INSERT INTO assets (project_id, video_id, owner_sub, name, status, gcs_path, gcs_url, version)
       VALUES ($1, $2, $3, $4, 'pending', '', '', 1)
       RETURNING id`,
      [projectId, newVideoId, req.user.sub, assetName]
    );
    const newAssetId = aRows[0].id;

    const asePath = asepritePath(newAssetId, 1);
    const stored = await uploadBuffer(asePath, req.file.buffer, 'application/octet-stream');

    const { rows: finalAsset } = await client.query(
      `UPDATE assets SET gcs_path = $1, gcs_url = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, project_id, video_id, owner_sub, name, status, gcs_path, gcs_url, version, created_at, updated_at`,
      [stored.gcs_path, stored.gcs_url, newAssetId]
    );

    // 3) vincula vídeo novo ao asset novo
    await client.query(
      `UPDATE videos SET published_asset_id = $1, updated_at = NOW() WHERE id = $2`,
      [newAssetId, newVideoId]
    );

    await client.query('COMMIT');
    res.status(201).json({ asset: finalAsset[0], new_video_id: newVideoId });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('publish-as-new:', e);
    res.status(500).json({ error: 'publish-as-new failed' });
  } finally {
    client.release();
  }
});

// Upload de thumbnail (primeiro frame, capturado pelo cliente no editor).
// Idempotente: se já tem thumb_url, retorna a existente sem regravar.
router.post('/:id/thumb', requireUser, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file obrigatório' });
  const pool = req.app.locals.pool;
  try {
    const { rows } = await pool.query(
      `SELECT id, thumb_url FROM videos WHERE id = $1 AND owner_sub = $2`,
      [req.params.id, req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    if (rows[0].thumb_url) return res.json({ video: { id: rows[0].id, thumb_url: rows[0].thumb_url }, skipped: true });

    const path = `roto-master/videos/${req.params.id}/thumb.jpg`;
    const stored = await uploadBuffer(path, req.file.buffer, 'image/jpeg');

    const { rows: upd } = await pool.query(
      `UPDATE videos SET thumb_url = $1, updated_at = NOW() WHERE id = $2 RETURNING ${VIDEO_COLS}`,
      [stored.gcs_url, req.params.id]
    );
    res.json({ video: upd[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('thumb upload:', e);
    res.status(500).json({ error: 'thumb failed' });
  }
});

// Troca a tentativa ativa de geração (fluxo C). Atualiza gcs_url pra apontar
// pra attempts[idx].url. Não regenera nada.
router.patch('/:id/active-attempt', requireUser, async (req, res) => {
  const idx = Number.isInteger(req.body?.idx) ? req.body.idx : -1;
  if (idx < 0) return res.status(400).json({ error: 'idx inválido' });
  const pool = req.app.locals.pool;
  try {
    const { rows } = await pool.query(
      `SELECT generation_meta FROM videos WHERE id = $1 AND owner_sub = $2`,
      [req.params.id, req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    const meta = rows[0].generation_meta || {};
    const attempts = Array.isArray(meta.attempts) ? meta.attempts : [];
    if (idx >= attempts.length) return res.status(400).json({ error: 'idx fora do range' });

    const target = attempts[idx];
    const url = target.url;
    // gcs_path do url público:
    const path = url.startsWith('https://st.did.lu/')
      ? url.slice('https://st.did.lu/'.length)
      : '';

    const newMeta = { ...meta, active_attempt_idx: idx };
    const { rows: upd } = await pool.query(
      `UPDATE videos SET generation_meta = $1, gcs_path = $2, gcs_url = $3, duration_s = $4, updated_at = NOW()
        WHERE id = $5 AND owner_sub = $6
        RETURNING ${VIDEO_COLS}`,
      [newMeta, path, url, target.duration_s || null, req.params.id, req.user.sub]
    );
    res.json({ video: upd[0] });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('active-attempt:', e);
    res.status(500).json({ error: 'failed' });
  }
});

// Duplicar vídeo (decisão 5 da visão: única forma de reusar trabalho em outro projeto).
// Cria nova row independente; copia o arquivo no GCS se existir.
// Sai sem published_asset_id e sem source_*.
router.post('/:id/duplicate', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, name, origin, gcs_path, size_bytes, duration_s, width, height, edit_state
         FROM videos WHERE id = $1 AND owner_sub = $2 FOR SHARE`,
      [req.params.id, req.user.sub]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'não encontrado' });
    }
    const src = rows[0];
    const newName = `${src.name} (cópia)`;

    // Insere row vazia primeiro pra obter o id novo (que é usado no path do GCS).
    const { rows: ins } = await client.query(
      `INSERT INTO videos (owner_sub, owner_email, name, origin, gcs_path, gcs_url,
                           size_bytes, duration_s, width, height, edit_state)
       VALUES ($1, $2, $3, $4, '', '', $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        req.user.sub, req.user.email || '', newName, src.origin || 'uploaded',
        src.size_bytes || 0, src.duration_s, src.width, src.height, src.edit_state || {},
      ]
    );
    const newId = ins[0].id;

    let gcs_path = '';
    let gcs_url = '';
    if (src.gcs_path) {
      const ext = (src.gcs_path.split('.').pop() || 'mp4').toLowerCase();
      const dst = `roto-master/videos/${newId}/source.${ext}`;
      const copied = await copyObject(src.gcs_path, dst);
      gcs_path = copied.gcs_path;
      gcs_url = copied.gcs_url;
      await client.query(
        `UPDATE videos SET gcs_path = $1, gcs_url = $2, updated_at = NOW() WHERE id = $3`,
        [gcs_path, gcs_url, newId]
      );
    }

    const { rows: finalRows } = await client.query(
      `SELECT ${VIDEO_COLS} FROM videos WHERE id = $1`,
      [newId]
    );
    await client.query('COMMIT');
    res.status(201).json({ video: finalRows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('duplicate video:', e);
    res.status(500).json({ error: 'duplicate failed' });
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

// === Fluxo B (vídeo de URL) ===

// Preview de URL: pega título + thumb + duração SEM baixar.
// Usado pelo modal "criar vídeo" pra confirmar que é o vídeo certo.
router.post('/url/preview', requireUser, async (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url obrigatória' });
  if (!ytdlp.isYouTube(url)) {
    return res.status(400).json({ error: 'só YouTube por enquanto' });
  }
  try {
    const info = await ytdlp.getInfo(url);
    res.json({ info });
  } catch (e) {
    console.error('url preview:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// Cria row em videos com origin='url' apontando pra source_url externa.
// gcs_url fica vazio — vídeo "vive" no YouTube. Apenas thumb_url é
// preenchida (do oEmbed/yt-dlp). Usuário pode tocar via streaming URL
// fornecida sob demanda.
router.post('/url', requireUser, async (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url obrigatória' });
  if (!ytdlp.isYouTube(url)) {
    return res.status(400).json({ error: 'só YouTube por enquanto' });
  }
  try {
    const info = await ytdlp.getInfo(url);
    const name = info.title?.slice(0, 200) || 'sem nome';
    const { rows } = await req.app.locals.pool.query(
      `INSERT INTO videos (owner_sub, owner_email, name, origin, gcs_path, gcs_url,
                           source_url, duration_s, thumb_url, width, height)
       VALUES ($1, $2, $3, 'url', '', '', $4, $5, $6, $7, $8)
       RETURNING ${VIDEO_COLS}`,
      [req.user.sub, req.user.email || '', name, url, info.duration_s || null,
       info.thumbnail || null, info.width || null, info.height || null]
    );
    res.status(201).json({ video: rows[0] });
  } catch (e) {
    console.error('create from url:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// Streaming URL fresca pra um vídeo origin='url'. Cliente chama isso
// (a) ao abrir o editor, (b) quando o <video> dá 403 (URL expirou).
router.get('/:id/stream-url', requireUser, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const { rows } = await pool.query(
      `SELECT source_url FROM videos WHERE id = $1 AND owner_sub = $2`,
      [req.params.id, req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    if (!rows[0].source_url) return res.status(400).json({ error: 'vídeo não tem source_url' });

    const url = await ytdlp.getStreamUrl(rows[0].source_url);
    res.json({ stream_url: url });
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('stream-url:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// Extrai trecho [in_s, out_s] de um vídeo origin='url' e cria um vídeo
// NOVO independente apontando pra esse trecho no GCS. Limite 20s.
router.post('/:id/extract', requireUser, async (req, res) => {
  const in_s = parseFloat(req.body?.in_s);
  const out_s = parseFloat(req.body?.out_s);
  if (!Number.isFinite(in_s) || !Number.isFinite(out_s) || in_s < 0 || out_s <= in_s) {
    return res.status(400).json({ error: 'in_s/out_s inválidos' });
  }
  const dur = out_s - in_s;
  if (dur > 20) {
    return res.status(400).json({ error: `trecho de ${dur.toFixed(1)}s — máx 20s pra rotoscopia` });
  }

  const pool = req.app.locals.pool;
  try {
    const { rows } = await pool.query(
      `SELECT name, source_url FROM videos WHERE id = $1 AND owner_sub = $2`,
      [req.params.id, req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
    if (!rows[0].source_url) return res.status(400).json({ error: 'vídeo não tem source_url' });
    const parent = rows[0];

    // baixa só o trecho
    const cut = await ytdlp.extractSection(parent.source_url, in_s, out_s);

    // cria row nova
    const trim = (s) => (s || '').slice(0, 60).trim();
    const newName = `${trim(parent.name)} (${in_s.toFixed(1)}-${out_s.toFixed(1)}s)`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: ins } = await client.query(
        `INSERT INTO videos (owner_sub, owner_email, name, origin, gcs_path, gcs_url,
                             source_url, source_segment_in_s, source_segment_out_s, duration_s)
         VALUES ($1, $2, $3, 'url', '', '', $4, $5, $6, $7)
         RETURNING id`,
        [req.user.sub, req.user.email || '', newName, parent.source_url, in_s, out_s, dur]
      );
      const newId = ins[0].id;

      const dstPath = `roto-master/videos/${newId}/source.mp4`;
      const stored = await uploadBuffer(dstPath, cut.buffer, cut.contentType);

      const { rows: upd } = await client.query(
        `UPDATE videos SET gcs_path = $1, gcs_url = $2, size_bytes = $3, updated_at = NOW()
          WHERE id = $4
          RETURNING ${VIDEO_COLS}`,
        [stored.gcs_path, stored.gcs_url, cut.buffer.length, newId]
      );
      await client.query('COMMIT');
      res.status(201).json({ video: upd[0] });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (e) {
    if (e.code === '22P02') return res.status(404).json({ error: 'id inválido' });
    console.error('extract:', e.message);
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
