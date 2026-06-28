// API client stub.
//
// Imported by src/hooks/useServerTasks.js. Only invoked when
// VITE_STORAGE_MODE === 'server'. With server mode disabled, this module is
// included in the bundle (static import) but its functions are never called,
// so the network paths are dead at runtime.
//
// When a real backend exists, set VITE_API_URL and VITE_STORAGE_MODE=server.
// Until then this stub lets the build succeed without throwing.

import { getValidAccessToken } from '../auth/gis.js';

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function request(path, { method = 'GET', body, query, headers } = {}) {
  if (!BASE) throw new Error('VITE_API_URL not set — server mode is disabled.');
  const token = await getValidAccessToken();
  const qs = query
    ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([, v]) => v != null && v !== ''))).toString()
    : '';
  const res = await fetch(`${BASE}${path}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    body: body == null ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`API ${res.status}: ${text.slice(0, 240)}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

const api = {
  health: () => fetch(`${BASE}/health`).then(r => r.json()),
  me:     () => request('/me'),
  tasks: {
    list:       (q)        => request('/tasks', { query: q }),
    create:     (t)        => request('/tasks', { method: 'POST',   body: t }),
    update:     (id, p)    => request(`/tasks/${id}`, { method: 'PATCH', body: p }),
    remove:     (id)       => request(`/tasks/${id}`, { method: 'DELETE' }),
    complete:   (id)       => request(`/tasks/${id}/complete`,   { method: 'POST' }),
    uncomplete: (id)       => request(`/tasks/${id}/uncomplete`, { method: 'POST' }),
    reschedule: (id, p)    => request(`/tasks/${id}/reschedule`, { method: 'POST', body: p }),
  },
  teams: {
    list:   ()             => request('/teams'),
    create: (t)            => request('/teams', { method: 'POST', body: t }),
    update: (id, p)        => request(`/teams/${id}`, { method: 'PATCH', body: p }),
    remove: (id)           => request(`/teams/${id}`, { method: 'DELETE' }),
    members: {
      list:   (teamId)               => request(`/teams/${teamId}/members`),
      add:    (teamId, m)            => request(`/teams/${teamId}/members`, { method: 'POST', body: m }),
      update: (teamId, email, p)     => request(`/teams/${teamId}/members/${encodeURIComponent(email)}`, { method: 'PATCH', body: p }),
      remove: (teamId, email, reassignTo) => request(`/teams/${teamId}/members/${encodeURIComponent(email)}`, { method: 'DELETE', query: { reassignTo } }),
    },
  },
  audit: {
    list: (q) => request('/audit', { query: q }),
  },
  settings: {
    list:   (teamId)             => request('/settings',         { query: { teamId } }),
    get:    (teamId, k)          => request(`/settings/${encodeURIComponent(k)}`, { query: { teamId } }),
    set:    (teamId, k, v)       => request(`/settings/${encodeURIComponent(k)}`, { method: 'PUT', body: { teamId, value: v } }),
    remove: (teamId, k)          => request(`/settings/${encodeURIComponent(k)}`, { method: 'DELETE', query: { teamId } }),
  },
};

export default api;
