import { authedFetch } from './auth.js';

export async function listAssets({ projectId, status } = {}) {
  const params = new URLSearchParams();
  if (projectId) params.set('project_id', projectId);
  if (status) params.set('status', status);
  const qs = params.toString();
  const r = await authedFetch('/api/assets' + (qs ? '?' + qs : ''));
  if (!r.ok) throw new Error('list assets: ' + r.status);
  const { assets } = await r.json();
  return assets;
}

export async function getAsset(id) {
  const r = await authedFetch(`/api/assets/${id}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('get asset: ' + r.status);
  const { asset } = await r.json();
  return asset;
}

export async function patchAsset(id, patch) {
  const r = await authedFetch(`/api/assets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'patch asset: ' + r.status);
  }
  const { asset } = await r.json();
  return asset;
}
