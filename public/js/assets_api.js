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

// DELETE = jogar na lixeira (soft delete). Vídeo-fonte volta a rascunho.
export async function deleteAsset(id) {
  const r = await authedFetch(`/api/assets/${id}`, { method: 'DELETE' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'delete asset: ' + r.status);
  }
}

export async function listTrash() {
  const r = await authedFetch('/api/assets/trash');
  if (!r.ok) throw new Error('list trash: ' + r.status);
  const { assets } = await r.json();
  return assets;
}

export async function restoreAsset(id) {
  const r = await authedFetch(`/api/assets/${id}/restore`, { method: 'POST' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'restore: ' + r.status);
  }
}

export async function purgeAsset(id) {
  const r = await authedFetch(`/api/assets/${id}/purge`, { method: 'DELETE' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'purge: ' + r.status);
  }
}
