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
//   fal-ai/birefnet/v2              — remocao de fundo (PNG com alpha)
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
  // Modelos parceiros (openai, google, etc.) usam o namespace da org sem o prefixo fal-ai/.
  if (modelKey === 'gpt-image-2') return useEdit ? 'openai/gpt-image-2/edit' : 'openai/gpt-image-2';
  return useEdit ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro';
}

function bodyParaImagem(modelKey, { prompt, ref_image_urls, aspect_ratio, resolution, useEdit, target_w, target_h }) {
  // GPT Image 2: usa image_urls (refs), image_size, quality. NAO aceita
  // aspect_ratio/resolution dos outros. quality='medium' eh suficiente — saida
  // volta pra resolu~cao da tirinha (geralmente <=1080p) via resizePngTo,
  // ent~ao 'high' s~o queima tempo/$ sem ganho visivel.
  // image_size: se temos dimensoes-alvo, passa custom {width, height}
  // (multiplos de 16, aspect <= 3:1). Senao, 'auto'.
  if (modelKey === 'gpt-image-2') {
    let imageSize = 'auto';
    if (Number.isFinite(target_w) && Number.isFinite(target_h)) {
      const c = clampGptImageSize(target_w, target_h);
      if (c) imageSize = c;
    }
    const base = { prompt, num_images: 1, quality: 'medium', image_size: imageSize };
    return useEdit ? { ...base, image_urls: ref_image_urls } : base;
  }
  // Nano Banana (Pro ou Flash): aspect_ratio + resolution + image_urls (no edit).
  // aspect_ratio default '16:9' agora reflete o uso real (tirinha de video);
  // chamador deveria passar baseado nas dims da tirinha (ver aspectRatioParaNano).
  const base = { prompt, aspect_ratio, resolution, num_images: 1 };
  return useEdit ? { ...base, image_urls: ref_image_urls } : base;
}

// Calcula image_size {width, height} pro gpt-image-2 respeitando os limites:
//   - dimensoes multiplas de 16
//   - max edge 3840
//   - aspect <= 3:1
//   - total entre 655360 e 8294400 pixels
function clampGptImageSize(w, h) {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  let aspect = w / h;
  // clamp aspect a 3:1
  if (aspect > 3) aspect = 3;
  if (aspect < 1 / 3) aspect = 1 / 3;
  // alvo ~ 1MP (1024x1024 = 1048576). Calibra mantendo aspect.
  const TARGET_PIXELS = 1048576;
  let nh = Math.sqrt(TARGET_PIXELS / aspect);
  let nw = nh * aspect;
  // round pra mu’ltiplos de 16
  const r16 = (n) => Math.max(16, Math.round(n / 16) * 16);
  nw = r16(nw); nh = r16(nh);
  // garante max edge 3840 e total >= 655360 / <= 8294400
  while ((nw > 3840 || nh > 3840) && (nw > 16 && nh > 16)) {
    nw -= 16; nh -= 16;
  }
  const total = nw * nh;
  if (total < 655360 || total > 8294400) return null;
  return { width: nw, height: nh };
}

// Mapeia (w, h) da tirinha pro aspect_ratio enum do nano-banana.
// Modelos nano aceitam: '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'.
// Pega o mais proximo do aspect real.
const NANO_RATIOS = [
  { name: '1:1',  v: 1 / 1 },
  { name: '16:9', v: 16 / 9 },
  { name: '9:16', v: 9 / 16 },
  { name: '4:3',  v: 4 / 3 },
  { name: '3:4',  v: 3 / 4 },
  { name: '3:2',  v: 3 / 2 },
  { name: '2:3',  v: 2 / 3 },
];

function aspectRatioParaNano(w, h) {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '1:1';
  const a = w / h;
  let best = NANO_RATIOS[0];
  let bestDiff = Math.abs(Math.log(a / best.v));
  for (const r of NANO_RATIOS) {
    const d = Math.abs(Math.log(a / r.v));
    if (d < bestDiff) { bestDiff = d; best = r; }
  }
  return best.name;
}

