// Google Calendar API v3 client.
//
// - Auth: gis.js getValidAccessToken() (Google Identity Services)
// - Retry: exponential backoff + jitter on 429 / 5xx (5 tries max)
// - Sync: incremental via syncToken (see syncEvents); falls back to full sync on 410 Gone
// - Time zones: applied automatically from Intl.DateTimeFormat() if omitted
// - Batch: batchCreateEvents() uses the /batch endpoint for up to 50 events / round-trip

import { getValidAccessToken, isConfigured } from '../auth/gis.js';

const BASE      = 'https://www.googleapis.com/calendar/v3';
const BATCH_URL = 'https://www.googleapis.com/batch/calendar/v3';
const LOCAL_TZ  = (typeof Intl !== 'undefined') ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
const SYNC_KEY_PREFIX = 'gcal_sync_';

// ─── Retry helper ───────────────────────────────────────────────────────────
async function withRetry(fn, { tries = 5, baseMs = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.status;
      // Non-retryable: any non-429 4xx.
      if (status && status !== 429 && status < 500) throw err;
      if (i === tries - 1) break;
      const delay = baseMs * Math.pow(2, i) + Math.random() * baseMs;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function rawFetch(path, options = {}) {
  const token = await getValidAccessToken();
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Calendar API ${res.status}: ${text.slice(0, 240)}`);
    err.status = res.status;
    err.body   = text;
    throw err;
  }
  return res;
}

async function gcalFetch(path, options = {}) {
  const res = await withRetry(() => rawFetch(path, options));
  if (res.status === 204) return null;
  return res.json();
}

// ─── Time-zone injection ────────────────────────────────────────────────────
function withTimeZone(eventBody) {
  if (!eventBody) return eventBody;
  const out = { ...eventBody };
  if (out.start?.dateTime && !out.start.timeZone) out.start = { ...out.start, timeZone: LOCAL_TZ };
  if (out.end?.dateTime   && !out.end.timeZone)   out.end   = { ...out.end,   timeZone: LOCAL_TZ };
  return out;
}

// ─── Calendars ──────────────────────────────────────────────────────────────
export async function listCalendars() {
  if (!isConfigured()) return [];
  const data = await gcalFetch('/users/me/calendarList');
  return data?.items || [];
}

// ─── Events (windowed) ──────────────────────────────────────────────────────
export async function listEvents({
  calendarId   = 'primary',
  timeMin,
  timeMax,
  maxResults   = 250,
  singleEvents = true,
  orderBy      = 'startTime',
} = {}) {
  if (!isConfigured()) return [];
  const items = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      maxResults:   String(maxResults),
      singleEvents: String(singleEvents),
      orderBy,
      ...(timeMin && { timeMin }),
      ...(timeMax && { timeMax }),
      ...(pageToken && { pageToken }),
    });
    const data = await gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    items.push(...(data?.items || []));
    pageToken = data?.nextPageToken;
  } while (pageToken);
  return items;
}

// ─── Events (incremental sync) ──────────────────────────────────────────────
// First call: full sync within initialTimeMin/initialTimeMax window.
// Subsequent calls: only deltas since previous sync. Cancelled events appear with status='cancelled'.
// Returns { items, syncToken, fresh } where fresh=true on first-time / 410-recovery sync.
export async function syncEvents({ calendarId = 'primary', initialTimeMin, initialTimeMax } = {}) {
  if (!isConfigured()) return { items: [], syncToken: null, fresh: true };

  const key = SYNC_KEY_PREFIX + calendarId;
  let storedToken = null;
  try { storedToken = localStorage.getItem(key); } catch {}
  const usingSyncToken = !!storedToken;

  const items = [];
  let pageToken;
  let nextSyncToken = null;

  try {
    do {
      const params = new URLSearchParams({
        singleEvents: 'true',
        maxResults:   '250',
        ...(pageToken && { pageToken }),
        ...(usingSyncToken
          ? { syncToken: storedToken }
          : {
              ...(initialTimeMin && { timeMin: initialTimeMin }),
              ...(initialTimeMax && { timeMax: initialTimeMax }),
            }),
      });
      const data = await gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
      items.push(...(data?.items || []));
      pageToken = data?.nextPageToken;
      nextSyncToken = data?.nextSyncToken || nextSyncToken;
    } while (pageToken);
  } catch (err) {
    if (err.status === 410 && usingSyncToken) {
      // Sync token invalidated (too old, calendar pruned). Drop and resync.
      try { localStorage.removeItem(key); } catch {}
      return syncEvents({ calendarId, initialTimeMin, initialTimeMax });
    }
    throw err;
  }

  if (nextSyncToken) {
    try { localStorage.setItem(key, nextSyncToken); } catch {}
  }
  return { items, syncToken: nextSyncToken, fresh: !usingSyncToken };
}

export function resetSyncToken(calendarId = 'primary') {
  try { localStorage.removeItem(SYNC_KEY_PREFIX + calendarId); } catch {}
}

// ─── Today helper (used by Overview) ────────────────────────────────────────
export async function getTodaysEvents(calendarId = 'primary') {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end   = new Date(); end.setHours(23, 59, 59, 999);
  return listEvents({
    calendarId,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    maxResults: 50,
  });
}

// ─── Event mutations ────────────────────────────────────────────────────────
export async function createEvent(calendarId = 'primary', eventBody) {
  return gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body:   JSON.stringify(withTimeZone(eventBody)),
  });
}

export async function updateEvent(calendarId = 'primary', eventId, patch) {
  return gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'PATCH',
    body:   JSON.stringify(withTimeZone(patch)),
  });
}

export async function deleteEvent(calendarId = 'primary', eventId) {
  return gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, { method: 'DELETE' });
}

export async function createTaskEvent({ taskName, assigneeEmail, dueDate, durationMinutes = 30 }) {
  const start = new Date(dueDate); start.setHours(9, 0, 0, 0);
  const end   = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return createEvent('primary', {
    summary:     `[Task] ${taskName}`,
    description: `Assigned to ${assigneeEmail} via Command Dashboard.`,
    start:       { dateTime: start.toISOString(), timeZone: LOCAL_TZ },
    end:         { dateTime: end.toISOString(),   timeZone: LOCAL_TZ },
    attendees:   [{ email: assigneeEmail }],
    reminders:   { useDefault: false, overrides: [{ method: 'email', minutes: 60 }] },
  });
}

// ─── Batch create (up to 50 events / request) ───────────────────────────────
// Returns the raw multipart response body (string). Sub-status parsing optional.
export async function batchCreateEvents(calendarId = 'primary', events) {
  if (!events?.length) return '';
  if (events.length > 50) throw new Error('Calendar batch limit is 50 events per request.');

  const token = await getValidAccessToken();
  const boundary = 'batch_' + Math.random().toString(36).slice(2);
  const parts = events.map((ev, i) => {
    const body = JSON.stringify(withTimeZone(ev));
    return [
      `--${boundary}`,
      `Content-Type: application/http`,
      `Content-ID: <item-${i}>`,
      ``,
      `POST /calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      `Content-Type: application/json; charset=UTF-8`,
      `Content-Length: ${body.length}`,
      ``,
      body,
    ].join('\r\n');
  });
  const reqBody = parts.join('\r\n') + `\r\n--${boundary}--\r\n`;

  const res = await withRetry(async () => {
    const r = await fetch(BATCH_URL, {
      method:  'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/mixed; boundary=${boundary}`,
      },
      body: reqBody,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const err = new Error(`Batch ${r.status}: ${text.slice(0, 240)}`);
      err.status = r.status;
      throw err;
    }
    return r;
  });
  return res.text();
}
