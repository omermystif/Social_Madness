import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { buildSeedTasks, TEAM as SEED_TEAM } from '../seed/socialCalendarTasks.js';
import { createEvent, updateEvent, deleteEvent } from '../api/calendarApi.js';
import { useToast } from './ToastContext.jsx';
import { createCloudSync } from '../lib/cloudSync.js';
import { createDriveTaskSync } from '../lib/driveTaskSync.js';
import { getValidAccessToken } from '../auth/gis.js';
import { useAuth } from './AuthContext.jsx';
import useServerTasks from '../hooks/useServerTasks.js';

const TaskContext = createContext(null);
const USE_SERVER_STORAGE = import.meta.env.VITE_STORAGE_MODE === 'server';
const TASKS_KEY    = 'dashboard_tasks';
const TEAM_KEY     = 'dashboard_team';
const AUDIT_KEY    = 'dashboard_audit_log';
const SYNC_STATUS_KEY = 'dashboard_personal_sync_status';
const ANALYTICS_KEY = 'dashboard_analytics';
const VERSION_KEY  = 'dashboard_seed_version';
const SEED_VERSION = 6; // bump to force re-seed after campaign source refresh

const BROADCAST_NAME = 'dashboard-sync';

// Keys eligible for backup/restore. Excludes auth tokens (memory-only by design)
// and the client-ID override (per-browser dev setting, not data).
const SNAPSHOT_KEYS = [
  TASKS_KEY,
  TEAM_KEY,
  AUDIT_KEY,
  SYNC_STATUS_KEY,
  ANALYTICS_KEY,
  VERSION_KEY,
  'selected_calendars',
];

const SNAPSHOT_VERSION = 1;
const ME_USER_ID = 'you@boxmadness.com'; // single-user app; stable ID for completedBy attribution
const PROJECT_ID = 'box-madness-social-2026';
const BOARD_ID   = 'jun-2026-30day';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(s) { return EMAIL_RE.test(String(s || '').trim()); }

// Default fields added to every team member record (migrated on read).
const MEMBER_DEFAULTS = {
  googleEmail:       null,
  googleSub:         null,
  googleStatus:      'not_connected', // 'not_connected' | 'connected' | 'error' | 'expired'
  googleConnectedAt: null,
  googleError:       null,
};

const AUDIT_MAX = 500;

