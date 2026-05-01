// Cliente da API /api/videos.

import { authedFetch } from './auth.js';

export async function listVideos() {
  const r = await authedFetch('/api/videos');
  if (!r.ok) throw new Error('list videos: ' + r.status);
  const { videos } = await r.json();
  return videos;
}

export async function createVideo(name) {
  const r = await authedFetch('/api/videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'create video: ' + r.status);
  }
  const { video } = await r.json();
  return video;
}

export async function getVideo(id) {
  const r = await authedFetch(`/api/videos/${id}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('get video: ' + r.status);
  const { video } = await r.json();
  return video;
}

export async function patchVideo(id, patch) {
  const r = await authedFetch(`/api/videos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'patch video: ' + r.status);
  }
  const { video } = await r.json();
  return video;
}

export async function deleteVideo(id) {
  const r = await authedFetch(`/api/videos/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error('delete video: ' + r.status);
}
