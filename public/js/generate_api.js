// Cliente da API /api/generate e /api/models.

import { authedFetch } from './auth.js';

export async function listModels() {
  const r = await authedFetch('/api/models');
  if (!r.ok) throw new Error('list models: ' + r.status);
  const { models } = await r.json();
  return models;
}

export async function enhancePrompt({ prompt, kind }) {
  const r = await authedFetch('/api/generate/enhance-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, kind }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'enhance: ' + r.status);
  }
  const { prompt: enhanced } = await r.json();
  return enhanced;
}

export async function uploadRef(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await authedFetch('/api/generate/ref-upload', { method: 'POST', body: fd });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'ref upload: ' + r.status);
  }
  const { url } = await r.json();
  return url;
}

export async function generateImage({ prompt, ref_image_urls }) {
  const r = await authedFetch('/api/generate/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ref_image_urls }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'generate image: ' + r.status);
  }
  return r.json();
}

export async function generateVideo({ image_url, motion_prompt, duration_s, image_prompt, video_id }) {
  const r = await authedFetch('/api/generate/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url, motion_prompt, duration_s, image_prompt, video_id }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'generate video: ' + r.status);
  }
  return r.json();
}

export async function setActiveAttempt(videoId, idx) {
  const r = await authedFetch(`/api/videos/${videoId}/active-attempt`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idx }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'active-attempt: ' + r.status);
  }
  const { video } = await r.json();
  return video;
}
