// Rotas de geração de mídia (fluxo C — geração genérica).
//
// POST /api/generate/image    body: { prompt, ref_image_urls? }
//                             resp: { image_url, cost_actual, model }
//
// POST /api/generate/video    body: { image_url, motion_prompt, duration_s,
//                                     image_prompt?, video_id? }
//                             - sem video_id: cria nova row em videos
//                             - com video_id: anexa attempt na existente
//                             resp: { video, attempt_idx }
//
// Síncronas: bloqueiam até o fal terminar (loading no front).
// Imagem ~30s; vídeo ~60-120s.

const { Router } = require('express');
const multer = require('multer');
const { requireUser } = require('../middleware/auth');
const { uploadBuffer, uploadFromUrl } = require('../lib/gcs');
const fal = require('../lib/providers/fal');
const anthropic = require('../lib/providers/anthropic');
const { getRecipe } = require('../lib/prompt-recipes');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const VIDEO_COLS = `id, name, origin, gcs_path, gcs_url, size_bytes, duration_s, width, height,
                    edit_state, share_id, published_asset_id,
                    source_aparencia_id, source_enquadramento_id, source_enquadramento_kind,
                    source_motion_prompt, source_model_key,
                    generation_meta,
                    created_at, updated_at`;

// Calcula custo real consultando o catálogo. Pra modelos `per_second`,
// multiplica pela duração.
async function modelCost(pool, key, units = 1) {
  const { rows } = await pool.query(
    `SELECT cost_per_unit, unit FROM models WHERE key = $1 AND enabled = TRUE`,
    [key]
  );
  if (!rows.length) return null;
  const cost = parseFloat(rows[0].cost_per_unit) * units;
  return { cost: Number(cost.toFixed(4)), unit: rows[0].unit };
}

