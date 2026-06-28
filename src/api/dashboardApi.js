// Client SDK for the self-hosted backend.
// Reads VITE_API_URL — if absent, isEnabled() returns false and the app
// falls back to its existing localStorage-only behavior (no breaking change).
//
// All requests pass the active Google access token as Bearer credentials,
// matching the server's middleware/auth.js contract.

import { getValidAccessToken } from '../auth/gis.js';

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export function isEnabled() {
  return !!BASE;
}

async function req(path, { method = 'GET', body, query } = {}) {
  if (!BASE) throw new Error('API not configured (VITE_API_URL missing)');
  let url = `${BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) params.set(k, v);
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const token = await getValidAccessToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(data?.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}

// ─── Teams ───────────────────────────────────────────────────────────────
export const teams = {
  list:    ()           => req('/api/teams'),
  create:  (name)       => req('/api/teams', { method: 'POST', body: { name } }),
  update:  (id, patch)  => req(`/api/teams/${id}`, { method: 'PATCH', body: patch }),
  remove:  (id)         => req(`/api/teams/${id}`, { method: 'DELETE' }),
};

// ─── Members ─────────────────────────────────────────────────────────────
export const members = {
  list:    (teamId)              => req(`/api/teams/${teamId}/members`),
  create:  (teamId, m)            => req(`/api/teams/${teamId}/members`,           { method: 'POST', body: m }),
  update:  (teamId, email, p)     => req(`/api/teams/${teamId}/members/${encodeURIComponent(email)}`, { method: 'PATCH', body: p }),
  remove:  (teamId, email, opts) => req(`/api/teams/${teamId}/members/${encodeURIComponent(email)}`, { method: 'DELETE', query: { reassign_to: opts?.reassignTo } }),
};

// ─── Tasks ───────────────────────────────────────────────────────────────
export const tasks = {
  list:    (teamId, query = {})  => req('/api/tasks',           { query: { team_id: teamId, ...query } }),
  get:     (id)                   => req(`/api/tasks/${id}`),
  create:  (data)                 => req('/api/tasks',           { method: 'POST',  body: data }),
  update:  (id, patch)            => req(`/api/tasks/${id}`,     { method: 'PATCH', body: patch }),
  remove:  (id)                   => req(`/api/tasks/${id}`,     { method: 'DELETE' }),
  setPersonalSync:    (id, m) => req(`/api/tasks/${id}/personal-sync`, { method: 'PUT', body: m }),
  clearPersonalSync:  (id, email) => req(`/api/tasks/${id}/personal-sync/${encodeURIComponent(email)}`, { method: 'DELETE' }),
};

// ─── Settings ────────────────────────────────────────────────────────────
export const settings = {
  list:   (teamId)          => req(`/api/teams/${teamId}/settings`),
  put:    (teamId, key, value) => req(`/api/teams/${teamId}/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } }),
  remove: (teamId, key)        => req(`/api/teams/${teamId}/settings/${encodeURIComponent(key)}`, { method: 'DELETE' }),
};

// ─── Audit ───────────────────────────────────────────────────────────────
export const audit = {
  list:   (teamId, limit = 200) => req(`/api/teams/${teamId}/audit`, { query: { limit } }),
  log:    (teamId, action, details) => req('/api/audit', { method: 'POST', body: { team_id: teamId, action, details } }),
};

// ─── Health ──────────────────────────────────────────────────────────────
export const health = () => req('/api/health');

export default {
  isEnabled,
  teams, members, tasks, settings, audit, health,
};
