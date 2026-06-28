import { useCallback, useMemo, useRef, useState } from 'react';
import { createEvent, deleteEvent, updateEvent } from '../api/calendarApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { pb, pbEnabled } from '../lib/pb.js';
import { useRealtimeCollection } from './useRealtimeCollection.js';
import { buildSeedTasks, TEAM as SEED_TEAM } from '../seed/socialCalendarTasks.js';

const SETTINGS_KEYS = {
  audit: 'audit_log',
  analytics: 'analytics',
  sync: 'sync_status',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidEmail(s) {
  return EMAIL_RE.test(String(s || '').trim());
}

export function resolveCurrentMember(team, profile) {
  if (!profile) return null;
  return (
    team.find((m) => m.googleSub && m.googleSub === profile.sub) ||
    team.find((m) => m.googleEmail && profile.email && m.googleEmail.toLowerCase() === profile.email.toLowerCase()) ||
    team.find((m) => profile.email && m.email.toLowerCase() === profile.email.toLowerCase()) ||
    null
  );
}

function addDaysIso(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildEventBodyFromTask(task, member) {
  const start = task.start || task.due;
  const endExclusive = addDaysIso(task.due, 1);
  return {
    summary: task.name,
    description: [
      'Command Dashboard',
      `Priority: ${task.priority}`,
      `Assignee: ${member?.name || task.assignee || 'Unassigned'}`,
      `Task ID: ${task.id}`,
    ].join('\n'),
    start: { date: start },
    end: { date: endExclusive },
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        commandDashboardTaskId: task.id,
        commandDashboardPriority: task.priority,
      },
    },
  };
}

function snapshotOf(task) {
  return {
    name: task.name,
    start: task.start || task.due,
    due: task.due,
    priority: task.priority,
  };
}

