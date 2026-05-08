// Rotas de geração de mídia (fluxo C — geração genérica).
//
// POST /api/generate/image          (síncrono) — Nano Banana Pro ~30s.
// POST /api/generate/video          (assíncrono — cria job, devolve 202).
// POST /api/generate/text-video     (assíncrono — cria job, devolve 202).
//
// Imagem segue síncrona (rápida). Vídeo (60-180s) virou job pra não travar
// UI nem perder trabalho se a aba fechar. Worker em lib/job-runner.js.

const { Router } = require('express');
const multer = require('multer');
const { requireUser } = require('../middleware/auth');
const { uploadBuffer, uploadFromUrl } = require('../lib/gcs');
const fal = require('../lib/providers/fal');
const anthropic = require('../lib/providers/anthropic');
const { getRecipe, SANITIZE_IMAGE_PROMPT } = require('../lib/prompt-recipes');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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
    const path = `roto-master/refs/shared/ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const stored = await uploadBuffer(path, req.file.buffer, req.file.mimetype || 'image/jpeg');
    res.json({ url: stored.gcs_url });
  } catch (e) {
    console.error('ref-upload:', e.message);
    res.status(500).json({ error: 'upload failed' });
  }
});

// Melhora um prompt usando Claude Sonnet 4.6 com receita do kind dado.
// Body: { prompt, kind: 'image' | 'motion' | 'motion-text' }
// Resposta: { prompt: <reescrito> }
router.post('/enhance-prompt', requireUser, async (req, res) => {
  const prompt = (req.body?.prompt || '').trim();
  const kind = req.body?.kind || '';
  if (!prompt) return res.status(400).json({ error: 'prompt obrigatório' });
  if (prompt.length > 4000) return res.status(400).json({ error: 'prompt muito longo' });
  const system = getRecipe(kind);
  if (!system) return res.status(400).json({ error: 'kind inválido (image | motion | motion-text)' });

  try {
    const result = await anthropic.complete({ system, user: prompt });
    res.json({ prompt: result.text });
  } catch (e) {
    console.error('enhance-prompt:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// Sanitiza imagem (remove sangue/gore/etc) antes de mandar pro Kling i2v.
// Body: { image_url }. Resp: { image_url, gcs_path, cost_actual }.
router.post('/sanitize-image', requireUser, async (req, res) => {
  const image_url = (req.body?.image_url || '').trim();
  if (!image_url) return res.status(400).json({ error: 'image_url obrigatória' });
  try {
    const result = await fal.generateImage({
      prompt: SANITIZE_IMAGE_PROMPT,
      ref_image_urls: [image_url],
    });
    const ext = (result.content_type || '').includes('png') ? 'png' : 'jpg';
    const dstPath = `roto-master/generations/shared/sanitized-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const stored = await uploadFromUrl(result.url, dstPath, result.content_type);
    const cost = await modelCost(req.app.locals.pool, result.model, 1);
    res.json({
      image_url: stored.gcs_url,
      gcs_path: stored.gcs_path,
      cost_actual: cost?.cost ?? null,
    });
  } catch (e) {
    console.error('sanitize-image:', e.message);
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
    const dstPath = `roto-master/generations/shared/img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${(result.content_type || '').includes('png') ? 'png' : 'jpg'}`;
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

// POST /api/generate/video — enfileira job. Resposta 202 com { job_id }.
// Cobrança no Fal só acontece quando o worker pega o job.
router.post('/video', requireUser, async (req, res) => {
  const image_url = (req.body?.image_url || '').trim();
  const motion_prompt = (req.body?.motion_prompt || '').trim();
  const image_prompt = (req.body?.image_prompt || '').trim();
  const videoId = req.body?.video_id || null;
  const modelKey = req.body?.model_key === 'pixverse-i2v' ? 'pixverse-i2v' : 'kling-i2v';
  let duration_s;
  if (modelKey === 'pixverse-i2v') {
    const d = parseInt(req.body?.duration_s, 10);
    if (!Number.isFinite(d) || d < 1 || d > 15) {
      return res.status(400).json({ error: 'duration_s deve ser inteiro 1-15 pro PixVerse' });
    }
    duration_s = d;
  } else {
    duration_s = req.body?.duration_s === 10 ? 10 : 5;
  }

  if (!image_url) return res.status(400).json({ error: 'image_url obrigatória' });
  if (!motion_prompt) return res.status(400).json({ error: 'motion_prompt obrigatório' });
  if (motion_prompt.length > 2000) return res.status(400).json({ error: 'motion_prompt muito longo' });

  const pool = req.app.locals.pool;

  if (videoId) {
    const { rows } = await pool.query(`SELECT id FROM videos WHERE id = $1`, [videoId]);
    if (!rows.length) return res.status(404).json({ error: 'video_id não encontrado' });
  }

  // Custo estimado calculado no momento de enfileirar (não-vinculante; valor real
  // entra em cost_actual quando o worker termina).
  const modelId = modelKey === 'pixverse-i2v'
    ? 'fal-ai/pixverse/v6/image-to-video'
    : 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video';
  const costEst = await modelCost(pool, modelId, duration_s);

  try {
    const params = { image_url, motion_prompt, duration_s, model_key: modelKey, image_prompt, video_id: videoId };
    const { rows } = await pool.query(
      `INSERT INTO jobs (kind, status, params, cost_estimated, video_id)
       VALUES ('generate-video', 'queued', $1, $2, $3)
       RETURNING id, kind, status, created_at`,
      [params, costEst?.cost ?? 0, videoId]
    );
    res.status(202).json({ job: rows[0] });
  } catch (e) {
    console.error('generate video enqueue:', e.message);
    res.status(500).json({ error: 'falha ao enfileirar' });
  }
});

// POST /api/generate/text-video — enfileira job. Resposta 202 com { job_id }.
router.post('/text-video', requireUser, async (req, res) => {
  const prompt = (req.body?.prompt || '').trim();
  const videoId = req.body?.video_id || null;
  const mode = ['free', 'structured', 'structured-edited'].includes(req.body?.mode) ? req.body.mode : 'free';
  const structured = req.body?.structured && typeof req.body.structured === 'object' ? req.body.structured : null;
  const modelKey = req.body?.model_key === 'pixverse-t2v' ? 'pixverse-t2v' : 'kling-t2v';
  let duration_s;
  if (modelKey === 'pixverse-t2v') {
    const d = parseInt(req.body?.duration_s, 10);
    if (!Number.isFinite(d) || d < 1 || d > 15) {
      return res.status(400).json({ error: 'duration_s deve ser inteiro 1-15 pro PixVerse' });
    }
    duration_s = d;
  } else {
    duration_s = req.body?.duration_s === 10 ? 10 : 5;
  }

  if (!prompt) return res.status(400).json({ error: 'prompt obrigatório' });
  if (prompt.length > 4000) return res.status(400).json({ error: 'prompt muito longo' });

  const pool = req.app.locals.pool;

  if (videoId) {
    const { rows } = await pool.query(`SELECT id FROM videos WHERE id = $1`, [videoId]);
    if (!rows.length) return res.status(404).json({ error: 'video_id não encontrado' });
  }

  const modelId = modelKey === 'pixverse-t2v'
    ? 'fal-ai/pixverse/v6/text-to-video'
    : 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video';
  const costEst = await modelCost(pool, modelId, duration_s);

  try {
    const params = { prompt, duration_s, model_key: modelKey, mode, structured, video_id: videoId };
    const { rows } = await pool.query(
      `INSERT INTO jobs (kind, status, params, cost_estimated, video_id)
       VALUES ('generate-text-video', 'queued', $1, $2, $3)
       RETURNING id, kind, status, created_at`,
      [params, costEst?.cost ?? 0, videoId]
    );
    res.status(202).json({ job: rows[0] });
  } catch (e) {
    console.error('generate text-video enqueue:', e.message);
    res.status(500).json({ error: 'falha ao enfileirar' });
  }
});

module.exports = router;