// Timeout por modelo. GPT Image 2 com fila quente + paralelismo nosso
// (CONCURRENCY=3) pode demorar 2-3min em horarios de pico — 90s ficou apertado.
// Nano Banana eh mais consistente em ~30s; 90s sobra. Padroniza em 5min pra
// ser conservador, igual ao de vide o.
function timeoutImagem(modelKey) {
  if (modelKey === 'gpt-image-2') return 5 * 60 * 1000;
  return 90 * 1000;
}

async function generateImage({ prompt, ref_image_urls, aspect_ratio, resolution = '1K', model_key, target_w, target_h }) {
  const useEdit = Array.isArray(ref_image_urls) && ref_image_urls.length > 0;
  const modelId = modelIdParaImagem(model_key, useEdit);
  // Se temos dims-alvo, sobreescreve aspect_ratio (pra nano-banana) usando o
  // preset mais proximo. Se vier so' aspect_ratio do caller, respeita.
  let aspectFinal = aspect_ratio;
  if (Number.isFinite(target_w) && Number.isFinite(target_h)) {
    aspectFinal = aspectRatioParaNano(target_w, target_h);
  } else if (!aspectFinal) {
    aspectFinal = '1:1';
  }
  const body = bodyParaImagem(model_key, {
    prompt, ref_image_urls, aspect_ratio: aspectFinal, resolution, useEdit, target_w, target_h,
  });
  const res = await run(modelId, body, { timeoutMs: timeoutImagem(model_key) });
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

// Remocao de fundo via BiRefNet v2. Devolve PNG com alpha real.
// Modelo: fal-ai/birefnet/v2 — estado da arte pra ilustracao/personagem, captura
// cabelo/contornos finos. Custo ~$0.01/imagem.
// Input: image_url (URL publica). Output: { image: { url, content_type, ... } }.
async function removeBackground({ image_url }) {
  const modelId = 'fal-ai/birefnet/v2';
  const body = { image_url };
  const res = await run(modelId, body, { timeoutMs: 90 * 1000 });
  const img = res?.image;
  if (!img?.url) throw new Error('fal birefnet: response sem image.url — ' + JSON.stringify(res).slice(0, 200));
  return { url: img.url, content_type: img.content_type || 'image/png', model: modelId };
}

// Pra UI: descobre que ratio o modelo realmente vai usar dado (w, h) da tirinha.
// Retorna { ratio_label, ratio_value, exato: bool }. exato=true quando o modelo
// pode entregar exatamente o aspect alvo (gpt-image-2 sempre exato porque
// aceita dims custom; nano-banana exato so' se o aspect bate um dos presets).
function planejarRatio(modelKey, target_w, target_h) {
  if (!Number.isFinite(target_w) || !Number.isFinite(target_h) || target_w <= 0 || target_h <= 0) {
    return { ratio_label: '—', ratio_value: 1, exato: false };
  }
  const alvo = target_w / target_h;
  if (modelKey === 'gpt-image-2') {
    const c = clampGptImageSize(target_w, target_h);
    if (!c) return { ratio_label: '1:1', ratio_value: 1, exato: false };
    const v = c.width / c.height;
    return {
      ratio_label: `${c.width}×${c.height}`,
      ratio_value: v,
      exato: Math.abs(Math.log(v / alvo)) < 0.02, // ~2% tolerancia
    };
  }
  // nano-banana / nano-banana-pro: enums.
  const name = aspectRatioParaNano(target_w, target_h);
  const found = NANO_RATIOS.find((r) => r.name === name);
  return {
    ratio_label: name,
    ratio_value: found ? found.v : 1,
    exato: found ? Math.abs(Math.log(found.v / alvo)) < 0.02 : false,
  };
}

module.exports = { generateImage, generateVideo, generateTextVideo, removeBackground, planejarRatio };
