// Cloud sync — one-way pipeline: localhost → Vercel KV → prod read-only view.
//
// Direction modes:
//   'push-only' (localhost default): PUT changes to KV, NEVER GET. Local state is
//                                     authoritative; no remote can overwrite it.
//   'pull-only' (prod default):      GET periodically, NEVER PUT. Prod app is a
//                                     read-only view of whatever localhost wrote.
//   'bidirectional' (opt-in):        Original two-way behavior (push + pull).
//
// Default selection (when no `direction` opt is passed):
//   - hostname === 'localhost' / 127.0.0.1 → push-only
//   - otherwise (Vercel deploy, custom domain) → pull-only
//
// Override via VITE_CLOUD_SYNC_DIRECTION env (push-only | pull-only | bidirectional).
//
// Tracked keys mirror SNAPSHOT_KEYS in TaskContext.

const ENDPOINT = '/api/state';
const VERSION_LOCALSTORAGE_KEY = 'cmd_cloud_known_version';
const STATE_HASH_KEY           = 'cmd_cloud_last_hash';
const PUSH_DEBOUNCE_MS = 2000;
const PULL_INTERVAL_MS = 30000;

const TRACKED_KEYS = [
  'dashboard_tasks',
  'dashboard_team',
  'dashboard_audit_log',
  'dashboard_personal_sync_status',
  'dashboard_analytics',
  'dashboard_seed_version',
  'selected_calendars',
];

function readSnapshot() {
  const data = {};
  for (const k of TRACKED_KEYS) {
    const v = localStorage.getItem(k);
    if (v != null) data[k] = v;
  }
  return data;
}

function writeSnapshot(data) {
  if (!data || typeof data !== 'object') return 0;
  let written = 0;
  for (const [k, v] of Object.entries(data)) {
    if (!TRACKED_KEYS.includes(k)) continue;
    if (typeof v !== 'string') continue;
    localStorage.setItem(k, v);
    written++;
  }
  return written;
}

