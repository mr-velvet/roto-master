// Worker in-process pra jobs assíncronos.
// Roda no mesmo processo Express. Sem container separado, sem fila externa.
//
// Fluxo:
//   1. Loop a cada POLL_MS busca até CONCURRENCY jobs queued via
//      SELECT FOR UPDATE SKIP LOCKED. Marca como running em transação.
//   2. Pra cada job, chama o handler de acordo com `kind`.
//   3. Handler entrega { video_id, result } ou throw — runner marca
//      completed ou failed e passa adiante.
//   4. Ao subir, varre jobs running e marca failed (server reiniciou).
//
// Sem retry automático, sem cancelamento de running (alinhado com a
// decisão do user — Fal já cobrou ao receber, não tem reembolso).

const { uploadFromUrl } = require('./gcs');
const fal = require('./providers/fal');

const POLL_MS = 1500;
const CONCURRENCY = 3;

const VIDEO_COLS_INSERT = `id, name, origin, gcs_path, gcs_url, duration_s,
                           generation_meta, created_at, updated_at`;

let pool = null;
let running = 0;
let timer = null;
let stopped = false;

async function init(p) {
  pool = p;
  await recoverStaleRunning();
  schedule();
  console.log(`[jobs] worker rodando (concurrency=${CONCURRENCY}, poll=${POLL_MS}ms)`);
}

async function recoverStaleRunning() {
  try {
    const { rowCount } = await pool.query(
      `UPDATE jobs SET status='failed', error_message='servidor reiniciou', completed_at=NOW(), updated_at=NOW()
        WHERE status='running'`
    );
    if (rowCount > 0) console.log(`[jobs] ${rowCount} job(s) running → failed (recovery)`);
  } catch (e) {
    console.error('[jobs] recovery falhou:', e.message);
  }
}

function schedule() {
  if (stopped) return;
  if (timer) return;
  timer = setTimeout(tick, POLL_MS);
}

async function tick() {
  timer = null;
  try {
    while (running < CONCURRENCY) {
      const job = await claimNext();
      if (!job) break;
      running++;
      runJob(job).catch((e) => {
        console.error(`[jobs] runJob ${job.id}:`, e);
      }).finally(() => {
        running--;
        schedule();
      });
    }
  } catch (e) {
    console.error('[jobs] tick:', e);
  }
  schedule();
}

async function claimNext() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, kind, params
         FROM jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`
    );
    if (!rows.length) {
      await client.query('COMMIT');
      return null;
    }
    const job = rows[0];
    await client.query(
      `UPDATE jobs SET status='running', started_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [job.id]
    );
    await client.query('COMMIT');
    return job;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const HANDLERS = {
  'generate-video': handleGenerateVideo,
  'generate-text-video': handleGenerateTextVideo,
};

async function runJob(job) {
  console.log(`[jobs] start ${job.id} (${job.kind})`);
  const handler = HANDLERS[job.kind];
  if (!handler) {
    await failJob(job.id, `kind sem handler: ${job.kind}`);
    return;
  }
  try {
    const { video_id, cost_actual, result } = await handler(job);
    await pool.query(
      `UPDATE jobs SET status='completed', completed_at=NOW(), updated_at=NOW(),
                       video_id=$1, cost_actual=$2, result=$3
        WHERE id=$4`,
      [video_id || null, cost_actual ?? null, result || null, job.id]
    );
    console.log(`[jobs] done  ${job.id} → video ${video_id}`);
  } catch (e) {
    console.error(`[jobs] fail  ${job.id}:`, e.message);
    await failJob(job.id, e.message || String(e));
  }
}

async function failJob(id, message) {
  await pool.query(
    `UPDATE jobs SET status='failed', completed_at=NOW(), updated_at=NOW(), error_message=$1
      WHERE id=$2`,
    [String(message).slice(0, 1000), id]
  );
}

// === handlers ===

async function modelCost(key, units = 1) {
  const { rows } = await pool.query(
    `SELECT cost_per_unit FROM models WHERE key = $1 AND enabled = TRUE`,
    [key]
  );
  if (!rows.length) return null;
  return Number((parseFloat(rows[0].cost_per_unit) * units).toFixed(4));
}