async function withRetry(fn, tries = 3) {
  let lastError;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = !error?.status || error.status === 429 || error.status >= 500;
      if (!retryable || attempt === tries - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

function taskFromRecord(record) {
  const expandedUser = record.expand?.assigned_to;
  return {
    id: record.id,
    name: record.title,
    description: record.description || '',
    assignee: expandedUser?.email || record.assignee_email || '',
    assigneeId: expandedUser?.id || record.assigned_to || null,
    start: record.start_date || record.end_date || new Date().toISOString().slice(0, 10),
    due: record.end_date || record.start_date || new Date().toISOString().slice(0, 10),
    priority: record.priority || 'med',
    done: record.status === 'done',
    calEventId: record.calendar_event_id || null,
    personalSync: record.personal_sync || null,
    syncState: record.sync_state || 'pending',
    lastUpdatedAt: record.last_updated_at || record.updated,
    lastUpdatedBy: record.expand?.last_updated_by?.email || null,
  };
}

function userFromRecord(record) {
  return {
    id: record.id,
    email: record.email,
    name: record.name || record.email,
    role: record.role || 'Team member',
    avatarUrl: record.avatar_url || null,
    googleEmail: record.google_email || null,
    googleSub: record.google_sub || null,
    googleStatus: record.google_status || 'not_connected',
    googleConnectedAt: record.google_connected_at || null,
    googleError: record.google_error || null,
  };
}

function settingFromRecord(record) {
  let parsed = record.value;
  try {
    parsed = JSON.parse(record.value);
  } catch {}
  return {
    id: record.id,
    key: record.key,
    value: parsed,
  };
}

function makeTempId(prefix) {
  return `tmp-${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function usePocketBaseTasks() {
  const { profile, workspaceUser } = useAuth();
  const [taskSyncStatus, setTaskSyncStatus] = useState({});
  const automationsRef = useRef(new Set());

  const taskStore = useRealtimeCollection('tasks', {
    sort: 'end_date,title',
    expand: 'assigned_to,last_updated_by',
    mapRecord: taskFromRecord,
  });
  const userStore = useRealtimeCollection('users', {
    sort: 'name,email',
    mapRecord: userFromRecord,
  });
  const settingStore = useRealtimeCollection('settings', {
    sort: 'key',
    mapRecord: settingFromRecord,
  });

  const team = userStore.records;
  const tasks = taskStore.records;
  const currentMember = useMemo(() => resolveCurrentMember(team, profile), [team, profile]);

  const settingsMap = useMemo(() => {
    const map = new Map();
    settingStore.records.forEach((setting) => map.set(setting.key, setting));
    return map;
  }, [settingStore.records]);

  const auditLog = settingsMap.get(SETTINGS_KEYS.audit)?.value || [];
  const analytics = settingsMap.get(SETTINGS_KEYS.analytics)?.value || [];
  const syncStatus = settingsMap.get(SETTINGS_KEYS.sync)?.value || {};

  const usersByEmail = useMemo(
    () => new Map(team.map((member) => [member.email, member])),
    [team]
  );

  const cloudStatus = useMemo(() => {
    if (!pbEnabled) {
      return { state: 'unconfigured', version: 0, updatedAt: null, error: null };
    }
    const error = taskStore.error || userStore.error || settingStore.error || null;
    const loading = taskStore.loading || userStore.loading || settingStore.loading;
    const updatedAt = Math.max(taskStore.lastLoadedAt || 0, userStore.lastLoadedAt || 0, settingStore.lastLoadedAt || 0) || null;
    return {
      state: error ? 'error' : loading ? 'pulling' : 'synced',
      version: updatedAt || 0,
      updatedAt,
      error: error?.message || null,
    };
  }, [settingStore.error, settingStore.lastLoadedAt, settingStore.loading, taskStore.error, taskStore.lastLoadedAt, taskStore.loading, userStore.error, userStore.lastLoadedAt, userStore.loading]);

  const reloadAll = useCallback(async () => {
    await Promise.all([taskStore.reload(), userStore.reload(), settingStore.reload()]);
  }, [settingStore, taskStore, userStore]);

  const setSyncFor = useCallback((taskId, patch) => {
    setTaskSyncStatus((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] || {}), ...patch, ts: Date.now() },
    }));
  }, []);

  const saveSetting = useCallback(async (key, value) => {
    if (!pbEnabled) return null;
    const current = settingsMap.get(key) || null;
    const nextEntry = current ? { ...current, value } : { id: makeTempId(key), key, value };

    settingStore.setRecords((prev) => {
      const rest = prev.filter((entry) => entry.key !== key);
      return [...rest, nextEntry].sort((a, b) => a.key.localeCompare(b.key));
    });

    try {
      const payload = { key, value: JSON.stringify(value) };
      await withRetry(() => (
        current
          ? pb.collection('settings').update(current.id, payload)
          : pb.collection('settings').create(payload)
      ));
    } catch (error) {
      await settingStore.reload().catch(() => {});
      throw error;
    }

    return nextEntry;
  }, [settingStore, settingsMap]);

  const appendAudit = useCallback((action, payload = {}) => {
    const next = [...auditLog, { action, ts: Date.now(), ...payload }].slice(-500);
    saveSetting(SETTINGS_KEYS.audit, next).catch(() => {});
  }, [auditLog, saveSetting]);

  const writeSyncStatus = useCallback((nextValue) => {
    saveSetting(SETTINGS_KEYS.sync, nextValue).catch(() => {});
  }, [saveSetting]);

  const writeAnalytics = useCallback((nextValue) => {
    saveSetting(SETTINGS_KEYS.analytics, nextValue.slice(-1000)).catch(() => {});
  }, [saveSetting]);

  const applyTaskLocal = useCallback((taskId, updater) => {
    taskStore.setRecords((prev) => prev.map((task) => (task.id === taskId ? updater(task) : task)));
  }, [taskStore]);

  const persistTaskPatch = useCallback(async (taskId, uiPatch) => {
    if (!pbEnabled) throw new Error('PocketBase is not configured.');
    const member = uiPatch.assignee ? usersByEmail.get(uiPatch.assignee) : null;
    const recordPatch = {
      ...(uiPatch.name !== undefined ? { title: uiPatch.name } : {}),
      ...(uiPatch.description !== undefined ? { description: uiPatch.description } : {}),
      ...(uiPatch.priority !== undefined ? { priority: uiPatch.priority } : {}),
      ...(uiPatch.start !== undefined ? { start_date: uiPatch.start } : {}),
      ...(uiPatch.due !== undefined ? { end_date: uiPatch.due } : {}),
      ...(uiPatch.calEventId !== undefined ? { calendar_event_id: uiPatch.calEventId } : {}),
      ...(uiPatch.personalSync !== undefined ? { personal_sync: uiPatch.personalSync } : {}),
      ...(uiPatch.done !== undefined ? { status: uiPatch.done ? 'done' : 'todo' } : {}),
      ...(uiPatch.assignee !== undefined ? {
        assigned_to: member?.id || null,
        assignee_email: uiPatch.assignee || '',
      } : {}),
      last_updated_at: new Date().toISOString(),
      last_updated_by: workspaceUser?.id || currentMember?.id || null,
    };

    await withRetry(() => pb.collection('tasks').update(taskId, recordPatch));
  }, [currentMember?.id, usersByEmail, workspaceUser?.id]);

  const upsertGoogleLink = useCallback(async (memberEmail, patch) => {
    const member = usersByEmail.get(memberEmail);
    if (!member) throw new Error('Team member not found');
    userStore.setRecords((prev) => prev.map((entry) => (
      entry.email === memberEmail ? { ...entry, ...patch } : entry
    )));
    await withRetry(() => pb.collection('users').update(member.id, patch));
  }, [userStore, usersByEmail]);

  const addTask = useCallback((draft) => {
    const tempId = makeTempId('task');
    const optimistic = {
      id: tempId,
      name: draft.name,
      description: draft.description || '',
      assignee: draft.assignee || '',
      assigneeId: usersByEmail.get(draft.assignee || '')?.id || null,
      start: draft.start || draft.due,
      due: draft.due,
      priority: draft.priority || 'med',
      done: false,
      calEventId: draft.calEventId || null,
      personalSync: null,
      syncState: draft.calEventId ? 'synced' : 'pending',
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedBy: workspaceUser?.email || currentMember?.email || null,
    };

    taskStore.setRecords((prev) => [optimistic, ...prev]);

    const assignee = usersByEmail.get(draft.assignee || '');
    withRetry(() => pb.collection('tasks').create({
      title: draft.name,
      description: draft.description || '',
      status: 'todo',
      priority: draft.priority || 'med',
      assigned_to: assignee?.id || null,
      assignee_email: assignee?.email || draft.assignee || '',
      start_date: draft.start || draft.due,
      end_date: draft.due,
      calendar_event_id: draft.calEventId || null,
      sync_state: draft.calEventId ? 'synced' : 'pending',
      personal_sync: null,
      last_updated_at: new Date().toISOString(),
      last_updated_by: workspaceUser?.id || currentMember?.id || null,
    }))
      .then(() => taskStore.reload())
      .catch(() => {
        taskStore.setRecords((prev) => prev.filter((task) => task.id !== tempId));
      });
  }, [currentMember?.email, currentMember?.id, taskStore, usersByEmail, workspaceUser?.email, workspaceUser?.id]);

  const updateTask = useCallback((taskId, patch) => {
    const before = tasks.find((task) => task.id === taskId);
    if (!before) return;
    applyTaskLocal(taskId, (task) => ({ ...task, ...patch }));
    persistTaskPatch(taskId, patch).catch(() => {
      applyTaskLocal(taskId, () => before);
    });
  }, [applyTaskLocal, persistTaskPatch, tasks]);

  const removeTask = useCallback((taskId) => {
    const before = tasks;
    taskStore.setRecords((prev) => prev.filter((task) => task.id !== taskId));
    withRetry(() => pb.collection('tasks').delete(taskId))
      .then(() => taskStore.reload())
      .catch(() => taskStore.setRecords(before));
  }, [taskStore, tasks]);

  const reassign = useCallback((taskId, assigneeEmail) => {
    updateTask(taskId, { assignee: assigneeEmail });
  }, [updateTask]);

  const toggleTask = useCallback((taskId) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    updateTask(taskId, { done: !task.done });
  }, [tasks, updateTask]);

  const onTaskCompleted = useCallback((fn) => {
    automationsRef.current.add(fn);
    return () => automationsRef.current.delete(fn);
  }, []);

  const completeTask = useCallback((taskId) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return { ok: false, error: 'Task not found' };
    if (task.done) return { ok: true, alreadyDone: true, task };
    updateTask(taskId, { done: true });
    const nextAnalytics = [
      ...analytics,
      {
        type: 'task_completed',
        taskId,
        taskName: task.name,
        at: Date.now(),
      },
    ];
    writeAnalytics(nextAnalytics);
    appendAudit('task_completed', { taskId, name: task.name });
    automationsRef.current.forEach((fn) => Promise.resolve().then(() => fn({ ...task, done: true })).catch(() => {}));
    return { ok: true, task: { ...task, done: true } };
  }, [analytics, appendAudit, tasks, updateTask, writeAnalytics]);

  const uncompleteTask = useCallback((taskId) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || !task.done) return { ok: true, alreadyOpen: true };
    updateTask(taskId, { done: false });
    appendAudit('task_uncompleted', { taskId, name: task.name });
    return { ok: true };
  }, [appendAudit, tasks, updateTask]);

  const rescheduleTask = useCallback(async (taskId, patchInput, opts = {}) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return { ok: false, error: 'Task not found' };

    const patch = {
      ...(patchInput.name !== undefined ? { name: patchInput.name } : {}),
      ...(patchInput.priority !== undefined ? { priority: patchInput.priority } : {}),
      ...(patchInput.start !== undefined ? { start: patchInput.start } : {}),
      ...(patchInput.due !== undefined ? { due: patchInput.due } : {}),
    };

    const next = { ...task, ...patch };
    if (next.due < (next.start || next.due)) {
      return { ok: false, error: 'End date must be on or after start date.' };
    }

    applyTaskLocal(taskId, () => next);
    setSyncFor(taskId, { state: 'saving', error: null });

    try {
      await persistTaskPatch(taskId, patch);
      appendAudit('task_rescheduled', {
        taskId,
        start: next.start,
        due: next.due,
        memberEmail: opts.memberEmail || null,
      });

      if (opts.memberEmail) {
        const member = usersByEmail.get(next.assignee);
        const body = buildEventBodyFromTask(next, member);
        const personalSync = next.personalSync?.[opts.memberEmail];
        setSyncFor(taskId, { state: 'syncing', error: null });

        try {
          if (personalSync?.eventId) {
            await updateEvent('primary', personalSync.eventId, body);
          } else if (next.assignee === opts.memberEmail && !next.done) {
            const created = await createEvent('primary', body);
            next.personalSync = {
              ...(next.personalSync || {}),
              [opts.memberEmail]: {
                eventId: created.id,
                syncedAt: Date.now(),
                snapshot: snapshotOf(next),
              },
            };
            applyTaskLocal(taskId, () => next);
            await persistTaskPatch(taskId, { personalSync: next.personalSync });
          }
          setSyncFor(taskId, { state: 'synced', error: null });
        } catch (syncError) {
          setSyncFor(taskId, { state: 'failed', error: syncError?.message || 'Sync failed' });
        }
      } else {
        setSyncFor(taskId, { state: 'synced', error: null });
      }

      return { ok: true };
    } catch (error) {
      applyTaskLocal(taskId, () => task);
      setSyncFor(taskId, { state: 'failed', error: error?.message || 'Save failed' });
      return { ok: false, error: error?.message || 'Save failed' };
    }
  }, [appendAudit, applyTaskLocal, persistTaskPatch, setSyncFor, tasks, usersByEmail]);

  const retryTaskSync = useCallback(async (taskId, memberEmail) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || !memberEmail) return { ok: false };
    const member = usersByEmail.get(task.assignee);
    const body = buildEventBodyFromTask(task, member);
    setSyncFor(taskId, { state: 'syncing', error: null });
    try {
      const existing = task.personalSync?.[memberEmail];
      const event = existing?.eventId
        ? await updateEvent('primary', existing.eventId, body).then(() => ({ id: existing.eventId }))
        : await createEvent('primary', body);
      const nextPersonalSync = {
        ...(task.personalSync || {}),
        [memberEmail]: { eventId: event.id, syncedAt: Date.now(), snapshot: snapshotOf(task) },
      };
      applyTaskLocal(taskId, (entry) => ({ ...entry, personalSync: nextPersonalSync }));
      await persistTaskPatch(taskId, { personalSync: nextPersonalSync });
      setSyncFor(taskId, { state: 'synced', error: null });
      return { ok: true };
    } catch (error) {
      setSyncFor(taskId, { state: 'failed', error: error?.message || 'Sync failed' });
      return { ok: false, error: error?.message || 'Sync failed' };
    }
  }, [applyTaskLocal, persistTaskPatch, setSyncFor, tasks, usersByEmail]);

  const addMember = useCallback((member) => {
    const email = member.email.trim();
    if (!isValidEmail(email)) return { ok: false, error: 'Invalid email format' };
    if (team.some((entry) => entry.email === email)) return { ok: false, error: 'Email already in team' };

    const optimistic = {
      id: makeTempId('member'),
      email,
      name: member.name || email,
      role: member.role || 'Team member',
      avatarUrl: null,
      googleEmail: null,
      googleSub: null,
      googleStatus: 'not_connected',
      googleConnectedAt: null,
      googleError: null,
    };

    userStore.setRecords((prev) => [...prev, optimistic].sort((a, b) => a.name.localeCompare(b.name)));
    withRetry(() => pb.collection('users').create({
      email,
      name: member.name || email,
      role: member.role || 'Team member',
      google_status: 'not_connected',
    }))
      .then(() => userStore.reload())
      .catch(() => userStore.setRecords((prev) => prev.filter((entry) => entry.id !== optimistic.id)));

    appendAudit('member_added', { email, name: member.name || email });
    return { ok: true };
  }, [appendAudit, team, userStore]);

  const renameMember = useCallback((oldEmail, newEmail, patch = {}) => {
    const member = usersByEmail.get(oldEmail);
    if (!member) return { ok: false, error: 'Member not found' };
    if (!isValidEmail(newEmail)) return { ok: false, error: 'Invalid email format' };
    if (newEmail !== oldEmail && team.some((entry) => entry.email === newEmail)) {
      return { ok: false, error: 'Email already in team' };
    }

    userStore.setRecords((prev) => prev.map((entry) => (
      entry.email === oldEmail
        ? { ...entry, email: newEmail, name: patch.name || entry.name, role: patch.role || entry.role }
        : entry
    )));
    taskStore.setRecords((prev) => prev.map((task) => (
      task.assignee === oldEmail ? { ...task, assignee: newEmail } : task
    )));

    withRetry(() => pb.collection('users').update(member.id, {
      email: newEmail,
      name: patch.name || member.name,
      role: patch.role || member.role,
      google_email: member.googleEmail,
    }))
      .then(async () => {
        const impacted = tasks.filter((task) => task.assignee === oldEmail);
        await Promise.all(impacted.map((task) => persistTaskPatch(task.id, { assignee: newEmail })));
        await Promise.all([userStore.reload(), taskStore.reload()]);
      })
      .catch(() => reloadAll());

    if (newEmail !== oldEmail) appendAudit('email_changed', { oldEmail, newEmail });
    return { ok: true, changed: newEmail !== oldEmail };
  }, [appendAudit, persistTaskPatch, reloadAll, taskStore, tasks, team, userStore, usersByEmail]);

  const removeMember = useCallback((memberEmail, reassignedTo) => {
    const member = usersByEmail.get(memberEmail);
    const target = usersByEmail.get(reassignedTo);
    if (!member || !target) return;

    userStore.setRecords((prev) => prev.filter((entry) => entry.email !== memberEmail));
    taskStore.setRecords((prev) => prev.map((task) => (
      task.assignee === memberEmail ? { ...task, assignee: reassignedTo, assigneeId: target.id } : task
    )));

    Promise.all(tasks
      .filter((task) => task.assignee === memberEmail)
      .map((task) => persistTaskPatch(task.id, { assignee: reassignedTo })))
      .then(() => pb.collection('users').delete(member.id))
      .then(() => reloadAll())
      .catch(() => reloadAll());

    appendAudit('member_removed', { email: memberEmail, reassignedTo });
  }, [appendAudit, persistTaskPatch, reloadAll, taskStore, tasks, userStore, usersByEmail]);

  const connectMemberGoogle = useCallback((memberEmail, googleProfile) => {
    upsertGoogleLink(memberEmail, {
      google_sub: googleProfile.sub,
      google_email: googleProfile.email,
      avatar_url: googleProfile.picture || null,
      google_status: 'connected',
      google_connected_at: new Date().toISOString(),
      google_error: null,
      last_login_at: new Date().toISOString(),
    }).catch(() => {});
    appendAudit('google_connected', { memberEmail, googleEmail: googleProfile.email, googleSub: googleProfile.sub });
    return { ok: true };
  }, [appendAudit, upsertGoogleLink]);

  const disconnectMemberGoogle = useCallback((memberEmail) => {
    upsertGoogleLink(memberEmail, {
      google_sub: null,
      google_email: null,
      google_status: 'not_connected',
      google_connected_at: null,
      google_error: null,
    }).catch(() => {});
    appendAudit('google_disconnected', { memberEmail });
  }, [appendAudit, upsertGoogleLink]);

  const markMemberGoogleError = useCallback((memberEmail, errorMessage) => {
    upsertGoogleLink(memberEmail, {
      google_status: 'error',
      google_error: errorMessage,
    }).catch(() => {});
    appendAudit('google_error', { memberEmail, message: errorMessage });
  }, [appendAudit, upsertGoogleLink]);

  const bulkSyncToGoogle = useCallback(async ({ onProgress = () => {} } = {}) => {
    const targets = tasks.filter((task) => !task.done && task.due && !task.calEventId);
    if (targets.length === 0) return { synced: 0, skipped: tasks.length, failed: 0, errors: [] };
    const errors = [];
    let synced = 0;

    for (let index = 0; index < targets.length; index += 1) {
      const task = targets[index];
      try {
        const member = usersByEmail.get(task.assignee);
        const event = await createEvent('primary', buildEventBodyFromTask(task, member));
        await persistTaskPatch(task.id, { calEventId: event.id });
        applyTaskLocal(task.id, (entry) => ({ ...entry, calEventId: event.id }));
        synced += 1;
      } catch (error) {
        errors.push({ taskId: task.id, message: error?.message || 'Sync failed' });
      }
      onProgress({ done: index + 1, total: targets.length });
    }

    return { synced, skipped: tasks.length - targets.length, failed: errors.length, errors };
  }, [applyTaskLocal, persistTaskPatch, tasks, usersByEmail]);

  const bulkUnsyncFromGoogle = useCallback(async ({ onProgress = () => {} } = {}) => {
    const targets = tasks.filter((task) => task.calEventId);
    const errors = [];
    let unsynced = 0;
    for (let index = 0; index < targets.length; index += 1) {
      const task = targets[index];
      try {
        await deleteEvent('primary', task.calEventId);
      } catch (error) {
        if (error?.status !== 404) {
          errors.push({ taskId: task.id, message: error?.message || 'Unsync failed' });
          onProgress({ done: index + 1, total: targets.length });
          continue;
        }
      }
      await persistTaskPatch(task.id, { calEventId: null });
      applyTaskLocal(task.id, (entry) => ({ ...entry, calEventId: null }));
      unsynced += 1;
      onProgress({ done: index + 1, total: targets.length });
    }
    return { unsynced, failed: errors.length, errors };
  }, [applyTaskLocal, persistTaskPatch, tasks]);

  const bulkSyncMyTasksToGoogle = useCallback(async ({ memberEmail, onProgress = () => {} } = {}) => {
    if (!memberEmail) return { synced: 0, deleted: 0, updated: 0, failed: 0, errors: [] };
    const mine = tasks.filter((task) => task.assignee === memberEmail && !task.done && task.due);
    const errors = [];
    let synced = 0;
    let updated = 0;
    let deleted = 0;

    const myMarkers = tasks.filter((task) => task.personalSync?.[memberEmail]?.eventId);
    const orphaned = myMarkers.filter((task) => task.assignee !== memberEmail || task.done);
    const total = orphaned.length + mine.length;
    let doneCount = 0;

    for (const task of orphaned) {
      try {
        await deleteEvent('primary', task.personalSync[memberEmail].eventId);
        const nextPersonalSync = { ...(task.personalSync || {}) };
        delete nextPersonalSync[memberEmail];
        await persistTaskPatch(task.id, { personalSync: Object.keys(nextPersonalSync).length ? nextPersonalSync : null });
        applyTaskLocal(task.id, (entry) => ({ ...entry, personalSync: Object.keys(nextPersonalSync).length ? nextPersonalSync : null }));
        deleted += 1;
      } catch (error) {
        errors.push({ taskId: task.id, message: error?.message || 'Delete failed' });
      }
      doneCount += 1;
      onProgress({ done: doneCount, total });
    }

    for (const task of mine) {
      try {
        const member = usersByEmail.get(task.assignee);
        const body = buildEventBodyFromTask(task, member);
        const existing = task.personalSync?.[memberEmail];
        const event = existing?.eventId
          ? await updateEvent('primary', existing.eventId, body).then(() => ({ id: existing.eventId }))
          : await createEvent('primary', body);
        const nextPersonalSync = {
          ...(task.personalSync || {}),
          [memberEmail]: { eventId: event.id, syncedAt: Date.now(), snapshot: snapshotOf(task) },
        };
        await persistTaskPatch(task.id, { personalSync: nextPersonalSync });
        applyTaskLocal(task.id, (entry) => ({ ...entry, personalSync: nextPersonalSync }));
        if (existing?.eventId) updated += 1;
        else synced += 1;
      } catch (error) {
        errors.push({ taskId: task.id, message: error?.message || 'Sync failed' });
      }
      doneCount += 1;
      onProgress({ done: doneCount, total });
    }

    const nextSync = {
      ...syncStatus,
      [memberEmail]: {
        lastSyncedAt: Date.now(),
        count: tasks.filter((task) => task.assignee === memberEmail).length,
        errors,
        lastOp: errors.length ? 'partial' : 'ok',
      },
    };
    writeSyncStatus(nextSync);

    return { synced, deleted, updated, failed: errors.length, errors };
  }, [applyTaskLocal, persistTaskPatch, syncStatus, tasks, usersByEmail, writeSyncStatus]);

  const bulkUnsyncMyTasksFromGoogle = useCallback(async ({ memberEmail, onProgress = () => {} } = {}) => {
    if (!memberEmail) return { unsynced: 0, failed: 0, errors: [] };
    const targets = tasks.filter((task) => task.personalSync?.[memberEmail]?.eventId);
    const errors = [];
    let unsynced = 0;
    for (let index = 0; index < targets.length; index += 1) {
      const task = targets[index];
      try {
        await deleteEvent('primary', task.personalSync[memberEmail].eventId);
        const nextPersonalSync = { ...(task.personalSync || {}) };
        delete nextPersonalSync[memberEmail];
        await persistTaskPatch(task.id, { personalSync: Object.keys(nextPersonalSync).length ? nextPersonalSync : null });
        applyTaskLocal(task.id, (entry) => ({ ...entry, personalSync: Object.keys(nextPersonalSync).length ? nextPersonalSync : null }));
        unsynced += 1;
      } catch (error) {
        errors.push({ taskId: task.id, message: error?.message || 'Unsync failed' });
      }
      onProgress({ done: index + 1, total: targets.length });
    }
    return { unsynced, failed: errors.length, errors };
  }, [applyTaskLocal, persistTaskPatch, tasks]);

  const clearSyncMarkers = useCallback(() => {
    tasks.filter((task) => task.calEventId).forEach((task) => updateTask(task.id, { calEventId: null }));
  }, [tasks, updateTask]);

  const exportSnapshot = useCallback(() => ({
    kind: 'command-dashboard-snapshot',
    version: 2,
    exportedAt: new Date().toISOString(),
    origin: typeof window !== 'undefined' ? window.location.origin : 'command-dashboard',
    keyCount: 5,
    data: {
      tasks,
      team,
      auditLog,
      analytics,
      syncStatus,
    },
  }), [analytics, auditLog, syncStatus, tasks, team]);

  const downloadSnapshot = useCallback(() => {
    const snap = exportSnapshot();
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `command-dashboard-snapshot-${snap.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return snap;
  }, [exportSnapshot]);

  const importSnapshot = useCallback((snapshot, { reload = true } = {}) => {
    if (!snapshot?.data) return { ok: false, error: 'Snapshot missing data block.' };

    const run = async () => {
      const targetTasks = snapshot.data.tasks || [];
      const targetTeam = snapshot.data.team || [];

      for (const existingTask of tasks) {
        await pb.collection('tasks').delete(existingTask.id).catch(() => {});
      }
      for (const existingMember of team) {
        await pb.collection('users').delete(existingMember.id).catch(() => {});
      }

      for (const member of targetTeam) {
        await pb.collection('users').create({
          email: member.email,
          name: member.name,
          role: member.role || 'Team member',
          google_sub: member.googleSub || null,
          google_email: member.googleEmail || null,
          avatar_url: member.avatarUrl || null,
          google_status: member.googleStatus || 'not_connected',
          google_connected_at: member.googleConnectedAt || null,
          google_error: member.googleError || null,
        });
      }

      await userStore.reload();
      const freshUsers = new Map(userStore.records.map((member) => [member.email, member]));

      for (const task of targetTasks) {
        const assignee = freshUsers.get(task.assignee);
        await pb.collection('tasks').create({
          title: task.name,
          description: task.description || '',
          status: task.done ? 'done' : 'todo',
          priority: task.priority || 'med',
          assigned_to: assignee?.id || null,
          assignee_email: task.assignee || '',
          start_date: task.start || task.due,
          end_date: task.due,
          calendar_event_id: task.calEventId || null,
          personal_sync: task.personalSync || null,
          sync_state: task.syncState || 'pending',
          last_updated_at: task.lastUpdatedAt || new Date().toISOString(),
          last_updated_by: workspaceUser?.id || null,
        });
      }

      await Promise.all([
        saveSetting(SETTINGS_KEYS.audit, snapshot.data.auditLog || []),
        saveSetting(SETTINGS_KEYS.analytics, snapshot.data.analytics || []),
        saveSetting(SETTINGS_KEYS.sync, snapshot.data.syncStatus || {}),
      ]);

      await reloadAll();
      if (reload) window.location.reload();
    };

    run().catch(() => {});
    return { ok: true, restored: 5 };
  }, [reloadAll, saveSetting, tasks, team, userStore, workspaceUser?.id]);

  const resetSeed = useCallback(() => {
    importSnapshot({
      data: {
        tasks: buildSeedTasks().map((task) => ({
          id: makeTempId('seed'),
          name: task.name,
          description: '',
          assignee: task.assignee,
          start: task.start || task.due,
          due: task.due,
          priority: task.priority,
          done: Boolean(task.done),
          calEventId: task.calEventId || null,
          personalSync: task.personalSync || null,
        })),
        team: SEED_TEAM.map((member) => ({
          ...member,
          googleSub: null,
          googleEmail: null,
          googleStatus: 'not_connected',
          googleConnectedAt: null,
          googleError: null,
        })),
        auditLog: [],
        analytics: [],
        syncStatus: {},
      },
    }, { reload: false });
  }, [importSnapshot]);

  return {
    tasks,
    team,
    addTask,
    toggleTask,
    completeTask,
    uncompleteTask,
    onTaskCompleted,
    analytics,
    updateTask,
    removeTask,
    reassign,
    resetSeed,
    addMember,
    updateMember: (email, patch) => renameMember(email, email, patch),
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
    cloudPushNow: reloadAll,
    cloudPullNow: reloadAll,
    pushTaskUpdate: persistTaskPatch,
    pushTaskDelete: (taskId) => pb.collection('tasks').delete(taskId),
    clearSyncMarkers,
  };
}
