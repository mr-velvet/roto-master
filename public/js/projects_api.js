import { authedFetch } from './auth.js';

export async function listProjects() {
  const r = await authedFetch('/api/projects');
  if (!r.ok) throw new Error('list projects: ' + r.status);
  const { projects } = await r.json();
  return projects;
}

export async function createProject(name, description) {
  const r = await authedFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'create project: ' + r.status);
  }
  const { project } = await r.json();
  return project;
}

export async function getProject(id) {
  const r = await authedFetch(`/api/projects/${id}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('get project: ' + r.status);
  return r.json();
}

export async function patchProject(id, patch) {
  const r = await authedFetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'patch project: ' + r.status);
  }
  const { project } = await r.json();
  return project;
}

export async function deleteProject(id) {
  const r = await authedFetch(`/api/projects/${id}`, { method: 'DELETE' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'delete project: ' + r.status);
  }
}

export async function addMember(projectId, email) {
  const r = await authedFetch(`/api/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'add member: ' + r.status);
  }
  return r.json();
}

export async function removeMember(projectId, sub) {
  const r = await authedFetch(`/api/projects/${projectId}/members/${encodeURIComponent(sub)}`, {
    method: 'DELETE',
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'remove member: ' + r.status);
  }
}
