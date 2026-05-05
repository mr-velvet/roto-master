// Wrapper síncrono pro fal.ai queue API.
// Submete um job, faz polling até completar, retorna o resultado.
//
// Modelos usados (em 2026-05-04):
//   fal-ai/nano-banana-pro          — texto → imagem
//   fal-ai/nano-banana-pro/edit     — texto + imagens-ref → imagem
//   fal-ai/kling-video/v2.5-turbo/pro/image-to-video — i2v (5s ou 10s)
//
// Auth: header `Authorization: Key <FAL_KEY>` na env `FAL_KEY`.

const FAL_KEY = process.env.FAL_KEY;
const QUEUE_BASE = 'https://queue.fal.run';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS_DEFAULT = 5 * 60 * 1000; // 5min é folgado pra imagem (~30s) e vídeo (~120s)

function authHeaders() {
  if (!FAL_KEY) throw new Error('FAL_KEY env não configurada');
  return { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' };
}

async function submit(modelId, body) {
  const r = await fetch(`${QUEUE_BASE}/${modelId}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`fal submit ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

async function pollUntilDone(statusUrl, resultUrl, timeoutMs) {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > timeoutMs) throw new Error('fal poll timeout');
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
    const r = await fetch(statusUrl, { headers: authHeaders() });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`fal status ${r.status}: ${text.slice(0, 200)}`);
    }
    const data = await r.json();
    if (data.status === 'COMPLETED') {
      const rr = await fetch(resultUrl, { headers: authHeaders() });
      if (!rr.ok) {
        const text = await rr.text().catch(() => '');
        throw new Error(`fal result ${rr.status}: ${text.slice(0, 200)}`);
      }
      return rr.json();
    }
    if (data.status === 'FAILED' || data.status === 'CANCELLED') {
      const msg = data.error?.message || data.error || 'fal job falhou';
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    // IN_QUEUE | IN_PROGRESS — segue
  }
}

async function run(modelId, body, opts = {}) {
  const submitted = await submit(modelId, body);
  return pollUntilDone(
    submitted.status_url,
    submitted.response_url,
    opts.timeoutMs || POLL_TIMEOUT_MS_DEFAULT
  );
}

// ----- modelos específicos -----

// Texto → imagem. Refs opcionais usam endpoint /edit.
async function generateImage({ prompt, ref_image_urls, aspect_ratio = '16:9', resolution = '1K' }) {
  const useEdit = Array.isArray(ref_image_urls) && ref_image_urls.length > 0;
  const modelId = useEdit ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro';
  const body = useEdit
    ? { prompt, image_urls: ref_image_urls, aspect_ratio, resolution, num_images: 1 }
    : { prompt, aspect_ratio, resolution, num_images: 1 };
  const res = await run(modelId, body, { timeoutMs: 90 * 1000 });
  const img = res?.images?.[0];
  if (!img?.url) throw new Error('fal: response sem images[0].url — ' + JSON.stringify(res).slice(0, 200));
  return { url: img.url, content_type: img.content_type || 'image/jpeg', model: modelId };
}

// Imagem + prompt → vídeo. duration é 5 ou 10 (Kling).
async function generateVideo({ image_url, prompt, duration_s = 5 }) {
  const modelId = 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video';
  const body = {
    prompt,
    image_url,
    duration: String(duration_s === 10 ? 10 : 5),
  };
  const res = await run(modelId, body, { timeoutMs: 5 * 60 * 1000 });
  const v = res?.video;
  if (!v?.url) throw new Error('fal: response sem video.url — ' + JSON.stringify(res).slice(0, 200));
  return { url: v.url, content_type: v.content_type || 'video/mp4', model: modelId, duration_s };
}

// Texto → vídeo (Kling 2.5 t2v). Sem imagem inicial; duração 5 ou 10.
async function generateTextVideo({ prompt, duration_s = 5 }) {
  const modelId = 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video';
  const body = {
    prompt,
    duration: String(duration_s === 10 ? 10 : 5),
  };
  const res = await run(modelId, body, { timeoutMs: 5 * 60 * 1000 });
  const v = res?.video;
  if (!v?.url) throw new Error('fal: response sem video.url — ' + JSON.stringify(res).slice(0, 200));
  return { url: v.url, content_type: v.content_type || 'video/mp4', model: modelId, duration_s };
}

module.exports = { generateImage, generateVideo, generateTextVideo };
