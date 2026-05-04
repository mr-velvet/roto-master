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

export async function duplicateVideo(id) {
  const r = await authedFetch(`/api/videos/${id}/duplicate`, { method: 'POST' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'duplicate video: ' + r.status);
  }
  const { video } = await r.json();
  return video;
}

export async function uploadVideoFile(id, file, metadata = {}) {
  const fd = new FormData();
  fd.append('file', file);
  if (metadata.duration_s != null) fd.append('duration_s', String(metadata.duration_s));
  if (metadata.width != null) fd.append('width', String(metadata.width));
  if (metadata.height != null) fd.append('height', String(metadata.height));
  const r = await authedFetch(`/api/videos/${id}/upload`, { method: 'POST', body: fd });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'upload video: ' + r.status);
  }
  const { video } = await r.json();
  return video;
}

export async function publishVideo(id, file, projectId, assetName) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('project_id', projectId);
  if (assetName) fd.append('asset_name', assetName);
  const r = await authedFetch(`/api/videos/${id}/publish`, { method: 'POST', body: fd });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    const e = new Error(err.error || 'publish video: ' + r.status);
    e.published_asset_id = err.published_asset_id;
    e.status = r.status;
    throw e;
  }
  const { asset } = await r.json();
  return asset;
}

export async function publishAsset(assetId, file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await authedFetch(`/api/assets/${assetId}/publish`, { method: 'POST', body: fd });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'publish asset: ' + r.status);
  }
  const { asset } = await r.json();
  return asset;
}