// Image-to-Video. params:
//   { image_url, motion_prompt, duration_s, model_key, image_prompt?, video_id? }
async function handleGenerateVideo(job) {
  const p = job.params || {};
  const result = await fal.generateVideo({
    image_url: p.image_url,
    prompt: p.motion_prompt,
    duration_s: p.duration_s,
    model_key: p.model_key,
  });
  const duration_s = result.duration_s;
  const cost = await modelCost(result.model, duration_s);
  const generated_at = new Date().toISOString();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let videoId = p.video_id || null;

    if (videoId) {
      // anexa attempt em vídeo existente
      const { rows } = await client.query(
        `SELECT generation_meta FROM videos WHERE id=$1 FOR UPDATE`,
        [videoId]
      );
      const meta = rows[0]?.generation_meta || {};
      const attempts = Array.isArray(meta.attempts) ? meta.attempts : [];
      const attemptId = `att-${attempts.length}-${Date.now()}`;
      const dstPath = `roto-master/videos/${videoId}/source-${attemptId}.mp4`;
      const stored = await uploadFromUrl(result.url, dstPath, 'video/mp4');
      attempts.push({
        url: stored.gcs_url,
        motion_prompt: p.motion_prompt,
        duration_s,
        source_image_url: p.image_url,
        cost,
        generated_at,
      });
      const newMeta = {
        ...meta,
        image_prompt: p.image_prompt || meta.image_prompt,
        image_url: p.image_url,
        model_motion: result.model,
        attempts,
        active_attempt_idx: attempts.length - 1,
      };
      await client.query(
        `UPDATE videos
            SET gcs_path=$1, gcs_url=$2, duration_s=$3, generation_meta=$4, updated_at=NOW()
          WHERE id=$5`,
        [stored.gcs_path, stored.gcs_url, duration_s, newMeta, videoId]
      );
    } else {
      // cria vídeo novo
      const name = (p.image_prompt || p.motion_prompt || 'sem nome').slice(0, 60).trim();
      const { rows: ins } = await client.query(
        `INSERT INTO videos (name, origin, gcs_path, gcs_url, duration_s)
         VALUES ($1, 'generated-generic', '', '', $2) RETURNING id`,
        [name, duration_s]
      );
      videoId = ins[0].id;
      const dstPath = `roto-master/videos/${videoId}/source-att-0-${Date.now()}.mp4`;
      const stored = await uploadFromUrl(result.url, dstPath, 'video/mp4');
      const newMeta = {
        image_prompt: p.image_prompt || null,
        image_url: p.image_url,
        model_motion: result.model,
        attempts: [{
          url: stored.gcs_url,
          motion_prompt: p.motion_prompt,
          duration_s,
          source_image_url: p.image_url,
          cost,
          generated_at,
        }],
        active_attempt_idx: 0,
      };
      await client.query(
        `UPDATE videos
            SET gcs_path=$1, gcs_url=$2, generation_meta=$3, updated_at=NOW()
          WHERE id=$4`,
        [stored.gcs_path, stored.gcs_url, newMeta, videoId]
      );
    }
    await client.query('COMMIT');
    return {
      video_id: videoId,
      cost_actual: cost,
      result: { duration_s, model: result.model },
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Text-to-Video. params:
//   { prompt, duration_s, model_key, mode, structured?, video_id? }
async function handleGenerateTextVideo(job) {
  const p = job.params || {};
  const result = await fal.generateTextVideo({
    prompt: p.prompt,
    duration_s: p.duration_s,
    model_key: p.model_key,
  });
  const duration_s = result.duration_s;
  const cost = await modelCost(result.model, duration_s);
  const generated_at = new Date().toISOString();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let videoId = p.video_id || null;

    if (videoId) {
      const { rows } = await client.query(
        `SELECT generation_meta FROM videos WHERE id=$1 FOR UPDATE`,
        [videoId]
      );
      const meta = rows[0]?.generation_meta || {};
      const attempts = Array.isArray(meta.attempts) ? meta.attempts : [];
      const attemptId = `att-${attempts.length}-${Date.now()}`;
      const dstPath = `roto-master/videos/${videoId}/source-${attemptId}.mp4`;
      const stored = await uploadFromUrl(result.url, dstPath, 'video/mp4');
      attempts.push({
        url: stored.gcs_url,
        motion_prompt: p.prompt,
        duration_s,
        mode: p.mode,
        structured: p.structured || null,
        cost,
        generated_at,
      });
      const newMeta = {
        ...meta,
        model_motion: result.model,
        attempts,
        active_attempt_idx: attempts.length - 1,
      };
      await client.query(
        `UPDATE videos
            SET gcs_path=$1, gcs_url=$2, duration_s=$3, generation_meta=$4, updated_at=NOW()
          WHERE id=$5`,
        [stored.gcs_path, stored.gcs_url, duration_s, newMeta, videoId]
      );
    } else {
      const name = (p.prompt || 'sem nome').slice(0, 60).trim();
      const { rows: ins } = await client.query(
        `INSERT INTO videos (name, origin, gcs_path, gcs_url, duration_s)
         VALUES ($1, 'generated-t2v', '', '', $2) RETURNING id`,
        [name, duration_s]
      );
      videoId = ins[0].id;
      const dstPath = `roto-master/videos/${videoId}/source-att-0-${Date.now()}.mp4`;
      const stored = await uploadFromUrl(result.url, dstPath, 'video/mp4');
      const newMeta = {
        model_motion: result.model,
        attempts: [{
          url: stored.gcs_url,
          motion_prompt: p.prompt,
          duration_s,
          mode: p.mode,
          structured: p.structured || null,
          cost,
          generated_at,
        }],
        active_attempt_idx: 0,
      };
      await client.query(
        `UPDATE videos
            SET gcs_path=$1, gcs_url=$2, generation_meta=$3, updated_at=NOW()
          WHERE id=$4`,
        [stored.gcs_path, stored.gcs_url, newMeta, videoId]
      );
    }
    await client.query('COMMIT');
    return {
      video_id: videoId,
      cost_actual: cost,
      result: { duration_s, model: result.model },
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function stop() {
  stopped = true;
  if (timer) clearTimeout(timer);
}

module.exports = { init, stop };