// Upload de imagem de referência. Sobe pro GCS e retorna URL pública.
// Usado pra alimentar `ref_image_urls` na geração de imagem com refs.
router.post('/ref-upload', requireUser, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file obrigatório' });
  try {
    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `roto-master/refs/${req.user.sub}/ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const stored = await uploadBuffer(path, req.file.buffer, req.file.mimetype || 'image/jpeg');
    res.json({ url: stored.gcs_url });
  } catch (e) {
    console.error('ref-upload:', e.message);
    res.status(500).json({ error: 'upload failed' });
  }
});

// Melhora um prompt usando Claude Sonnet 4.6 com receita do kind dado.
// Body: { prompt, kind: 'image' | 'motion' }
// Resposta: { prompt: <reescrito> }
router.post('/enhance-prompt', requireUser, async (req, res) => {
  const prompt = (req.body?.prompt || '').trim();
  const kind = req.body?.kind || '';
  if (!prompt) return res.status(400).json({ error: 'prompt obrigatório' });
  if (prompt.length > 4000) return res.status(400).json({ error: 'prompt muito longo' });
  const system = getRecipe(kind);
  if (!system) return res.status(400).json({ error: 'kind inválido (image | motion)' });

  try {
    const result = await anthropic.complete({ system, user: prompt });
    res.json({ prompt: result.text });
  } catch (e) {
    console.error('enhance-prompt:', e.message);
    res.status(502).json({ error: e.message });
  }
});

router.post('/image', requireUser, async (req, res) => {
  const prompt = (req.body?.prompt || '').trim();
  const refs = Array.isArray(req.body?.ref_image_urls) ? req.body.ref_image_urls.filter(Boolean) : [];
  if (!prompt) return res.status(400).json({ error: 'prompt obrigatório' });
  if (prompt.length > 2000) return res.status(400).json({ error: 'prompt muito longo' });

  try {
    const result = await fal.generateImage({ prompt, ref_image_urls: refs });
    // sobe pro GCS — fal links expiram
    const dstPath = `roto-master/generations/${req.user.sub}/img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${(result.content_type || '').includes('png') ? 'png' : 'jpg'}`;
    const stored = await uploadFromUrl(result.url, dstPath, result.content_type);

    const cost = await modelCost(req.app.locals.pool, result.model, 1);
    res.json({
      image_url: stored.gcs_url,
      gcs_path: stored.gcs_path,
      model: result.model,
      cost_actual: cost?.cost ?? null,
    });
  } catch (e) {
    console.error('generate image:', e.message);
    res.status(502).json({ error: e.message });
  }
});

router.post('/video', requireUser, async (req, res) => {
  const image_url = (req.body?.image_url || '').trim();
  const motion_prompt = (req.body?.motion_prompt || '').trim();
  const duration_s = req.body?.duration_s === 10 ? 10 : 5;
  const image_prompt = (req.body?.image_prompt || '').trim();
  const videoId = req.body?.video_id || null;

  if (!image_url) return res.status(400).json({ error: 'image_url obrigatória' });
  if (!motion_prompt) return res.status(400).json({ error: 'motion_prompt obrigatório' });
  if (motion_prompt.length > 2000) return res.status(400).json({ error: 'motion_prompt muito longo' });

  const pool = req.app.locals.pool;

  // valida ownership do video se foi passado
  if (videoId) {
    const { rows } = await pool.query(
      `SELECT id FROM videos WHERE id = $1 AND owner_sub = $2`,
      [videoId, req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'video_id não encontrado' });
  }

  try {
    const result = await fal.generateVideo({ image_url, prompt: motion_prompt, duration_s });
    const cost = await modelCost(pool, result.model, duration_s);
    const costValue = cost?.cost ?? null;
    const generated_at = new Date().toISOString();

    // sobe vídeo pro GCS (path determinístico depois que tivermos id da row)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let videoRow;
      let attemptIdx;

      if (videoId) {
        // ATUALIZA video existente: anexa attempt
        const { rows } = await client.query(
          `SELECT generation_meta FROM videos WHERE id = $1 AND owner_sub = $2 FOR UPDATE`,
          [videoId, req.user.sub]
        );
        const meta = rows[0].generation_meta || {};
        const attempts = Array.isArray(meta.attempts) ? meta.attempts : [];

        // path único pra essa attempt
        const attemptId = `att-${attempts.length}-${Date.now()}`;
        const dstPath = `roto-master/videos/${videoId}/source-${attemptId}.mp4`;
        const stored = await uploadFromUrl(result.url, dstPath, 'video/mp4');

        const newAttempt = {
          url: stored.gcs_url,
          motion_prompt,
          duration_s,
          source_image_url: image_url,
          cost: costValue,
          generated_at,
        };
        attempts.push(newAttempt);
        attemptIdx = attempts.length - 1;

        const newMeta = {
          ...meta,
          image_prompt: image_prompt || meta.image_prompt,
          image_url: image_url, // imagem-base atual
          model_motion: result.model,
          attempts,
          active_attempt_idx: attemptIdx,
        };

        const { rows: upd } = await client.query(
          `UPDATE videos
              SET gcs_path = $1, gcs_url = $2, duration_s = $3,
                  generation_meta = $4, updated_at = NOW()
            WHERE id = $5
            RETURNING ${VIDEO_COLS}`,
          [stored.gcs_path, stored.gcs_url, duration_s, newMeta, videoId]
        );
        videoRow = upd[0];
      } else {
        // CRIA video novo
        const name = (image_prompt || motion_prompt).slice(0, 60).trim() || 'sem nome';

        const { rows: ins } = await client.query(
          `INSERT INTO videos (owner_sub, owner_email, name, origin, gcs_path, gcs_url, duration_s)
           VALUES ($1, $2, $3, 'generated-generic', '', '', $4)
           RETURNING id`,
          [req.user.sub, req.user.email || '', name, duration_s]
        );
        const newId = ins[0].id;

        const dstPath = `roto-master/videos/${newId}/source-att-0-${Date.now()}.mp4`;
        const stored = await uploadFromUrl(result.url, dstPath, 'video/mp4');

        const newMeta = {
          image_prompt: image_prompt || null,
          image_url,
          model_image: null, // pode ser preenchido depois se rastrearmos
          model_motion: result.model,
          attempts: [{
            url: stored.gcs_url,
            motion_prompt,
            duration_s,
            source_image_url: image_url,
            cost: costValue,
            generated_at,
          }],
          active_attempt_idx: 0,
        };

        const { rows: upd } = await client.query(
          `UPDATE videos
              SET gcs_path = $1, gcs_url = $2, generation_meta = $3, updated_at = NOW()
            WHERE id = $4
            RETURNING ${VIDEO_COLS}`,
          [stored.gcs_path, stored.gcs_url, newMeta, newId]
        );
        videoRow = upd[0];
        attemptIdx = 0;
      }

      await client.query('COMMIT');
      res.status(videoId ? 200 : 201).json({ video: videoRow, attempt_idx: attemptIdx });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('generate video:', e.message);
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