const initialTasks = () => {
  const storedVersion = Number(localStorage.getItem(VERSION_KEY) || 0);
  if (storedVersion >= SEED_VERSION) {
    try {
      const raw = localStorage.getItem(TASKS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
  }
  const seed = buildSeedTasks();
  localStorage.setItem(TASKS_KEY, JSON.stringify(seed));
  localStorage.setItem(VERSION_KEY, String(SEED_VERSION));
  return seed;
};

const initialTeam = () => {
  let stored = null;
  try {
    const raw = localStorage.getItem(TEAM_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {}
  const base = stored || SEED_TEAM;
  // Migrate: ensure every member has googleEmail/Sub/Status/etc. fields.
  return base.map((m) => ({ ...MEMBER_DEFAULTS, ...m }));
};

const initialAuditLog = () => {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
};

const initialSyncStatus = () => {
  try {
    const raw = localStorage.getItem(SYNC_STATUS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {}; // { [memberEmail]: { lastSyncedAt, count, errors, lastOp } }
};

const initialAnalytics = () => {
  try {
    const raw = localStorage.getItem(ANALYTICS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
};

// Match the active Google profile to a team member.
// Priority: googleSub match (stable, unique) > googleEmail match > member.email == profile.email (loose).
export function resolveCurrentMember(team, profile) {
  if (!profile) return null;
  return (
    team.find(m => m.googleSub && m.googleSub === profile.sub) ||
    team.find(m => m.googleEmail && profile.email && m.googleEmail.toLowerCase() === profile.email.toLowerCase()) ||
    team.find(m => profile.email && m.email.toLowerCase() === profile.email.toLowerCase()) ||
    null
  );
}

function tasksReducer(state, action) {
  switch (action.type) {
    case 'ADD':       return [action.task, ...state];
    case 'UPDATE':    return state.map(t => t.id === action.id ? { ...t, ...action.patch } : t);
    case 'TOGGLE':    return state.map(t => t.id === action.id ? { ...t, done: !t.done } : t);
    case 'REMOVE':    return state.filter(t => t.id !== action.id);
    case 'REASSIGN':  return state.map(t => t.id === action.id ? { ...t, assignee: action.assignee } : t);
    case 'REASSIGN_ALL': return state.map(t => t.assignee === action.from ? { ...t, assignee: action.to } : t);
    case 'RESET':     return buildSeedTasks();
    case 'SET':       return Array.isArray(action.tasks) ? action.tasks : state;
    default:          return state;
  }
}

function addDaysIso(iso, n) {
  const d = new Date(iso); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildEventBodyFromTask(task, member) {
  const start = task.start || task.due;
  const end   = task.due;
  // Google all-day event: 'end.date' is exclusive — add 1 day so a single-day task spans 1 day visually.
  const endExclusive = addDaysIso(end, 1);
  return {
    summary: task.name,
    description: [
      'Box Madness Command Dashboard',
      `Priority: ${task.priority}`,
      `Assignee: ${member?.name || task.assignee}`,
      `Task ID: ${task.id}`,
    ].join('\n'),
    start: { date: start },
    end:   { date: endExclusive },
    reminders: { useDefault: true },
    // colorId omitted — Google picks based on calendar.
    extendedProperties: {
      private: {
        boxMadnessTaskId: task.id,
        boxMadnessPriority: task.priority,
      },
    },
  };
}

function snapshotOf(task) {
  return {
    name:     task.name,
    start:    task.start || task.due,
    due:      task.due,
    priority: task.priority,
  };
}

function setPersonalSync(tasksArr, taskId, email, entry) {
  const t = tasksArr.find(x => x.id === taskId);
  const prev = t?.personalSync || {};
  return { ...prev, [email]: entry };
}

function clearPersonalSync(tasksArr, taskId, email) {
  const t = tasksArr.find(x => x.id === taskId);
  const prev = t?.personalSync || {};
  const next = { ...prev };
  delete next[email];
  return Object.keys(next).length === 0 ? null : next;
}

function countCurrentSynced(tasksArr, email) {
  return tasksArr.filter(t => t.personalSync?.[email]?.eventId).length;
}

// Simple concurrency-limited map. Avoids hammering Google with 35 parallel POSTs.
async function pMapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = { ok: true, value: await fn(items[idx], idx) }; }
      catch (err) { results[idx] = { ok: false, error: err, item: items[idx] }; }
    }
  });
  await Promise.all(workers);
  return results;
}

function LegacyTaskProvider({ children }) {
  const { profile } = useAuth();
  const [tasks, dispatch] = useReducer(tasksReducer, undefined, initialTasks);
  const [team, setTeam]   = useState(initialTeam);
  const [auditLog, setAuditLog]       = useState(initialAuditLog);
  const [syncStatus, setSyncStatus]   = useState(initialSyncStatus);
  const [analytics, setAnalytics]     = useState(initialAnalytics);
  // taskSyncStatus is transient (in-memory only). Schema:
  //   { [taskId]: { state: 'idle'|'pending'|'syncing'|'synced'|'failed', error?: string, ts?: number } }
  const [taskSyncStatus, setTaskSyncStatus] = useState({});
  const { push: toast }               = useToast();

  // ─── Realtime + automation infrastructure ──────────────────────────────
  // BroadcastChannel mirrors task completions across browser tabs of this origin.
  // Closest pure-SPA analogue to WebSocket/Supabase/Firebase — no backend required.
  const channelRef    = useRef(null);
  const automationsRef = useRef(new Set()); // Set<(task) => any>
  const tasksRef       = useRef(tasks);     // mirrors latest tasks for sync handlers

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(BROADCAST_NAME);
    channelRef.current = ch;
    ch.onmessage = (msg) => {
      const { type, taskId, patch } = msg.data || {};
      if (type === 'task_completed' || type === 'task_uncompleted') {
        // Apply remote completion locally if not already in that state.
        const current = tasksRef.current.find(t => t.id === taskId);
        if (!current) return;
        const wantDone = type === 'task_completed';
        if (current.done === wantDone) return; // already in sync
        dispatch({ type: 'UPDATE', id: taskId, patch });
      }
    };
    return () => { ch.close(); channelRef.current = null; };
  }, []);

  function notifySync() { cloudRef.current?.notifyChange(); driveRef.current?.notifyChange(); }
  useEffect(() => { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)); notifySync(); }, [tasks]);
  useEffect(() => { localStorage.setItem(TEAM_KEY,  JSON.stringify(team)); notifySync(); },  [team]);
  useEffect(() => { localStorage.setItem(AUDIT_KEY, JSON.stringify(auditLog)); notifySync(); }, [auditLog]);
  useEffect(() => { localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(syncStatus)); notifySync(); }, [syncStatus]);
  useEffect(() => { localStorage.setItem(ANALYTICS_KEY, JSON.stringify(analytics.slice(-1000))); notifySync(); }, [analytics]);

  // ─── Cloud sync (Upstash KV via /api/state) ──────────────────────────────
  const cloudRef = useRef(null);
  const [cloudStatus, setCloudStatus] = useState({ state: 'idle', version: 0, updatedAt: null, error: null });

  // ─── Drive sync (per-user taskmanager_{userId}.json) ─────────────────────
  const driveRef = useRef(null);
  const [driveStatus, setDriveStatus] = useState({ state: 'idle', fileId: null, fileName: null, updatedAt: null, error: null });

  useEffect(() => {
    // Disable cloud sync when no backend configured.
    // Prevents "Error Saving" chip on Vercel SPA where /api/state 404s.
    const cloudEnabled = !!(import.meta.env.VITE_API_URL || import.meta.env.VITE_ENABLE_CLOUD_SYNC);
    if (!cloudEnabled) {
      setCloudStatus({ state: 'disabled', version: 0, updatedAt: null, error: null });
      return;
    }
    const sync = createCloudSync({
      onStatusChange: setCloudStatus,
      onRemoteApplied: ({ keysWritten }) => {
        if (keysWritten > 0) {
          setTimeout(() => window.location.reload(), 100);
        }
      },
      log: false,
    });
    cloudRef.current = sync;
    return () => { sync.stop(); cloudRef.current = null; };
  }, []);

  useEffect(() => {
    if (!profile?.sub) {
      driveRef.current?.stop();
      driveRef.current = null;
      setDriveStatus({ state: 'idle', fileId: null, fileName: null, updatedAt: null, error: null });
      return;
    }
    const userId = profile.sub;
    const sync = createDriveTaskSync({
      getToken:        () => getValidAccessToken(),
      getUserId:       () => userId,
      onStatusChange:  setDriveStatus,
      onRemoteApplied: ({ keysWritten }) => {
        if (keysWritten > 0) setTimeout(() => window.location.reload(), 100);
      },
    });
    driveRef.current = sync;
    return () => { sync.stop(); driveRef.current = null; };
  }, [profile?.sub]);

  function logAnalytics(event, metadata = {}) {
    setAnalytics(prev => [...prev, { event, ts: Date.now(), ...metadata }]);
  }

  function fireAutomations(task) {
    // Non-blocking: schedule each handler in a microtask. Errors don't propagate.
    automationsRef.current.forEach(fn => {
      Promise.resolve().then(() => fn(task)).catch(err => console.error('automation hook failed', err));
    });
  }

  const onTaskCompleted = (fn) => {
    automationsRef.current.add(fn);
    return () => automationsRef.current.delete(fn);
  };

  const audit = (action, details = {}) => {
    setAuditLog((prev) => {
      const entry = { ts: Date.now(), action, ...details };
      const next = [...prev, entry];
      return next.length > AUDIT_MAX ? next.slice(-AUDIT_MAX) : next;
    });
  };

  // ─── Export / import full workspace snapshot ───────────────────────────
  // Bundles every dashboard_* localStorage key into a JSON envelope.
  // Useful for moving state between origins (e.g. localhost ↔ production Vercel URL)
  // since localStorage is per-origin.
  const exportSnapshot = () => {
    const data = {};
    for (const k of SNAPSHOT_KEYS) {
      const v = localStorage.getItem(k);
      if (v != null) data[k] = v;
    }
    return {
      kind:        'command-dashboard-snapshot',
      version:     SNAPSHOT_VERSION,
      exportedAt:  new Date().toISOString(),
      origin:      typeof window !== 'undefined' ? window.location.origin : 'unknown',
      keyCount:    Object.keys(data).length,
      data,
    };
  };

  const downloadSnapshot = () => {
    const snap = exportSnapshot();
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const stamp = snap.exportedAt.replace(/[:.]/g, '-');
    a.href     = url;
    a.download = `command-dashboard-snapshot-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return snap;
  };

  // importSnapshot: replaces existing localStorage keys with snapshot values.
  // Returns { ok, error?, restored?: number }. Reloads window on success to rehydrate React state.
  // mode: 'replace' (default — overwrite) | 'merge' (only fills missing keys)
  const importSnapshot = (snapshot, { mode = 'replace', reload = true } = {}) => {
    if (!snapshot || typeof snapshot !== 'object') return { ok: false, error: 'Invalid snapshot (not an object).' };
    if (snapshot.kind !== 'command-dashboard-snapshot') return { ok: false, error: 'Wrong file kind. Expected a command-dashboard snapshot.' };
    if (typeof snapshot.version !== 'number' || snapshot.version > SNAPSHOT_VERSION) return { ok: false, error: `Snapshot version ${snapshot.version} not supported (max ${SNAPSHOT_VERSION}).` };
    if (!snapshot.data || typeof snapshot.data !== 'object') return { ok: false, error: 'Snapshot missing data block.' };

    let restored = 0;
    try {
      for (const [k, v] of Object.entries(snapshot.data)) {
        if (!SNAPSHOT_KEYS.includes(k)) continue; // ignore unknown keys
        if (typeof v !== 'string') continue;
        if (mode === 'merge' && localStorage.getItem(k) != null) continue;
        // Validate JSON-shape keys to avoid corruption.
        if (k === TASKS_KEY || k === TEAM_KEY || k === AUDIT_KEY || k === SYNC_STATUS_KEY || k === ANALYTICS_KEY || k === 'selected_calendars') {
          try { JSON.parse(v); } catch { return { ok: false, error: `Snapshot key "${k}" is not valid JSON.` }; }
        }
        localStorage.setItem(k, v);
        restored++;
      }
    } catch (err) {
      return { ok: false, error: err?.message || 'Write failed.' };
    }

    audit('snapshot_imported', {
      restored,
      version:    snapshot.version,
      fromOrigin: snapshot.origin || 'unknown',
      exportedAt: snapshot.exportedAt || null,
      mode,
    });

    if (reload) {
      setTimeout(() => window.location.reload(), 200);
    }
    return { ok: true, restored };
  };

  function setSyncFor(taskId, patch) {
    setTaskSyncStatus(prev => ({ ...prev, [taskId]: { ...(prev[taskId] || {}), ...patch, ts: Date.now() } }));
  }

  // ─── Single-task background sync to Google (used by rescheduleTask) ──────
  async function pushSingleTaskToGoogle(memberEmail, task) {
    if (!memberEmail) throw new Error('No active member');
    const member = team.find(m => m.email === task.assignee);
    const body = buildEventBodyFromTask(task, member);
    const existing = task.personalSync?.[memberEmail];

    if (existing?.eventId && task.assignee === memberEmail) {
      // Update existing event for the same owner.
      try {
        await updateEvent('primary', existing.eventId, body);
        return { op: 'updated', eventId: existing.eventId };
      } catch (err) {
        if (err.status === 404) {
          // Event vanished upstream — recreate.
          const ev = await createEvent('primary', body);
          return { op: 'recreated', eventId: ev.id };
        }
        throw err;
      }
    }

    if (existing?.eventId && task.assignee !== memberEmail) {
      // Ownership changed away from this user — delete from their calendar.
      try { await deleteEvent('primary', existing.eventId); }
      catch (err) { if (err.status !== 404) throw err; }
      return { op: 'deleted' };
    }

    if (task.assignee === memberEmail && task.due && !task.done) {
      // New event for newly-owned task.
      const ev = await createEvent('primary', body);
      return { op: 'created', eventId: ev.id };
    }

    return { op: 'noop' };
  }

  // ─── rescheduleTask — single source of truth for date / name / priority edits ─
  // Validates, optimistically applies, audits, and pushes to Google in background.
  // Returns { ok, error?, audited?: boolean }.
  const rescheduleTask = async (taskId, patchInput, opts = {}) => {
    const task = tasksRef.current.find(t => t.id === taskId);
    if (!task) return { ok: false, error: 'Task not found' };

    const patch = { ...patchInput };
    if (patch.name) patch.name = String(patch.name).trim();
    if (patch.start && patch.due && patch.start > patch.due) {
      return { ok: false, error: 'End date must be on or after start date.' };
    }
    if (patch.start && !patch.due && patch.start > task.due) {
      return { ok: false, error: 'Start date cannot be after current end date.' };
    }
    if (patch.due && !patch.start && patch.due < (task.start || task.due)) {
      return { ok: false, error: 'End date cannot be before current start date.' };
    }

    const beforeSnapshot = {
      name:     task.name,
      start:    task.start || task.due,
      due:      task.due,
      priority: task.priority,
      category: task.category || null,
    };
    const next = { ...task, ...patch };
    const afterSnapshot = {
      name:     next.name,
      start:    next.start || next.due,
      due:      next.due,
      priority: next.priority,
      category: next.category || null,
    };

    const changed =
      beforeSnapshot.name     !== afterSnapshot.name ||
      beforeSnapshot.start    !== afterSnapshot.start ||
      beforeSnapshot.due      !== afterSnapshot.due ||
      beforeSnapshot.priority !== afterSnapshot.priority ||
      beforeSnapshot.category !== afterSnapshot.category;
    if (!changed) return { ok: true, noop: true };

    // ─── Optimistic update ────────────────────────────────────────────────
    dispatch({ type: 'UPDATE', id: taskId, patch });

    // Persistence probe — same pattern used by completeTask.
    try { localStorage.setItem('__reschedule_probe', String(Date.now())); }
    catch (err) {
      dispatch({ type: 'UPDATE', id: taskId, patch: beforeSnapshot });
      toast({ type: 'error', title: 'Couldn\'t save task', body: 'Storage failed. Reverted.' });
      return { ok: false, error: err.message };
    }

    // Audit (date changes are the most useful entry)
    audit('task_rescheduled', {
      taskId,
      userId: ME_USER_ID,
      before: beforeSnapshot,
      after:  afterSnapshot,
    });

    // ─── Background calendar sync (fire-and-forget, but tracked) ─────────
    const memberEmail = opts.memberEmail;
    if (memberEmail) {
      const hadMarker = !!task.personalSync?.[memberEmail]?.eventId;
      if (hadMarker || next.assignee === memberEmail) {
        setSyncFor(taskId, { state: 'syncing', error: null });
        // Microtask so optimistic UI update paints first.
        Promise.resolve().then(async () => {
          try {
            const res = await pushSingleTaskToGoogle(memberEmail, next);
            // Update personalSync mapping based on op
            if (res.op === 'created' || res.op === 'recreated') {
              dispatch({
                type:  'UPDATE',
                id:    taskId,
                patch: {
                  personalSync: setPersonalSync(
                    tasksRef.current,
                    taskId,
                    memberEmail,
                    { eventId: res.eventId, syncedAt: Date.now(), snapshot: snapshotOf(next) },
                  ),
                },
              });
            } else if (res.op === 'updated') {
              dispatch({
                type:  'UPDATE',
                id:    taskId,
                patch: {
                  personalSync: setPersonalSync(
                    tasksRef.current,
                    taskId,
                    memberEmail,
                    { ...(task.personalSync?.[memberEmail] || {}), syncedAt: Date.now(), snapshot: snapshotOf(next) },
                  ),
                },
              });
            } else if (res.op === 'deleted') {
              dispatch({
                type:  'UPDATE',
                id:    taskId,
                patch: { personalSync: clearPersonalSync(tasksRef.current, taskId, memberEmail) },
              });
            }
            setSyncFor(taskId, { state: 'synced', error: null });
            channelRef.current?.postMessage({ type: 'task_rescheduled', taskId, patch });
          } catch (err) {
            console.error('Reschedule sync failed', err);
            setSyncFor(taskId, { state: 'failed', error: err?.message || 'Sync failed' });
            toast({
              type:  'warn',
              title: 'Calendar sync failed',
              body:  'Task saved locally. Will retry on next sync.',
            });
          }
        });
      } else {
        // No marker and not owner — nothing to sync.
        setSyncFor(taskId, { state: 'idle' });
      }
    }

    return { ok: true };
  };

  // Retry a previously-failed sync for one task.
  const retryTaskSync = async (taskId, memberEmail) => {
    const task = tasksRef.current.find(t => t.id === taskId);
    if (!task || !memberEmail) return { ok: false };
    setSyncFor(taskId, { state: 'syncing', error: null });
    try {
      const res = await pushSingleTaskToGoogle(memberEmail, task);
      if (res.op === 'created' || res.op === 'recreated') {
        dispatch({
          type:  'UPDATE',
          id:    taskId,
          patch: {
            personalSync: setPersonalSync(
              tasksRef.current,
              taskId,
              memberEmail,
              { eventId: res.eventId, syncedAt: Date.now(), snapshot: snapshotOf(task) },
            ),
          },
        });
      }
      setSyncFor(taskId, { state: 'synced', error: null });
      return { ok: true };
    } catch (err) {
      setSyncFor(taskId, { state: 'failed', error: err?.message || 'Sync failed' });
      return { ok: false, error: err?.message };
    }
  };

  // ─── Complete / uncomplete a task ────────────────────────────────────────
  // Idempotent: completing an already-completed task is a no-op (no analytics, no audit, no hook).
  // Optimistic: dispatches reducer synchronously, then probes localStorage write.
  // Rollback: if probe throws, reverts the dispatch and shows a toast.
  // Realtime: broadcasts to other tabs via BroadcastChannel.
  const completeTask = (taskId) => {
    const task = tasksRef.current.find(t => t.id === taskId);
    if (!task) return { ok: false, error: 'Task not found' };
    if (task.done) return { ok: true, alreadyDone: true, task };

    const completedAt = new Date().toISOString();
    const patch = { done: true, completedAt, completedBy: ME_USER_ID };

    // Optimistic update
    dispatch({ type: 'UPDATE', id: taskId, patch });

    // Persistence probe (simulate failure path — quota / private mode etc.)
    try {
      localStorage.setItem('__complete_probe', String(Date.now()));
    } catch (err) {
      // Rollback
      dispatch({ type: 'UPDATE', id: taskId, patch: { done: false, completedAt: null, completedBy: null } });
      toast({
        type: 'error',
        title: 'Couldn\'t complete task',
        body: 'Please try again.',
      });
      return { ok: false, error: err.message || 'Persistence failed' };
    }

    // Analytics — fire ONCE per completion (idempotent gate above).
    logAnalytics('task_completed', {
      taskId:       task.id,
      projectId:    PROJECT_ID,
      boardId:      BOARD_ID,
      completedBy:  ME_USER_ID,
      completedAt,
      storyPoints:  task.storyPoints ?? estimateStoryPoints(task),
    });

    // Audit
    audit('task_completed', { taskId: task.id, userId: ME_USER_ID, name: task.name });

    // Realtime broadcast (cross-tab)
    channelRef.current?.postMessage({ type: 'task_completed', taskId, patch });

    // Async automation hooks (non-blocking)
    const completedTask = { ...task, ...patch };
    fireAutomations(completedTask);

    // Toast (non-blocking, success)
    toast({ type: 'success', title: 'Task completed', body: truncate(task.name, 48) });

    return { ok: true, task: completedTask };
  };

  // Inverse — uncomplete (does NOT fire analytics / automations; only audits the revert).
  const uncompleteTask = (taskId) => {
    const task = tasksRef.current.find(t => t.id === taskId);
    if (!task || !task.done) return { ok: true, alreadyOpen: true };
    dispatch({ type: 'UPDATE', id: taskId, patch: { done: false, completedAt: null, completedBy: null } });
    audit('task_uncompleted', { taskId, userId: ME_USER_ID, name: task.name });
    channelRef.current?.postMessage({
      type:  'task_uncompleted',
      taskId,
      patch: { done: false, completedAt: null, completedBy: null },
    });
    return { ok: true };
  };

  // Convenience: legacy toggleTask now routes through completeTask/uncompleteTask so callers don't have to branch.
  const toggleTask = (taskId) => {
    const task = tasksRef.current.find(t => t.id === taskId);
    if (!task) return;
    if (task.done) uncompleteTask(taskId);
    else           completeTask(taskId);
  };

  function estimateStoryPoints(task) {
    // Heuristic so analytics dashboards have a numeric workload signal even without explicit field.
    const span = task.start && task.due
      ? Math.max(1, Math.round((new Date(task.due) - new Date(task.start)) / 86400000) + 1)
      : 1;
    const priorityMultiplier = task.priority === 'high' ? 3 : task.priority === 'med' ? 2 : 1;
    return span * priorityMultiplier;
  }

  function truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : s; }

  const addTask = (t) => dispatch({
    type: 'ADD',
    task: {
      id:         crypto.randomUUID(),
      done:       false,
      calEventId: null,
      createdAt:  Date.now(),
      createdBy:  'you@boxmadness.com',
      start:      t.start || t.due,
      ...t,
    },
  });

  // ─── Team CRUD ──────────────────────────────────────────────────────────────
  const addMember = (m) => {
    const email = (m.email || '').trim();
    if (!isValidEmail(email)) return { ok: false, error: 'Invalid email format' };
    if (team.some(x => x.email === email)) return { ok: false, error: 'Email already in team' };
    setTeam(prev => [
      ...prev,
      { ...MEMBER_DEFAULTS, email, name: m.name || email, role: m.role || 'Team member' },
    ]);
    audit('member_added', { email, name: m.name, role: m.role });
    return { ok: true };
  };

  // Update non-email fields. To change email, use renameMember (cascades to tasks).
  const updateMember = (email, patch) => {
    const { email: _ignored, ...safePatch } = patch || {};
    setTeam(prev => prev.map(m => m.email === email ? { ...m, ...safePatch } : m));
  };

  // Change a member's email + cascade to tasks (assignee field).
  // Returns { ok, error }. Validates format and uniqueness before mutating.
  const renameMember = (oldEmail, newEmailRaw, extraPatch = {}) => {
    const newEmail = (newEmailRaw || '').trim();
    if (!isValidEmail(newEmail)) {
      return { ok: false, error: 'Invalid email format' };
    }
    if (oldEmail !== newEmail && team.some(m => m.email === newEmail)) {
      return { ok: false, error: 'Email already in team' };
    }
    if (oldEmail === newEmail) {
      // Apply non-email patch only.
      updateMember(oldEmail, extraPatch);
      return { ok: true, changed: false };
    }
    setTeam(prev => prev.map(m => m.email === oldEmail ? { ...m, ...extraPatch, email: newEmail } : m));
    dispatch({ type: 'REASSIGN_ALL', from: oldEmail, to: newEmail });
    audit('email_changed', { oldEmail, newEmail });
    return { ok: true, changed: true };
  };

  const removeMember = (email, reassignTo) => {
    setTeam(prev => prev.filter(m => m.email !== email));
    if (reassignTo) dispatch({ type: 'REASSIGN_ALL', from: email, to: reassignTo });
    audit('member_removed', { email, reassignedTo: reassignTo || null });
  };

  // ─── Per-member Google account binding ────────────────────────────────────
  // Records that a member is associated with a Google identity. Does NOT
  // store tokens — tokens stay in gis.js memory. Only googleSub + googleEmail
  // are persisted (both are non-secret identifiers).
  const connectMemberGoogle = (memberEmail, profile) => {
    if (!profile?.sub || !profile?.email) {
      updateMember(memberEmail, {
        googleStatus: 'error',
        googleError:  'No profile data — userinfo unavailable',
      });
      audit('google_connect_failed', { memberEmail, reason: 'no_profile' });
      return { ok: false, error: 'Could not read Google profile' };
    }
    updateMember(memberEmail, {
      googleEmail:       profile.email,
      googleSub:         profile.sub,
      googleStatus:      'connected',
      googleConnectedAt: Date.now(),
      googleError:       null,
    });
    audit('google_connected', { memberEmail, googleEmail: profile.email, googleSub: profile.sub });
    return { ok: true };
  };

  const disconnectMemberGoogle = (memberEmail) => {
    const m = team.find(x => x.email === memberEmail);
    const prev = m?.googleEmail || null;
    updateMember(memberEmail, {
      googleEmail:       null,
      googleSub:         null,
      googleStatus:      'not_connected',
      googleConnectedAt: null,
      googleError:       null,
    });
    audit('google_disconnected', { memberEmail, previousGoogleEmail: prev });
  };

  const markMemberGoogleError = (memberEmail, errorMessage) => {
    updateMember(memberEmail, { googleStatus: 'error', googleError: errorMessage });
    audit('google_error', { memberEmail, message: errorMessage });
  };

  // ─── Google Calendar sync (one-way, tasks → primary calendar) ──────────────
  // Skips done tasks and tasks already synced (have calEventId).
  // Returns { synced, skipped, failed, errors }.
  const bulkSyncToGoogle = async ({
    includeDone = false,
    onProgress  = () => {},
    concurrency = 5,
  } = {}) => {
    const targets = tasks.filter(t =>
      !t.calEventId && (includeDone || !t.done) && t.due
    );

    if (targets.length === 0) {
      return { synced: 0, skipped: tasks.length, failed: 0, errors: [] };
    }

    let done = 0;
    const results = await pMapLimit(targets, concurrency, async (task) => {
      const member = team.find(m => m.email === task.assignee);
      const body = buildEventBodyFromTask(task, member);
      const ev = await createEvent('primary', body);
      done++;
      onProgress({ done, total: targets.length, task });
      return { taskId: task.id, eventId: ev.id, htmlLink: ev.htmlLink };
    });

    const successes = results.filter(r => r.ok);
    const failures  = results.filter(r => !r.ok);

    // Patch tasks with calEventId via single batch dispatch.
    successes.forEach(r => {
      dispatch({ type: 'UPDATE', id: r.value.taskId, patch: { calEventId: r.value.eventId } });
    });

    return {
      synced:   successes.length,
      skipped:  tasks.length - targets.length,
      failed:   failures.length,
      errors:   failures.map(f => ({ taskId: f.item.id, message: f.error?.message || String(f.error) })),
    };
  };

  // Push edits to a single task's Google event (if it was previously synced).
  // Used by Gantt drag + inline edits. Silent no-op when task has no calEventId.
  const pushTaskUpdate = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task?.calEventId) return null;
    const member = team.find(m => m.email === task.assignee);
    const body = buildEventBodyFromTask(task, member);
    return updateEvent('primary', task.calEventId, body);
  };

  // Delete the Google event linked to this task (if any).
  const pushTaskDelete = async (calEventId) => {
    if (!calEventId) return null;
    return deleteEvent('primary', calEventId).catch(err => {
      // 404 = already deleted on Google side. Swallow.
      if (err.status !== 404) throw err;
    });
  };

  // ─── Personal sync (per-user, scoped to assignee) ──────────────────────────
  // Each user's events live under `task.personalSync[memberEmail] = { eventId, syncedAt }`.
  // Algorithm per call:
  //   1. Orphans — tasks with personalSync[me] but assignee !== me → delete events, clear marker.
  //   2. News    — tasks with assignee === me, due date, not done, no personalSync[me] → create events.
  //   3. Updates — tasks with personalSync[me] AND content changed (name/start/due) → patch events.
  // Returns { synced, deleted, updated, failed, errors }.
  const bulkSyncMyTasksToGoogle = async ({
    memberEmail,
    includeDone = false,
    onProgress  = () => {},
    concurrency = 5,
  } = {}) => {
    if (!memberEmail) {
      return { synced: 0, deleted: 0, updated: 0, failed: 0, errors: [{ message: 'No active member identified' }] };
    }

    // ─── Phase 1: collect targets ──────────────────────────────────────────
    const orphans = tasks.filter(t =>
      t.personalSync?.[memberEmail]?.eventId && t.assignee !== memberEmail
    );
    const news    = tasks.filter(t =>
      t.assignee === memberEmail
      && t.due
      && (includeDone || !t.done)
      && !t.personalSync?.[memberEmail]?.eventId
    );
    const updates = tasks.filter(t =>
      t.assignee === memberEmail
      && t.due
      && (includeDone || !t.done)
      && t.personalSync?.[memberEmail]?.eventId
      // Updated if name or date range changed since last sync.
      && (() => {
        const ps = t.personalSync[memberEmail];
        return !ps.snapshot
          || ps.snapshot.name !== t.name
          || ps.snapshot.start !== (t.start || t.due)
          || ps.snapshot.due   !== t.due
          || ps.snapshot.priority !== t.priority;
      })()
    );

    const totalOps = orphans.length + news.length + updates.length;
    if (totalOps === 0) {
      const stamp = Date.now();
      setSyncStatus(prev => ({
        ...prev,
        [memberEmail]: {
          lastSyncedAt: stamp,
          count:        countCurrentSynced(tasks, memberEmail),
          errors:       [],
          lastOp:       'noop',
        },
      }));
      return { synced: 0, deleted: 0, updated: 0, failed: 0, errors: [] };
    }

    let done = 0;
    const bump = () => { done++; onProgress({ done, total: totalOps }); };

    // ─── Phase 2: delete orphans ───────────────────────────────────────────
    const orphanResults = await pMapLimit(orphans, concurrency, async (task) => {
      const ps = task.personalSync[memberEmail];
      try { await deleteEvent('primary', ps.eventId); }
      catch (err) { if (err.status !== 404) throw err; }
      bump();
      return { taskId: task.id, op: 'delete' };
    });

    // ─── Phase 3: create new ───────────────────────────────────────────────
    const newResults = await pMapLimit(news, concurrency, async (task) => {
      const member = team.find(m => m.email === task.assignee);
      const body = buildEventBodyFromTask(task, member);
      const ev = await createEvent('primary', body);
      bump();
      return { taskId: task.id, op: 'create', eventId: ev.id, snapshot: snapshotOf(task) };
    });

    // ─── Phase 4: patch updates ────────────────────────────────────────────
    const updateResults = await pMapLimit(updates, concurrency, async (task) => {
      const ps = task.personalSync[memberEmail];
      const member = team.find(m => m.email === task.assignee);
      const body = buildEventBodyFromTask(task, member);
      try {
        await updateEvent('primary', ps.eventId, body);
      } catch (err) {
        if (err.status === 404) {
          // Event vanished — recreate.
          const ev = await createEvent('primary', body);
          bump();
          return { taskId: task.id, op: 'recreate', eventId: ev.id, snapshot: snapshotOf(task) };
        }
        throw err;
      }
      bump();
      return { taskId: task.id, op: 'update', eventId: ps.eventId, snapshot: snapshotOf(task) };
    });

    // ─── Phase 5: commit local state ───────────────────────────────────────
    const deletedOk = orphanResults.filter(r => r.ok);
    const createdOk = newResults.filter(r => r.ok);
    const updatedOk = updateResults.filter(r => r.ok);
    const allFailures = [...orphanResults, ...newResults, ...updateResults].filter(r => !r.ok);

    deletedOk.forEach(r => {
      dispatch({
        type:  'UPDATE',
        id:    r.value.taskId,
        patch: { personalSync: clearPersonalSync(tasks, r.value.taskId, memberEmail) },
      });
    });
    [...createdOk, ...updatedOk].forEach(r => {
      dispatch({
        type:  'UPDATE',
        id:    r.value.taskId,
        patch: {
          personalSync: setPersonalSync(
            tasks,
            r.value.taskId,
            memberEmail,
            { eventId: r.value.eventId, syncedAt: Date.now(), snapshot: r.value.snapshot }
          ),
        },
      });
    });

    const stamp = Date.now();
    setSyncStatus(prev => ({
      ...prev,
      [memberEmail]: {
        lastSyncedAt: stamp,
        count:        countCurrentSynced(tasks, memberEmail) + createdOk.length - deletedOk.length,
        errors:       allFailures.map(f => ({ taskId: f.item?.id, message: f.error?.message || String(f.error) })),
        lastOp:       allFailures.length === 0 ? 'ok' : 'partial',
      },
    }));

    audit('personal_sync', {
      memberEmail,
      created: createdOk.length,
      deleted: deletedOk.length,
      updated: updatedOk.length,
      failed:  allFailures.length,
    });

    return {
      synced:  createdOk.length,
      deleted: deletedOk.length,
      updated: updatedOk.length,
      failed:  allFailures.length,
      errors:  allFailures.map(f => ({ taskId: f.item?.id, message: f.error?.message || String(f.error) })),
    };
  };

  // Delete every event THIS user previously synced and clear their markers.
  const bulkUnsyncMyTasksFromGoogle = async ({
    memberEmail,
    onProgress = () => {},
    concurrency = 5,
  } = {}) => {
    if (!memberEmail) return { unsynced: 0, failed: 0, errors: [] };
    const targets = tasks.filter(t => t.personalSync?.[memberEmail]?.eventId);
    if (targets.length === 0) return { unsynced: 0, failed: 0, errors: [] };

    let done = 0;
    const results = await pMapLimit(targets, concurrency, async (task) => {
      const ps = task.personalSync[memberEmail];
      try { await deleteEvent('primary', ps.eventId); }
      catch (err) { if (err.status !== 404) throw err; }
      done++;
      onProgress({ done, total: targets.length });
      return { taskId: task.id };
    });

    const successes = results.filter(r => r.ok);
    const failures  = results.filter(r => !r.ok);

    successes.forEach(r => {
      dispatch({
        type:  'UPDATE',
        id:    r.value.taskId,
        patch: { personalSync: clearPersonalSync(tasks, r.value.taskId, memberEmail) },
      });
    });

    setSyncStatus(prev => ({
      ...prev,
      [memberEmail]: {
        lastSyncedAt: Date.now(),
        count:        0,
        errors:       failures.map(f => ({ taskId: f.item?.id, message: f.error?.message || String(f.error) })),
        lastOp:       'unsync',
      },
    }));

    audit('personal_unsync', {
      memberEmail,
      removed: successes.length,
      failed:  failures.length,
    });

    return {
      unsynced: successes.length,
      failed:   failures.length,
      errors:   failures.map(f => ({ taskId: f.item?.id, message: f.error?.message || String(f.error) })),
    };
  };

  // Wipe all calEventId markers (does NOT delete remote events).
  // Use when starting fresh sync to a different calendar.
  const clearSyncMarkers = () => {
    tasks.forEach(t => {
      if (t.calEventId) dispatch({ type: 'UPDATE', id: t.id, patch: { calEventId: null } });
    });
  };

  // Delete every previously-synced Google event + clear local markers.
  // Reverses bulkSyncToGoogle. Returns { unsynced, failed, errors }.
  const bulkUnsyncFromGoogle = async ({
    onProgress  = () => {},
    concurrency = 5,
  } = {}) => {
    const targets = tasks.filter(t => t.calEventId);
    if (targets.length === 0) return { unsynced: 0, failed: 0, errors: [] };

    let done = 0;
    const results = await pMapLimit(targets, concurrency, async (task) => {
      try {
        await deleteEvent('primary', task.calEventId);
      } catch (err) {
        // 404 = already deleted on Google side — proceed and clear marker locally.
        if (err.status !== 404) throw err;
      }
      done++;
      onProgress({ done, total: targets.length, task });
      return { taskId: task.id };
    });

    const successes = results.filter(r => r.ok);
    const failures  = results.filter(r => !r.ok);

    // Clear calEventId only for successfully deleted (or 404) tasks.
    successes.forEach(r => {
      dispatch({ type: 'UPDATE', id: r.value.taskId, patch: { calEventId: null } });
    });

    return {
      unsynced: successes.length,
      failed:   failures.length,
      errors:   failures.map(f => ({ taskId: f.item.id, message: f.error?.message || String(f.error) })),
    };
  };

  /**
   * Permanently delete a task with full cross-system cleanup.
   * - Removes any linked Google Calendar events (legacy calEventId + personalSync map)
   * - Dispatches REMOVE → drops from in-memory tasks → flushes to KV via cloudSync
   * - Audit-logs the deletion
   * 404 errors on Google side are treated as success (already gone).
   */
  const deleteTaskWithCleanup = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return { ok: false, error: 'Task not found' };

    const eventIds = [];
    if (task.calEventId) eventIds.push(task.calEventId);
    if (task.personalSync) {
      for (const sync of Object.values(task.personalSync)) {
        if (sync?.eventId) eventIds.push(sync.eventId);
      }
    }

    let removedEvents = 0;
    const failedEvents = [];
    for (const eventId of eventIds) {
      try {
        await deleteEvent('primary', eventId);
        removedEvents++;
      } catch (err) {
        if (err?.status === 404) {
          removedEvents++; // Already gone on Google side
        } else {
          failedEvents.push({ eventId, message: err?.message || String(err) });
        }
      }
    }

    dispatch({ type: 'REMOVE', id: taskId });
    audit('task_deleted', {
      taskId,
      name: task.name,
      assignee: task.assignee,
      removedEvents,
      failedEvents: failedEvents.length,
    });

    return { ok: true, removedEvents, failedEvents };
  };

  /**
   * Restore tasks + team to a point in time by reversing every audit entry
   * with `ts > cutoffTs`, in reverse chronological order. Backs up current
   * tasks/team to localStorage before mutating so a redo is possible.
   *
   * Returns { ok, reverted, skipped, backupKey }.
   */
  const restoreToPoint = (cutoffTs) => {
    if (!cutoffTs || typeof cutoffTs !== 'number') return { ok: false, error: 'Invalid cutoff timestamp' };

    const backupTs   = Date.now();
    const tasksBackup = JSON.stringify(tasksRef.current);
    const teamBackup  = JSON.stringify(team);
    try {
      localStorage.setItem(`dashboard_tasks__backup_${backupTs}`, tasksBackup);
      localStorage.setItem(`dashboard_team__backup_${backupTs}`,  teamBackup);
    } catch {}

    const nextTasks = JSON.parse(tasksBackup);
    const nextTeam  = JSON.parse(teamBackup);
    const byId      = Object.fromEntries(nextTasks.map(t => [t.id, t]));

    const newer = auditLog
      .filter(e => e.ts > cutoffTs)
      .sort((a, b) => b.ts - a.ts);

    let reverted = 0, skipped = 0;
    for (const e of newer) {
      try {
        switch (e.action) {
          case 'task_rescheduled': {
            const t = byId[e.taskId];
            if (t && e.before) { Object.assign(t, e.before); reverted++; } else skipped++;
            break;
          }
          case 'task_completed': {
            const t = byId[e.taskId];
            if (t) { t.done = false; t.completedAt = null; t.completedBy = null; reverted++; } else skipped++;
            break;
          }
          case 'task_uncompleted': {
            const t = byId[e.taskId];
            if (t) { t.done = true; reverted++; } else skipped++;
            break;
          }
          case 'member_added': {
            const idx = nextTeam.findIndex(m => m.email === e.email);
            if (idx >= 0) { nextTeam.splice(idx, 1); reverted++; } else skipped++;
            break;
          }
          case 'member_removed': {
            if (e.email && !nextTeam.some(m => m.email === e.email)) {
              nextTeam.push({ email: e.email, name: e.name || e.email, role: e.role || 'Team member' });
              reverted++;
            } else skipped++;
            break;
          }
          case 'email_changed': {
            if (e.oldEmail && e.newEmail) {
              for (const m of nextTeam) if (m.email === e.newEmail) m.email = e.oldEmail;
              for (const t of Object.values(byId)) if (t.assignee === e.newEmail) t.assignee = e.oldEmail;
              reverted++;
            } else skipped++;
            break;
          }
          default:
            // task_deleted, snapshot_imported, google_*, personal_sync,
            // personal_unsync — cannot reverse without full snapshots.
            skipped++;
        }
      } catch {
        skipped++;
      }
    }

    const restoredTasks = Object.values(byId);
    dispatch({ type: 'SET',       tasks: restoredTasks });
    setTeam(nextTeam);
    audit('restored_to_point', { cutoffTs, reverted, skipped, backupTs });

    return { ok: true, reverted, skipped, backupKey: `dashboard_tasks__backup_${backupTs}` };
  };

  // ─── Orphan audit on mount ──────────────────────────────────────────────
  // Tasks Section is single source of truth; this just logs warnings about
  // personalSync entries with eventIds that no longer have matching member emails
  // or any data inconsistencies. Pure logging, never auto-mutates.
  useEffect(() => {
    if (tasks.length === 0) return;
    const teamEmails = new Set(team.map(m => m.email));
    let orphanSyncs = 0;
    for (const t of tasks) {
      if (t.personalSync) {
        for (const email of Object.keys(t.personalSync)) {
          if (!teamEmails.has(email)) orphanSyncs++;
        }
      }
    }
    if (orphanSyncs > 0) {
      console.warn(`[task-audit] ${orphanSyncs} personalSync entries reference removed team members. Consider cleanup.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = {
    tasks,
    team,
    addTask,
    toggleTask,
    completeTask,
    uncompleteTask,
    onTaskCompleted,
    analytics,
    updateTask:  (id, patch)       => dispatch({ type: 'UPDATE',   id, patch }),
    removeTask:  (id)              => dispatch({ type: 'REMOVE',   id }),
    deleteTaskWithCleanup,
    restoreToPoint,
    reassign:    (id, assignee)    => dispatch({ type: 'REASSIGN', id, assignee }),
    resetSeed:   ()                => {
      dispatch({ type: 'RESET' });
      setTeam(SEED_TEAM);
    },
    addMember,
    updateMember,
    renameMember,
    removeMember,
    connectMemberGoogle,
    disconnectMemberGoogle,
    markMemberGoogleError,
    auditLog,
    isValidEmail,
    bulkSyncToGoogle,
    bulkUnsyncFromGoogle,
    bulkSyncMyTasksToGoogle,
    bulkUnsyncMyTasksFromGoogle,
    syncStatus,
    rescheduleTask,
    retryTaskSync,
    taskSyncStatus,
    exportSnapshot,
    downloadSnapshot,
    importSnapshot,
    cloudStatus,
    cloudPushNow: () => cloudRef.current?.pushNow(),
    cloudPullNow: () => cloudRef.current?.pullNow(),
    driveStatus,
    drivePushNow: () => driveRef.current?.notifyChange(),
    pushTaskUpdate,
    pushTaskDelete,
    clearSyncMarkers,
  };

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

function ServerTaskProvider({ children }) {
  const value = useServerTasks();
  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function TaskProvider({ children }) {
  return USE_SERVER_STORAGE
    ? <ServerTaskProvider>{children}</ServerTaskProvider>
    : <LegacyTaskProvider>{children}</LegacyTaskProvider>;
}

export const useTasks = () => useContext(TaskContext);
