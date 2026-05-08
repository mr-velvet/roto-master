// Cliente da API /api/jobs.

import { authedFetch } from './auth.js';

export async function listJobs({ since } = {}) {
  const qs = new URLSearchParams();
  if (since) qs.set('since', since);
  const r = await authedFetch('/api/jobs' + (qs.toString() ? '?' + qs : ''));
  if (!r.ok) throw new Error('list jobs: ' + r.status);
  const { jobs } = await r.json();
  return jobs;
}

export async function dismissJob(id) {
  const r = await authedFetch(`/api/jobs/${id}/dismiss`, { method: 'POST' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'dismiss: ' + r.status);
  }
  return r.json();
}

export async function dismissJobs(ids) {
  const r = await authedFetch(`/api/jobs/dismiss-many`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'dismiss-many: ' + r.status);
  }
  return r.json();
}