// Cheap hash for skip-if-unchanged push.
function hashOf(obj) {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${s.length}.${h}`;
}

function getKnownVersion() {
  return Number(localStorage.getItem(VERSION_LOCALSTORAGE_KEY) || 0);
}
function setKnownVersion(v) {
  localStorage.setItem(VERSION_LOCALSTORAGE_KEY, String(v));
}

function resolveDirection(explicit) {
  if (explicit) return explicit;
  const envVal = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CLOUD_SYNC_DIRECTION) || '';
  if (envVal === 'push-only' || envVal === 'pull-only' || envVal === 'bidirectional') return envVal;
  // Hostname-based default
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return 'push-only';
  }
  return 'pull-only';
}

export function createCloudSync({ onRemoteApplied, onStatusChange, log = false, direction } = {}) {
  const dir = resolveDirection(direction);
  const canPush = dir === 'push-only' || dir === 'bidirectional';
  const canPull = dir === 'pull-only' || dir === 'bidirectional';

  let pushTimer  = null;
  let pullTimer  = null;
  let inflight   = false;
  let mounted    = true;
  const listeners = new Set();

  let status = { state: 'idle', version: getKnownVersion(), updatedAt: null, error: null };
  function setStatus(p) {
    status = { ...status, ...p };
    onStatusChange?.(status);
    listeners.forEach(fn => fn(status));
  }

  function logIf(...args) { if (log) console.log('[cloudSync]', ...args); }

  async function pull({ silent = false } = {}) {
    if (!mounted || inflight) return;
    if (!canPull) return; // push-only mode: never read remote
    if (!silent) setStatus({ state: 'pulling', error: null });
    try {
      const r = await fetch(ENDPOINT, { method: 'GET', cache: 'no-store' });
      if (r.status === 503) { setStatus({ state: 'unconfigured', error: 'Upstash KV not provisioned' }); return; }
      if (!r.ok) throw new Error(`GET ${ENDPOINT} ${r.status}`);
      const body = await r.json();
      const remoteVersion = Number(body.version || 0);
      const knownVersion  = getKnownVersion();
      if (body.empty || !body.state) {
        setStatus({ state: 'synced', version: remoteVersion, updatedAt: body.updatedAt, error: null });
        // Empty remote — only push local on bidirectional. In pull-only we don't write.
        if (canPush && Object.keys(readSnapshot()).length > 0) schedulePush('initial-seed');
        return;
      }
      if (remoteVersion > knownVersion) {
        const written = writeSnapshot(body.state);
        setKnownVersion(remoteVersion);
        localStorage.setItem(STATE_HASH_KEY, hashOf(body.state));
        logIf('pulled remote', { remoteVersion, written });
        setStatus({ state: 'synced', version: remoteVersion, updatedAt: body.updatedAt, error: null });
        onRemoteApplied?.({ version: remoteVersion, updatedAt: body.updatedAt, keysWritten: written });
      } else {
        setStatus({ state: 'synced', version: knownVersion, updatedAt: body.updatedAt, error: null });
      }
    } catch (err) {
      logIf('pull failed', err);
      setStatus({ state: 'error', error: err.message || 'pull_failed' });
    }
  }

  async function push() {
    if (!mounted) return;
    if (!canPush) return; // pull-only mode: never write to remote
    if (inflight) { schedulePush('inflight-collision', 1500); return; }
    const snap = readSnapshot();
    const h = hashOf(snap);
    if (h === localStorage.getItem(STATE_HASH_KEY)) {
      logIf('no diff, skip push');
      return;
    }
    inflight = true;
    setStatus({ state: 'pushing', error: null });
    try {
      const r = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ state: snap }),
      });
      if (r.status === 503) { setStatus({ state: 'unconfigured', error: 'Upstash KV not provisioned' }); return; }
      if (!r.ok) throw new Error(`PUT ${ENDPOINT} ${r.status}`);
      const body = await r.json();
      setKnownVersion(body.version);
      localStorage.setItem(STATE_HASH_KEY, h);
      logIf('pushed', { version: body.version });
      setStatus({ state: 'synced', version: body.version, updatedAt: body.updatedAt, error: null });
    } catch (err) {
      logIf('push failed', err);
      setStatus({ state: 'error', error: err.message || 'push_failed' });
      // Retry with backoff
      schedulePush('retry', 8000);
    } finally {
      inflight = false;
    }
  }

  function schedulePush(reason = 'change', delay = PUSH_DEBOUNCE_MS) {
    if (!canPush) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; push(); }, delay);
    logIf('push scheduled', reason, delay);
  }

  function notifyChange() { schedulePush('local-change'); }

  // Hook storage event for cross-tab + same-origin localStorage changes.
  const onStorage = (e) => {
    if (!e.key) return;
    if (!TRACKED_KEYS.includes(e.key)) return;
    schedulePush('storage-event');
  };
  if (canPush) window.addEventListener('storage', onStorage);

  // Pull on tab focus.
  const onFocus = () => pull({ silent: true });
  if (canPull) window.addEventListener('focus', onFocus);

  // Initial pull (only if pulling enabled). For push-only, do initial push if local state exists.
  if (canPull) {
    pull({ silent: false });
    pullTimer = setInterval(() => pull({ silent: true }), PULL_INTERVAL_MS);
  } else if (canPush) {
    logIf(`mode=${dir} — push-only, initial push of local state`);
    if (Object.keys(readSnapshot()).length > 0) schedulePush('initial-push');
  }

  logIf(`cloudSync direction=${dir} (push=${canPush}, pull=${canPull})`);

  return {
    notifyChange,
    pushNow: () => { if (pushTimer) clearTimeout(pushTimer); pushTimer = null; return push(); },
    pullNow: () => pull({ silent: false }),
    getStatus: () => status,
    subscribe: (fn) => { listeners.add(fn); fn(status); return () => listeners.delete(fn); },
    direction: dir,
    stop: () => {
      mounted = false;
      if (pushTimer) clearTimeout(pushTimer);
      if (pullTimer) clearInterval(pullTimer);
      if (canPush) window.removeEventListener('storage', onStorage);
      if (canPull) window.removeEventListener('focus', onFocus);
    },
  };
}
