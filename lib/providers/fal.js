// Wrapper síncrono pro fal.ai queue API.
// Submete um job, faz polling até completar, retorna o resultado.
//
// Modelos usados:
//   fal-ai/nano-banana-pro          — texto → imagem
//   fal-ai/nano-banana-pro/edit     — texto + imagens-ref → imagem
//   fal-ai/kling-video/v2.5-turbo/pro/image-to-video — i2v 5s/10s, qualidade alta
//   fal-ai/kling-video/v2.5-turbo/pro/text-to-video  — t2v 5s/10s, qualidade alta
//   fal-ai/pixverse/v6/image-to-video — i2v 1-15s integer, mais barato, ideal pra clipes curtos
//   fal-ai/pixverse/v6/text-to-video  — t2v 1-15s integer
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
// model_key:
//   'nano-banana-pro' — fal-ai/nano-banana-pro (Gemini 3, default)
//   'nano-banana'     — fal-ai/nano-banana (Gemini 2.5 Flash, mais barato)
//   'gpt-image-2'     — fal-ai/openai/gpt-image-2 (OpenAI abr/2026, state-of-the-art)
// Cada modelo tem seu vocabulario de parametros. modelIdParaImagem retorna o
// id; bodyParaImagem monta o payload correto pra cada um.
function modelIdParaImagem(modelKey, useEdit) {
  if (modelKey === 'nano-banana') return useEdit ? 'fal-ai/nano-banana/edit' : 'fal-ai/nano-banana';
  if (modelKey === 'gpt-image-2') return useEdit ? 'fal-ai/openai/gpt-image-2/edit' : 'fal-ai/openai/gpt-image-2';
  return useEdit ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro';
}

function bodyParaImagem(modelKey, { prompt, ref_image_urls, aspect_ratio, resolution, useEdit }) {
  // GPT Image 2: usa image_urls (refs), image_size, quality. NAO aceita
  // aspect_ratio/resolution dos outros. image_size=auto deixa o modelo
  // escolher; nosso pipeline ja' redimensiona pro tamanho da tirinha depois.
  if (modelKey === 'gpt-image-2') {
    const base = { prompt, num_images: 1, quality: 'high', image_size: 'auto' };
    return useEdit ? { ...base, image_urls: ref_image_urls } : base;
  }
  // Nano Banana (Pro ou Flash): aspect_ratio + resolution + image_urls (no edit).
  const base = { prompt, aspect_ratio, resolution, num_images: 1 };
  return useEdit ? { ...base, image_urls: ref_image_urls } : base;
}

async function generateImage({ prompt, ref_image_urls, aspect_ratio = '16:9', resolution = '1K', model_key }) {
  const useEdit = Array.isArray(ref_image_urls) && ref_image_urls.length > 0;
  const modelId = modelIdParaImagem(model_key, useEdit);
  const body = bodyParaImagem(model_key, { prompt, ref_image_urls, aspect_ratio, resolution, useEdit });
  const res = await run(modelId, body, { timeoutMs: 90 * 1000 });
  const img = res?.images?.[0];
  if (!img?.url) throw new Error('fal: response sem images[0].url — ' + JSON.stringify(res).slice(0, 200));
  return { url: img.url, content_type: img.content_type || 'image/jpeg', model: modelId };
}

// Imagem + prompt → vídeo. Roteia entre Kling (5/10s, qualidade alta) e
// PixVerse V6 (1-15s integer, mais barato pra clipes curtos).
// model_key é a chave do nosso catálogo: 'kling-i2v' (default) ou 'pixverse-i2v'.
async function generateVideo({ image_url, prompt, duration_s = 5, model_key = 'kling-i2v' }) {
  if (model_key === 'pixverse-i2v') {
    const modelId = 'fal-ai/pixverse/v6/image-to-video';
    // PixVerse aceita inteiros de 1 a 15.
    const dur = Math.max(1, Math.min(15, Math.round(duration_s)));
    const body = { prompt, image_url, duration: dur, resolution: '720p' };
    const res = await run(modelId, body, { timeoutMs: 5 * 60 * 1000 });
    const v = res?.video;
    if (!v?.url) throw new Error('fal: response sem video.url — ' + JSON.stringify(res).slice(0, 200));
    return { url: v.url, content_type: v.content_type || 'video/mp4', model: modelId, duration_s: dur };
  }
  // Default: Kling 2.5 Turbo Pro.
  const modelId = 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video';
  const body = {
    prompt,
    image_url,
    duration: String(duration_s === 10 ? 10 : 5),
  };
  const res = await run(modelId, body, { timeoutMs: 5 * 60 * 1000 });
  const v = res?.video;
  if (!v?.url) throw new Error('fal: response sem video.url — ' + JSON.stringify(res).slice(0, 200));
  const klingDur = duration_s === 10 ? 10 : 5;
  return { url: v.url, content_type: v.content_type || 'video/mp4', model: modelId, duration_s: klingDur };
}

// Texto → vídeo. Mesma lógica de roteamento.
async function generateTextVideo({ prompt, duration_s = 5, model_key = 'kling-t2v' }) {
  if (model_key === 'pixverse-t2v') {
    const modelId = 'fal-ai/pixverse/v6/text-to-video';
    const dur = Math.max(1, Math.min(15, Math.round(duration_s)));
    const body = { prompt, duration: dur, resolution: '720p', aspect_ratio: '16:9' };
    const res = await run(modelId, body, { timeoutMs: 5 * 60 * 1000 });
    const v = res?.video;
    if (!v?.url) throw new Error('fal: response sem video.url — ' + JSON.stringify(res).slice(0, 200));
    return { url: v.url, content_type: v.content_type || 'video/mp4', model: modelId, duration_s: dur };
  }
  const modelId = 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video';
  const body = {
    prompt,
    duration: String(duration_s === 10 ? 10 : 5),
  };
  const res = await run(modelId, body, { timeoutMs: 5 * 60 * 1000 });
  const v = res?.video;
  if (!v?.url) throw new Error('fal: response sem video.url — ' + JSON.stringify(res).slice(0, 200));
  const klingDur = duration_s === 10 ? 10 : 5;
  return { url: v.url, content_type: v.content_type || 'video/mp4', model: modelId, duration_s: klingDur };
}

module.exports = { generateImage, generateVideo, generateTextVideo };
