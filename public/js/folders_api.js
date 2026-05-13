// Cliente da API /api/folders.

import { authedFetch } from './auth.js';

export async function listFolders() {
  const r = await authedFetch('/api/folders');
  if (!r.ok) throw new Error('list folders: ' + r.status);
  return r.json();  // { folders: [...], root_count }
}

export async function createFolder(nome) {
  const r = await authedFetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'create folder: ' + r.status);
  }
  const { folder } = await r.json();
  return folder;
}

export async function renameFolder(id, nome) {
  const r = await authedFetch(`/api/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'rename folder: ' + r.status);
  }
  const { folder } = await r.json();
  return folder;
}

export async function deleteFolder(id) {
  const r = await authedFetch(`/api/folders/${id}`, { method: 'DELETE' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'delete folder: ' + r.status);
  }
  return r.json();
}
