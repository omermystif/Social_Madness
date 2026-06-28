// Per-user Google Drive task sync.
//
// Each authenticated user gets exactly one file: taskmanager_{userId}.json
// File discovery on bootstrap:
//   1. Check localStorage meta for cached fileId → verify still exists
//   2. Search Drive for existing file by name
//   3. If found: load content, apply to localStorage
//   4. If not found: create new file from current localStorage snapshot
//
// Subsequent saves: PATCH existing file (never creates duplicates).
// Metadata stored in localStorage under taskmanager_drive_meta_{userId}.

const DRIVE_API    = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const META_PREFIX  = 'taskmanager_drive_meta_'
const DRIVE_SCOPE  = 'https://www.googleapis.com/auth/drive.file'
const PUSH_DEBOUNCE_MS = 3000

export function fileNameFor(userId) {
  return `taskmanager_${userId}.json`
}

// ── Metadata (localStorage) ──────────────────────────────────────────────────

export function getDriveMeta(userId) {
  try { return JSON.parse(localStorage.getItem(META_PREFIX + userId) || 'null') }
  catch { return null }
}
function setDriveMeta(userId, meta) {
  localStorage.setItem(META_PREFIX + userId, JSON.stringify({
    userId,
    fileId:       meta.fileId || meta.id,
    fileName:     meta.fileName || meta.name,
    lastModified: meta.lastModified || meta.modifiedTime || null,
  }))
}
export function clearDriveMeta(userId) {
  localStorage.removeItem(META_PREFIX + userId)
}

// ── Drive API helpers ────────────────────────────────────────────────────────

async function driveGet(path, token) {
  const r = await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`Drive ${r.status}: ${txt.slice(0, 200)}`)
  }
  return r.json()
}

// Search for file by exact name (drive.file scope only sees files this app created).
async function findUserFile(userId, token) {
  const name = fileNameFor(userId)
  const q    = `name = '${name}' and trashed = false`
  const j    = await driveGet(
    `/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc`,
    token,
  )
  return j.files?.[0] || null
}

async function createUserFile(userId, snapshot, token) {
  const metadata = { name: fileNameFor(userId), mimeType: 'application/json' }
  const form     = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file',     new Blob([JSON.stringify(snapshot)], { type: 'application/json' }))
  const r = await fetch(
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
  )
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`Drive create ${r.status}: ${txt.slice(0, 200)}`)
  }
  return r.json()
}

async function updateUserFile(fileId, snapshot, token) {
  const r = await fetch(
    `${DRIVE_UPLOAD}/files/${fileId}?uploadType=media&fields=id,name,modifiedTime`,
    {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(snapshot),
    },
  )
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`Drive update ${r.status}: ${txt.slice(0, 200)}`)
  }
  return r.json()
}

async function loadUserFile(fileId, token) {
  const r = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`Drive load ${r.status}: ${txt.slice(0, 200)}`)
  }
  return r.json()
}

// ── Snapshot helpers (mirrors cloudSync.js) ──────────────────────────────────

const TRACKED_KEYS = [
  'dashboard_tasks',
  'dashboard_team',
  'dashboard_audit_log',
  'dashboard_personal_sync_status',
  'dashboard_analytics',
  'dashboard_seed_version',
  'selected_calendars',
]

function readSnapshot() {
  const data = {}
  for (const k of TRACKED_KEYS) {
    const v = localStorage.getItem(k)
    if (v != null) data[k] = v
  }
  return data
}

function writeSnapshot(data) {
  if (!data || typeof data !== 'object') return 0
  let written = 0
  for (const [k, v] of Object.entries(data)) {
    if (!TRACKED_KEYS.includes(k)) continue
    if (typeof v !== 'string') continue
    localStorage.setItem(k, v)
    written++
  }
  return written
}

// ── Sync engine ──────────────────────────────────────────────────────────────

