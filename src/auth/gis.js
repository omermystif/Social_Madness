// Google Identity Services (GIS) token-client wrapper.
//
// Replaces hand-rolled OAuth 2.0 PKCE flow.
// - Access tokens live in memory only (no localStorage), reducing XSS blast radius.
// - Silent reauth scheduled 5 minutes before token expiry.
// - Token client is a singleton; multiple subscribers receive state changes via subscribe().
// - calendarApi.js calls getValidAccessToken() directly — no React dependency.

const OVERRIDE_KEY = 'gcal_client_id_override';
const ENV_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function readClientId() {
  let override = null;
  try { override = localStorage.getItem(OVERRIDE_KEY); } catch {}
  const id = (override && override.trim()) || ENV_ID;
  return id || '';
}
let CLIENT_ID = readClientId();
// openid + email → enables userinfo endpoint (returns sub, email, name, picture)
// without those, /oauth2/v3/userinfo returns 401.
const SCOPES  = 'openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file';

export function setClientIdOverride(id) {
  const trimmed = (id || '').trim();
  if (!trimmed) {
    try { localStorage.removeItem(OVERRIDE_KEY); } catch {}
  } else {
    try { localStorage.setItem(OVERRIDE_KEY, trimmed); } catch {}
  }
  CLIENT_ID = readClientId();
  // Force fresh init on next signIn — discard old client.
  tokenClient = null;
}
const REFRESH_LEAD_MS = 5 * 60 * 1000;
const GIS_SRC = 'https://accounts.google.com/gsi/client';

let tokenClient    = null;
let scriptPromise  = null;
let pendingResolve = null;
let pendingReject  = null;
let refreshTimer   = null;

let state = {
  accessToken: null,
  expiresAt:   0,
  scopes:      [],
  loading:     false,
  error:       null,
  profile:     null, // { sub, email, email_verified, name, picture } after userinfo fetch
};

const listeners = new Set();

function emit() { listeners.forEach((fn) => fn(state)); }
function setState(patch) { state = { ...state, ...patch }; emit(); }

export const SCOPES_REQUESTED = SCOPES.split(' ');
export function isConfigured() { return !!CLIENT_ID && !CLIENT_ID.startsWith('YOUR_CLIENT_ID'); }
export function getState()     { return state; }
export function subscribe(fn)  { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
export function grantedScope(scope) { return state.scopes.includes(scope); }

function loadScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Window not available'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    // Script tag already injected via index.html — wait for it to load.
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      const check = () => {
        if (window.google?.accounts?.oauth2) resolve();
        else if (existing.dataset.loadFailed) reject(new Error('GIS script failed to load'));
        else setTimeout(check, 50);
      };
      existing.addEventListener('error', () => { existing.dataset.loadFailed = '1'; reject(new Error('GIS script error')); }, { once: true });
      check();
      return;
    }
    // Fallback: inject manually
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true; s.defer = true;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services script'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export async function init() {
  if (!isConfigured()) throw new Error('VITE_GOOGLE_CLIENT_ID not set in .env');
  await loadScript();
  if (tokenClient) return;

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: handleTokenResponse,
    error_callback: handleErrorCallback,
  });
}

function handleTokenResponse(response) {
  if (response.error) {
    handleErrorCallback({ type: response.error, message: response.error_description || response.error });
    return;
  }
  const expiresAt = Date.now() + (Number(response.expires_in) - 30) * 1000;
  const scopes    = (response.scope || '').split(' ').filter(Boolean);
  setState({
    accessToken: response.access_token,
    expiresAt,
    scopes,
    loading:     false,
    error:       null,
  });
  scheduleRefresh(expiresAt);

  // Fire-and-forget userinfo fetch — populates profile in state when ready.
  // Needs openid + email scopes (already requested via SCOPES).
  fetchUserInfo(response.access_token).then(
    (profile) => setState({ profile }),
    (err) => console.warn('Userinfo fetch failed:', err?.message || err),
  );

  pendingResolve?.(response);
  pendingResolve = null;
  pendingReject  = null;
}

async function fetchUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`Userinfo ${res.status}: ${txt.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function handleErrorCallback(errObj) {
  const err = new Error(errObj?.message || errObj?.type || 'GIS error');
  err.code = errObj?.type || 'unknown_error';
  setState({ loading: false, error: err });
  pendingReject?.(err);
  pendingResolve = null;
  pendingReject  = null;
}

function scheduleRefresh(expiresAt) {
  clearTimeout(refreshTimer);
  const ms = expiresAt - Date.now() - REFRESH_LEAD_MS;
  refreshTimer = setTimeout(() => {
    requestToken().catch((err) => console.warn('Silent reauth failed:', err.code || err.message));
  }, Math.max(ms, 1000));
}

function requestToken() {
  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject  = reject;
    try {
      // prompt: '' → reuses prior consent silently when possible; falls back to popup if needed.
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (err) {
      pendingResolve = null;
      pendingReject  = null;
      reject(err);
    }
  });
}

// User-initiated sign-in. Call from a click handler so popup is not blocked.
export async function signIn() {
  await init();
  setState({ loading: true, error: null });
  try {
    return await requestToken();
  } catch (err) {
    setState({ loading: false });
    throw err;
  }
}

export function signOut() {
  if (state.accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(state.accessToken, () => {});
  }
  clearTimeout(refreshTimer);
  setState({ accessToken: null, expiresAt: 0, scopes: [], error: null, profile: null });
}

// Used by calendarApi — guarantees a fresh (or freshly-refreshed) access token.
export async function getValidAccessToken() {
  if (!isConfigured()) throw new Error('Google Calendar not configured. Set VITE_GOOGLE_CLIENT_ID.');
  if (state.accessToken && Date.now() < state.expiresAt) return state.accessToken;
  await init();
  await requestToken();
  if (!state.accessToken) throw new Error('Unable to obtain access token');
  return state.accessToken;
}
