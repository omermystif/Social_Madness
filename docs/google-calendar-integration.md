# Google Calendar Integration — Architecture

## Overview

The dashboard uses **Google Identity Services (GIS)** for OAuth 2.0 and the
**Google Calendar API v3 REST endpoints** directly via `fetch`. No backend
required for the current single-user / small-team usage.

This document explains how the integration works, the security tradeoffs, and
how to evolve it for production scale.

## Flow

```
1. User clicks "Connect Google" in the Topbar.
2. AuthContext.login() → gis.signIn() → tokenClient.requestAccessToken({prompt:''})
3. GIS opens a popup (first time) or returns silently (subsequent).
4. On success: { access_token, expires_in, scope } returned to handleTokenResponse.
5. Token + expiry stored in module-scope state (memory only — NO localStorage).
6. A setTimeout schedules silent reauth 5 minutes before expiry.
7. calendarApi.* calls getValidAccessToken() per request. Returns cached token
   if still valid, or triggers silent reauth.
8. On sign-out: revoke endpoint called + token cleared from memory +
   syncToken cache cleared.
```

## Authentication

- **Library:** Google Identity Services (`https://accounts.google.com/gsi/client`).
  Loaded `async defer` from `index.html`. No bundler import — global `window.google`.
- **Token type:** access tokens only. **No refresh tokens** ever issued to the
  browser. This is by design — refresh tokens in localStorage are an XSS
  exfiltration risk.
- **Session model:** access tokens live ~1 hour. Silent reauth via
  `prompt: ''` runs every ~55 minutes. If the user has revoked or signed out
  of Google, the silent flow fails with `'interaction_required'` and the user
  must click Connect again.
- **Popup vs redirect:** GIS uses `postMessage` from a popup. No `/auth/callback`
  route. Authorized JavaScript Origins (not redirect URIs) configure the
  allowed parents.

## Scopes

Requested:

| Scope | Purpose |
|-------|---------|
| `https://www.googleapis.com/auth/calendar.events` | Read + write events on the user's calendars |

`calendar.events` is a **sensitive** scope. Once the app exceeds 100 external
users, it must pass Google's OAuth verification (privacy policy + scope
justification video).

Granted scopes are checked after sign-in via `fullyAuthorized` in AuthContext.
A `Partial scope` warning chip in the Topbar surfaces partial grants.

## Calendar API

`src/api/calendarApi.js` — bare-bones REST client. Highlights:

### Retry with exponential backoff + jitter

```
withRetry(fn, { tries: 5, baseMs: 250 })
```

- Retries on 429 (rate limit) and 5xx (server error).
- Non-retryable: any non-429 4xx (bad request, unauthorized, etc.).
- Delay: `250 * 2^n + rand(250)` ms — max wait at try 5 ≈ 4 seconds.

### Incremental sync via syncToken

```
syncEvents({ calendarId, initialTimeMin, initialTimeMax })
  → { items, syncToken, fresh }
```

- First call performs a windowed full sync; the API returns `nextSyncToken`.
- Subsequent calls pass `syncToken=…` and receive only changes since the
  previous sync (created / updated / cancelled events).
- `syncToken` is cached in `localStorage` under `gcal_sync_<calendarId>`.
- On `410 Gone` (token too old / pruned), the cached token is dropped and a
  fresh full sync runs automatically.

Cancelled events come back with `status: 'cancelled'` — UI filters them out
in `CalendarPage`.

### Time zone

`withTimeZone(eventBody)` automatically injects
`timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone` into any
`start.dateTime` or `end.dateTime` that lacks one. Prevents events from
landing in the wrong zone when the calendar default differs from the user's
browser.

### Batch endpoint

```
batchCreateEvents(calendarId, events)  // up to 50 events per request
```

Multipart POST to `/batch/calendar/v3`. Used for bulk-seeding (e.g., creating
calendar events for every dashboard task at once).

## Files

| File | Role |
|------|------|
| `index.html` | Loads GIS script (`<script async defer src="…/gsi/client">`) |
| `src/auth/gis.js` | Singleton wrapper around `google.accounts.oauth2.initTokenClient`. Owns token state + silent-reauth timer. |
| `src/context/AuthContext.jsx` | React adapter that subscribes to `gis.subscribe(...)` and exposes `useAuth()`. |
| `src/api/calendarApi.js` | REST client. Retry, sync token, time zone, batch. |
| `.env` | `VITE_GOOGLE_CLIENT_ID` only. No client secret. No redirect URI. |

## Google Cloud setup

1. **APIs & Services → Library → Google Calendar API → Enable**.
2. **OAuth consent screen:**
   - User Type: External (or Internal if Workspace).
   - App name, support email, developer contact.
   - Scope: `https://www.googleapis.com/auth/calendar.events`.
   - Test users (until verified): list of team email addresses.
3. **Credentials → Create Credentials → OAuth client ID → Web application:**
   - Authorized JavaScript origins: `http://localhost:5181` + production origin.
   - Authorized redirect URIs: **none** — GIS uses postMessage.
4. Copy Client ID → `VITE_GOOGLE_CLIENT_ID` in `.env`.
5. Before launching to >100 external users: submit OAuth verification.

## What was removed

The previous integration ran a hand-rolled Authorization Code + PKCE flow,
stored refresh tokens in `localStorage`, and lived under `src/auth/pkce.js`
+ `src/auth/googleAuth.js`. Both files were deleted in this migration.

The `/auth/callback` route handler in `AuthContext` was also removed; GIS's
postMessage popup means no redirect URI is needed.

## Future hardening (when a backend exists)

- Move the OAuth Authorization Code flow server-side; the browser receives
  short-lived access tokens via session cookie. Refresh tokens stored
  HttpOnly in a database.
- Subscribe to `events.watch` push channels for real-time event updates;
  webhooks land on the backend, which forwards to connected clients via
  WebSocket or SSE.
- Add `If-None-Match` ETag support on `events.get` to skip unchanged payloads.

These remain drop-in additions — the current `gis.js` interface (`getValidAccessToken`,
`signIn`, `signOut`) can be re-implemented to call a backend `/api/token` endpoint
without touching `calendarApi.js`.