export function createDriveTaskSync({
  getToken,
  getUserId,
  onStatusChange,
  onRemoteApplied,
  log = false,
} = {}) {
  let pushTimer = null
  let mounted   = true
  let inflight  = false
  const listeners = new Set()

  let status = { state: 'idle', fileId: null, fileName: null, updatedAt: null, error: null }

  function setStatus(patch) {
    status = { ...status, ...patch }
    onStatusChange?.(status)
    listeners.forEach(fn => fn(status))
  }

  function logIf(...args) { if (log) console.log('[driveTaskSync]', ...args) }

  async function bootstrap() {
    let token, userId
    try {
      token  = await getToken()
      userId = getUserId()
      if (!userId) { setStatus({ state: 'no-user' }); return }
    } catch (e) {
      setStatus({ state: 'error', error: `Auth: ${e.message}` })
      return
    }

    // Check if drive.file scope was actually granted
    const { grantedScope } = await import('../auth/gis.js')
    if (!grantedScope(DRIVE_SCOPE)) {
      setStatus({ state: 'scope-needed', error: 'Drive permission not granted. Re-sign in to enable Drive sync.' })
      return
    }

    setStatus({ state: 'bootstrapping', error: null })

    try {
      let meta = getDriveMeta(userId)

      // 1. Verify cached fileId still exists on Drive
      if (meta?.fileId) {
        try {
          await driveGet(`/files/${meta.fileId}?fields=id,name,modifiedTime`, token)
          logIf('reused cached fileId', meta.fileId)
          setStatus({ state: 'synced', fileId: meta.fileId, fileName: meta.fileName, updatedAt: meta.lastModified, error: null })
          return
        } catch {
          logIf('cached fileId gone, searching Drive')
          meta = null
        }
      }

      // 2. Search Drive for existing file
      const found = await findUserFile(userId, token)
      if (found) {
        logIf('found existing file', found.id)
        const data    = await loadUserFile(found.id, token)
        const written = writeSnapshot(data)
        setDriveMeta(userId, { fileId: found.id, fileName: found.name, lastModified: found.modifiedTime })
        setStatus({ state: 'synced', fileId: found.id, fileName: found.name, updatedAt: found.modifiedTime, error: null })
        if (written > 0) onRemoteApplied?.({ fileId: found.id, keysWritten: written })
        return
      }

      // 3. No file found — create from current localStorage state
      logIf('creating new file for', userId)
      const created = await createUserFile(userId, readSnapshot(), token)
      setDriveMeta(userId, { fileId: created.id, fileName: created.name, lastModified: created.modifiedTime })
      setStatus({ state: 'synced', fileId: created.id, fileName: created.name, updatedAt: created.modifiedTime, error: null })
      logIf('created', created.id)

    } catch (e) {
      logIf('bootstrap error', e)
      setStatus({ state: 'error', error: e.message })
    }
  }

  async function push() {
    if (!mounted) return
    if (inflight) { schedulePush('inflight-retry', 2000); return }

    let token, userId
    try {
      token  = await getToken()
      userId = getUserId()
      if (!userId) return
    } catch { return }

    let meta = getDriveMeta(userId)
    if (!meta?.fileId) {
      // fileId missing — bootstrap will create/discover it, then push again
      await bootstrap()
      meta = getDriveMeta(userId)
      if (!meta?.fileId) return
    }

    inflight = true
    setStatus({ state: 'saving', error: null })
    try {
      const updated = await updateUserFile(meta.fileId, readSnapshot(), token)
      setDriveMeta(userId, { fileId: meta.fileId, fileName: meta.fileName, lastModified: updated.modifiedTime })
      setStatus({ state: 'synced', fileId: meta.fileId, fileName: meta.fileName, updatedAt: updated.modifiedTime, error: null })
      logIf('pushed', meta.fileId)
    } catch (e) {
      logIf('push failed', e)
      setStatus({ state: 'error', error: e.message })
      schedulePush('retry', 10000)
    } finally {
      inflight = false
    }
  }

  function schedulePush(reason = 'change', delay = PUSH_DEBOUNCE_MS) {
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => { pushTimer = null; push() }, delay)
    logIf('push scheduled', reason, delay)
  }

  // Listen for cross-tab localStorage changes
  const onStorage = (e) => {
    if (!e.key || !TRACKED_KEYS.includes(e.key)) return
    schedulePush('storage-event')
  }
  window.addEventListener('storage', onStorage)

  // Kick off file discovery
  bootstrap()

  return {
    notifyChange: () => schedulePush('local-change'),
    getStatus:    () => status,
    subscribe:    (fn) => { listeners.add(fn); fn(status); return () => listeners.delete(fn) },
    stop:         () => {
      mounted = false
      if (pushTimer) clearTimeout(pushTimer)
      window.removeEventListener('storage', onStorage)
    },
  }
}
