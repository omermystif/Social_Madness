import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client.js';
import { createEvent, deleteEvent, updateEvent } from '../api/calendarApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { buildSeedTasks, TEAM as SEED_TEAM } from '../seed/socialCalendarTasks.js';

const SETTINGS_KEYS = {
  analytics: 'analytics',
  sync: 'sync_status',
};

const DEFAULT_TEAM_NAME = 'Command Dashboard';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function taskFromApi(task) {
  const personalSync = {};
  for (const entry of task.personal_sync || []) {
    let snapshot = null;
    try { snapshot = entry.snapshot_json ? JSON.parse(entry.snapshot_json) : null; } catch {}
    personalSync[entry.member_email] = {
      eventId: entry.event_id,
      syncedAt: entry.synced_at ? Date.parse(entry.synced_at) : null,
      snapshot,
    };
  }
  return {
    id: task.id,
    name: task.title,
    description: task.description || '',
    assignee: task.assignee_email || '',
    priority: task.priority || 'med',
    start: task.start_date || task.due_date || new Date().toISOString().slice(0, 10),
    due: task.due_date || task.start_date || new Date().toISOString().slice(0, 10),
    done: Boolean(task.done),
    calEventId: task.calendar_event_id || null,
    personalSync: Object.keys(personalSync).length ? personalSync : null,
    createdAt: task.created_at ? Date.parse(task.created_at) : Date.now(),
    createdBy: task.created_by || null,
  };
}

function memberFromApi(member) {
  return {
    email: member.email,
    name: member.name || member.email,
    role: member.role || 'Team member',
    googleEmail: member.google_email || null,
    googleSub: member.google_sub || null,
    googleStatus: member.google_status || 'not_connected',
    googleConnectedAt: null,
    googleError: null,
  };
}

function addDaysIso(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function snapshotOf(task) {
  return {
    name: task.name,
    start: task.start || task.due,
    due: task.due,
    priority: task.priority,
  };
}

function buildEventBodyFromTask(task, member) {
  return {
    summary: task.name,
    description: [
      'Command Dashboard',
      `Priority: ${task.priority}`,
      `Assignee: ${member?.name || task.assignee || 'Unassigned'}`,
      `Task ID: ${task.id}`,
    ].join('\n'),
    start: { date: task.start || task.due },
    end: { date: addDaysIso(task.due, 1) },
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        commandDashboardTaskId: task.id,
        commandDashboardPriority: task.priority,
      },
    },
  };
}

function makeAudit(action, details = {}) {
  return { action, ts: Date.now(), ...details };
}

export default function useServerTasks() {
  const { user, profile } = useAuth();
  const [teamId, setTeamId] = useState(null);
  const [team, setTeam] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [syncStatus, setSyncStatus] = useState({});
  const [taskSyncStatus, setTaskSyncStatus] = useState({});
  const [cloudStatus, setCloudStatus] = useState({ state: 'idle', updatedAt: null, error: null });
  const automationsRef = useRef(new Set());
  const pollRef = useRef(null);
  const currentMember = useMemo(() => resolveCurrentMember(team, profile), [team, profile]);

  const setSyncFor = useCallback((taskId, patch) => {
    setTaskSyncStatus((prev) => ({ ...prev, [taskId]: { ...(prev[taskId] || {}), ...patch, ts: Date.now() } }));
  }, []);

  const saveSetting = useCallback(async (key, value) => {
    if (!teamId) return;
    await api.settings.put(teamId, key, value);
  }, [teamId]);

  const loadWorkspace = useCallback(async (activeTeamId, { quiet = false } = {}) => {
    if (!activeTeamId) return;
    if (!quiet) setCloudStatus((prev) => ({ ...prev, state: 'loading', error: null }));
    const [membersRes, tasksRes, auditRes, settingsRes] = await Promise.all([
      api.members.list(activeTeamId),
      api.tasks.list(activeTeamId),
      api.audit.list(activeTeamId),
      api.settings.list(activeTeamId),
    ]);

    setTeam((membersRes.members || []).map(memberFromApi));
    setTasks((tasksRes.tasks || []).map(taskFromApi));
    setAuditLog((auditRes.entries || []).sort((a, b) => new Date(a.ts) - new Date(b.ts)));
    setAnalytics(settingsRes.settings?.[SETTINGS_KEYS.analytics] || []);
    setSyncStatus(settingsRes.settings?.[SETTINGS_KEYS.sync] || {});
    setCloudStatus({ state: 'saved', updatedAt: Date.now(), error: null });
  }, []);

  const bootstrapWorkspace = useCallback(async () => {
    if (!user) {
      setTeam([]);
      setTasks([]);
      setAuditLog([]);
      setAnalytics([]);
      setSyncStatus({});
      setCloudStatus({ state: 'signin-required', updatedAt: null, error: null });
      return;
    }

    setCloudStatus({ state: 'loading', updatedAt: null, error: null });
    let teamsRes = await api.teams.list();
    let activeTeam = teamsRes.teams?.[0];

    if (!activeTeam) {
      const created = await api.teams.create(DEFAULT_TEAM_NAME);
      activeTeam = created.team;
    }

    setTeamId(activeTeam.id);

    const membersRes = await api.members.list(activeTeam.id);
    if (!membersRes.members?.length) {
      for (const member of SEED_TEAM) {
        await api.members.create(activeTeam.id, member);
      }
    }

    const tasksRes = await api.tasks.list(activeTeam.id);
    if (!tasksRes.tasks?.length) {
      for (const task of buildSeedTasks()) {
        await api.tasks.create({
          team_id: activeTeam.id,
          title: task.name,
          description: task.description || '',
          assignee_email: task.assignee,
          priority: task.priority,
          start_date: task.start || task.due,
          due_date: task.due,
        });
      }
    }

    await loadWorkspace(activeTeam.id);
  }, [loadWorkspace, user]);

  useEffect(() => {
    bootstrapWorkspace().catch((error) => {
      setCloudStatus({ state: 'error', updatedAt: null, error: error.message || 'Workspace bootstrap failed' });
    });
  }, [bootstrapWorkspace]);

  useEffect(() => {
    if (!teamId || !user) return undefined;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      loadWorkspace(teamId, { quiet: true }).catch(() => {});
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [loadWorkspace, teamId, user]);

  const logAudit = useCallback(async (action, details = {}) => {
    if (!teamId) return;
    const entry = makeAudit(action, details);
    setAuditLog((prev) => [...prev, entry]);
    await api.audit.log(teamId, action, details);
  }, [teamId]);

  const persistTaskPatch = useCallback(async (taskId, patch) => {
    const apiPatch = {};
    if (patch.name !== undefined) apiPatch.title = patch.name;
    if (patch.description !== undefined) apiPatch.description = patch.description;
    if (patch.assignee !== undefined) apiPatch.assignee_email = patch.assignee;
    if (patch.priority !== undefined) apiPatch.priority = patch.priority;
    if (patch.start !== undefined) apiPatch.start_date = patch.start;
    if (patch.due !== undefined) apiPatch.due_date = patch.due;
    if (patch.done !== undefined) apiPatch.done = patch.done;
    if (patch.calEventId !== undefined) apiPatch.calendar_event_id = patch.calEventId;
    return api.tasks.update(taskId, apiPatch);
  }, []);

  const addTask = useCallback(async (draft) => {
    if (!teamId) return;
    const optimistic = {
      id: `tmp-${Math.random().toString(36).slice(2, 8)}`,
      name: draft.name,
      description: draft.description || '',
      assignee: draft.assignee || '',
      priority: draft.priority || 'med',
      start: draft.start || draft.due,
      due: draft.due,
      done: false,
      calEventId: null,
      personalSync: null,
      createdAt: Date.now(),
      createdBy: profile?.email || null,
    };
    setTasks((prev) => [optimistic, ...prev]);
    setCloudStatus({ state: 'saving', updatedAt: Date.now(), error: null });
    try {
      const created = await api.tasks.create({
        team_id: teamId,
        title: draft.name,
        description: draft.description || '',
        assignee_email: draft.assignee || '',
        priority: draft.priority || 'med',
        start_date: draft.start || draft.due,
        due_date: draft.due,
      });
      setTasks((prev) => [taskFromApi(created.task), ...prev.filter((task) => task.id !== optimistic.id)]);
      setCloudStatus({ state: 'saved', updatedAt: Date.now(), error: null });
      await logAudit('task_created', { taskName: draft.name, assignee: draft.assignee || null });
    } catch (error) {
      setTasks((prev) => prev.filter((task) => task.id !== optimistic.id));
      setCloudStatus({ state: 'error', updatedAt: Date.now(), error: error.message || 'Save failed' });
    }
  }, [logAudit, profile?.email, teamId]);

  const updateTask = useCallback(async (taskId, patch) => {
    const previous = tasks.find((task) => task.id === taskId);
    if (!previous) return;
    const nextTask = { ...previous, ...patch };
    setTasks((prev) => prev.map((task) => task.id === taskId ? nextTask : task));
    setCloudStatus({ state: 'saving', updatedAt: Date.now(), error: null });
    try {
      await persistTaskPatch(taskId, patch);
      setCloudStatus({ state: 'saved', updatedAt: Date.now(), error: null });
    } catch (error) {
      setTasks((prev) => prev.map((task) => task.id === taskId ? previous : task));
      setCloudStatus({ state: 'error', updatedAt: Date.now(), error: error.message || 'Save failed' });
    }
  }, [persistTaskPatch, tasks]);

  const removeTask = useCallback(async (taskId) => {
    const previous = tasks;
    const deleted = tasks.find((task) => task.id === taskId);
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
    setCloudStatus({ state: 'saving', updatedAt: Date.now(), error: null });
    try {
      await api.tasks.remove(taskId);
      setCloudStatus({ state: 'saved', updatedAt: Date.now(), error: null });
      await logAudit('task_deleted', { taskId, taskName: deleted?.name || null });
    } catch (error) {
      setTasks(previous);
      setCloudStatus({ state: 'error', updatedAt: Date.now(), error: error.message || 'Delete failed' });
    }
  }, [logAudit, tasks]);

  const reassign = useCallback((taskId, assignee) => updateTask(taskId, { assignee }), [updateTask]);

  const onTaskCompleted = useCallback((fn) => {
    automationsRef.current.add(fn);
    return () => automationsRef.current.delete(fn);
  }, []);

  const completeTask = useCallback((taskId) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task || task.done) return { ok: true, alreadyDone: true };
    updateTask(taskId, { done: true });
    setAnalytics((prev) => [...prev, { type: 'task_completed', taskId, at: Date.now() }].slice(-1000));
    saveSetting(SETTINGS_KEYS.analytics, [...analytics, { type: 'task_completed', taskId, at: Date.now() }].slice(-1000)).catch(() => {});
    logAudit('task_completed', { taskId, name: task.name }).catch(() => {});
    automationsRef.current.forEach((fn) => Promise.resolve().then(() => fn({ ...task, done: true })).catch(() => {}));
    return { ok: true, task: { ...task, done: true } };
  }, [analytics, logAudit, saveSetting, tasks, updateTask]);

  const uncompleteTask = useCallback((taskId) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task || !task.done) return { ok: true, alreadyOpen: true };
    updateTask(taskId, { done: false });
    logAudit('task_uncompleted', { taskId, name: task.name }).catch(() => {});
    return { ok: true };
  }, [logAudit, tasks, updateTask]);

  const toggleTask = useCallback((taskId) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) return;
    if (task.done) uncompleteTask(taskId);
    else completeTask(taskId);
  }, [completeTask, tasks, uncompleteTask]);

  const rescheduleTask = useCallback(async (taskId, patchInput, opts = {}) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) return { ok: false, error: 'Task not found' };
    const patch = {
      ...(patchInput.name !== undefined ? { name: patchInput.name.trim() } : {}),
      ...(patchInput.priority !== undefined ? { priority: patchInput.priority } : {}),
      ...(patchInput.start !== undefined ? { start: patchInput.start } : {}),
      ...(patchInput.due !== undefined ? { due: patchInput.due } : {}),
    };
    const next = { ...task, ...patch };
    if (!next.start || !next.due || next.start > next.due) {
      return { ok: false, error: 'End date must be on or after start date.' };
    }

    setTasks((prev) => prev.map((entry) => entry.id === taskId ? next : entry));
    setSyncFor(taskId, { state: 'saving', error: null });
    setCloudStatus({ state: 'saving', updatedAt: Date.now(), error: null });

    try {
      await persistTaskPatch(taskId, patch);
      await logAudit('task_rescheduled', { taskId, start: next.start, due: next.due });

      if (opts.memberEmail) {
        const member = team.find((entry) => entry.email === next.assignee);
        const body = buildEventBodyFromTask(next, member);
        const currentSync = next.personalSync?.[opts.memberEmail];
        setSyncFor(taskId, { state: 'syncing', error: null });

        if (currentSync?.eventId) {
          await updateEvent('primary', currentSync.eventId, body);
        } else if (next.assignee === opts.memberEmail && !next.done) {
          const created = await createEvent('primary', body);
          const updatedPersonal = {
            ...(next.personalSync || {}),
            [opts.memberEmail]: { eventId: created.id, syncedAt: Date.now(), snapshot: snapshotOf(next) },
          };
          next.personalSync = updatedPersonal;
          setTasks((prev) => prev.map((entry) => entry.id === taskId ? { ...next } : entry));
          await api.tasks.setPersonalSync(taskId, {
            member_email: opts.memberEmail,
            event_id: created.id,
            snapshot_json: JSON.stringify(snapshotOf(next)),
          });
        }
        setSyncFor(taskId, { state: 'synced', error: null });
      }

      setCloudStatus({ state: 'saved', updatedAt: Date.now(), error: null });
      if (!opts.memberEmail) setSyncFor(taskId, { state: 'saved', error: null });
      return { ok: true };
    } catch (error) {
      setTasks((prev) => prev.map((entry) => entry.id === taskId ? task : entry));
      setSyncFor(taskId, { state: 'failed', error: error.message || 'Save failed' });
      setCloudStatus({ state: 'error', updatedAt: Date.now(), error: error.message || 'Save failed' });
      return { ok: false, error: error.message || 'Save failed' };
    }
  }, [logAudit, persistTaskPatch, setSyncFor, tasks, team]);

  const retryTaskSync = useCallback(async (taskId, memberEmail) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task || !memberEmail) return { ok: false };
    const member = team.find((entry) => entry.email === task.assignee);
    const body = buildEventBodyFromTask(task, member);
    setSyncFor(taskId, { state: 'syncing', error: null });
    try {
      const existing = task.personalSync?.[memberEmail];
      let eventId = existing?.eventId;
      if (eventId) await updateEvent('primary', eventId, body);
      else eventId = (await createEvent('primary', body)).id;
      await api.tasks.setPersonalSync(taskId, {
        member_email: memberEmail,
        event_id: eventId,
        snapshot_json: JSON.stringify(snapshotOf(task)),
      });
      setTasks((prev) => prev.map((entry) => (
        entry.id === taskId
          ? { ...entry, personalSync: { ...(entry.personalSync || {}), [memberEmail]: { eventId, syncedAt: Date.now(), snapshot: snapshotOf(task) } } }
          : entry
      )));
      setSyncFor(taskId, { state: 'synced', error: null });
      return { ok: true };
    } catch (error) {
      setSyncFor(taskId, { state: 'failed', error: error.message || 'Sync failed' });
      return { ok: false, error: error.message || 'Sync failed' };
    }
  }, [setSyncFor, tasks, team]);

  const addMember = useCallback(async (member) => {
    if (!teamId) return { ok: false, error: 'Workspace not ready' };
    const email = (member.email || '').trim();
    if (!isValidEmail(email)) return { ok: false, error: 'Invalid email format' };
    if (team.some((entry) => entry.email === email)) return { ok: false, error: 'Email already in team' };
    setTeam((prev) => [...prev, { email, name: member.name || email, role: member.role || 'Team member', googleSub: null, googleEmail: null, googleStatus: 'not_connected' }]);
    try {
      await api.members.create(teamId, { email, name: member.name || email, role: member.role || 'Team member' });
      await logAudit('member_added', { email, name: member.name || email, role: member.role || 'Team member' });
      return { ok: true };
    } catch (error) {
      await loadWorkspace(teamId, { quiet: true });
      return { ok: false, error: error.message || 'Could not add member' };
    }
  }, [loadWorkspace, logAudit, team, teamId]);

  const updateMember = useCallback(async (email, patch) => {
    if (!teamId) return;
    const { email: _ignored, ...safePatch } = patch || {};
    setTeam((prev) => prev.map((entry) => entry.email === email ? { ...entry, ...safePatch } : entry));
    try {
      await api.members.update(teamId, email, {
        name: safePatch.name,
        role: safePatch.role,
        google_email: safePatch.googleEmail,
        google_sub: safePatch.googleSub,
        google_status: safePatch.googleStatus,
      });
    } catch {
      await loadWorkspace(teamId, { quiet: true });
    }
  }, [loadWorkspace, teamId]);

  const renameMember = useCallback(async (oldEmail, newEmailRaw, extraPatch = {}) => {
    const newEmail = (newEmailRaw || '').trim();
    if (!isValidEmail(newEmail)) return { ok: false, error: 'Invalid email format' };
    if (oldEmail !== newEmail && team.some((entry) => entry.email === newEmail)) return { ok: false, error: 'Email already in team' };
    try {
      await api.members.update(teamId, oldEmail, {
        email: newEmail,
        name: extraPatch.name,
        role: extraPatch.role,
      });
      await loadWorkspace(teamId, { quiet: true });
      if (oldEmail !== newEmail) await logAudit('email_changed', { oldEmail, newEmail });
      return { ok: true, changed: oldEmail !== newEmail };
    } catch (error) {
      return { ok: false, error: error.message || 'Update failed' };
    }
  }, [loadWorkspace, logAudit, team, teamId]);

  const removeMember = useCallback(async (email, reassignTo) => {
    if (!teamId) return;
    try {
      await api.members.remove(teamId, email, { reassignTo });
      await loadWorkspace(teamId, { quiet: true });
      await logAudit('member_removed', { email, reassignedTo: reassignTo || null });
    } catch {
      await loadWorkspace(teamId, { quiet: true });
    }
  }, [loadWorkspace, logAudit, teamId]);

  const connectMemberGoogle = useCallback((memberEmail, googleProfile) => {
    updateMember(memberEmail, {
      googleEmail: googleProfile.email,
      googleSub: googleProfile.sub,
      googleStatus: 'connected',
    });
    logAudit('google_connected', { memberEmail, googleEmail: googleProfile.email, googleSub: googleProfile.sub }).catch(() => {});
    return { ok: true };
  }, [logAudit, updateMember]);

  const disconnectMemberGoogle = useCallback((memberEmail) => {
    updateMember(memberEmail, { googleEmail: null, googleSub: null, googleStatus: 'not_connected' });
    logAudit('google_disconnected', { memberEmail }).catch(() => {});
  }, [logAudit, updateMember]);

  const markMemberGoogleError = useCallback((memberEmail, errorMessage) => {
    updateMember(memberEmail, { googleStatus: 'error' });
    logAudit('google_error', { memberEmail, message: errorMessage }).catch(() => {});
  }, [logAudit, updateMember]);

  const bulkSyncToGoogle = useCallback(async ({ onProgress = () => {} } = {}) => {
    const targets = tasks.filter((task) => !task.done && task.due && !task.calEventId);
    const errors = [];
    let synced = 0;
    for (let index = 0; index < targets.length; index += 1) {
      const task = targets[index];
      try {
        const member = team.find((entry) => entry.email === task.assignee);
        const event = await createEvent('primary', buildEventBodyFromTask(task, member));
        await persistTaskPatch(task.id, { calEventId: event.id });
        setTasks((prev) => prev.map((entry) => entry.id === task.id ? { ...entry, calEventId: event.id } : entry));
        synced += 1;
      } catch (error) {
        errors.push({ taskId: task.id, message: error.message || 'Sync failed' });
      }
      onProgress({ done: index + 1, total: targets.length });
    }
    return { synced, skipped: tasks.length - targets.length, failed: errors.length, errors };
  }, [persistTaskPatch, tasks, team]);

  const bulkUnsyncFromGoogle = useCallback(async ({ onProgress = () => {} } = {}) => {
    const targets = tasks.filter((task) => task.calEventId);
    const errors = [];
    let unsynced = 0;
    for (let index = 0; index < targets.length; index += 1) {
      const task = targets[index];
      try {
        await deleteEvent('primary', task.calEventId).catch((error) => {
          if (error?.status !== 404) throw error;
        });
        await persistTaskPatch(task.id, { calEventId: null });
        setTasks((prev) => prev.map((entry) => entry.id === task.id ? { ...entry, calEventId: null } : entry));
        unsynced += 1;
      } catch (error) {
        errors.push({ taskId: task.id, message: error.message || 'Unsync failed' });
      }
      onProgress({ done: index + 1, total: targets.length });
    }
    return { unsynced, failed: errors.length, errors };
  }, [persistTaskPatch, tasks]);

  const bulkSyncMyTasksToGoogle = useCallback(async ({ memberEmail, onProgress = () => {} } = {}) => {
    if (!memberEmail) return { synced: 0, deleted: 0, updated: 0, failed: 0, errors: [] };
    const mine = tasks.filter((task) => task.assignee === memberEmail && !task.done && task.due);
    const orphaned = tasks.filter((task) => task.personalSync?.[memberEmail]?.eventId && (task.assignee !== memberEmail || task.done));
    const total = mine.length + orphaned.length;
    const errors = [];
    let synced = 0;
    let updated = 0;
    let deleted = 0;
    let doneCount = 0;

    for (const task of orphaned) {
      try {
        await deleteEvent('primary', task.personalSync[memberEmail].eventId).catch((error) => {
          if (error?.status !== 404) throw error;
        });
        await api.tasks.clearPersonalSync(task.id, memberEmail);
        setTasks((prev) => prev.map((entry) => {
          if (entry.id !== task.id) return entry;
          const next = { ...(entry.personalSync || {}) };
          delete next[memberEmail];
          return { ...entry, personalSync: Object.keys(next).length ? next : null };
        }));
        deleted += 1;
      } catch (error) {
        errors.push({ taskId: task.id, message: error.message || 'Unsync failed' });
      }
      doneCount += 1;
      onProgress({ done: doneCount, total });
    }

    for (const task of mine) {
      try {
        const member = team.find((entry) => entry.email === task.assignee);
        const body = buildEventBodyFromTask(task, member);
        const existing = task.personalSync?.[memberEmail];
        const eventId = existing?.eventId
          ? (await updateEvent('primary', existing.eventId, body).then(() => existing.eventId))
          : (await createEvent('primary', body)).id;
        await api.tasks.setPersonalSync(task.id, {
          member_email: memberEmail,
          event_id: eventId,
          snapshot_json: JSON.stringify(snapshotOf(task)),
        });
        setTasks((prev) => prev.map((entry) => (
          entry.id === task.id
            ? { ...entry, personalSync: { ...(entry.personalSync || {}), [memberEmail]: { eventId, syncedAt: Date.now(), snapshot: snapshotOf(task) } } }
            : entry
        )));
        if (existing?.eventId) updated += 1;
        else synced += 1;
      } catch (error) {
        errors.push({ taskId: task.id, message: error.message || 'Sync failed' });
      }
      doneCount += 1;
      onProgress({ done: doneCount, total });
    }

    const nextSyncStatus = {
      ...syncStatus,
      [memberEmail]: {
        lastSyncedAt: Date.now(),
        count: mine.length,
        errors,
        lastOp: errors.length ? 'partial' : 'ok',
      },
    };
    setSyncStatus(nextSyncStatus);
    saveSetting(SETTINGS_KEYS.sync, nextSyncStatus).catch(() => {});

    return { synced, deleted, updated, failed: errors.length, errors };
  }, [saveSetting, syncStatus, tasks, team]);

  const bulkUnsyncMyTasksFromGoogle = useCallback(async ({ memberEmail, onProgress = () => {} } = {}) => {
    if (!memberEmail) return { unsynced: 0, failed: 0, errors: [] };
    const targets = tasks.filter((task) => task.personalSync?.[memberEmail]?.eventId);
    const errors = [];
    let unsynced = 0;
    for (let index = 0; index < targets.length; index += 1) {
      const task = targets[index];
      try {
        await deleteEvent('primary', task.personalSync[memberEmail].eventId).catch((error) => {
          if (error?.status !== 404) throw error;
        });
        await api.tasks.clearPersonalSync(task.id, memberEmail);
        setTasks((prev) => prev.map((entry) => {
          if (entry.id !== task.id) return entry;
          const next = { ...(entry.personalSync || {}) };
          delete next[memberEmail];
          return { ...entry, personalSync: Object.keys(next).length ? next : null };
        }));
        unsynced += 1;
      } catch (error) {
        errors.push({ taskId: task.id, message: error.message || 'Unsync failed' });
      }
      onProgress({ done: index + 1, total: targets.length });
    }
    return { unsynced, failed: errors.length, errors };
  }, [tasks]);

  const clearSyncMarkers = useCallback(() => {
    tasks.filter((task) => task.calEventId).forEach((task) => updateTask(task.id, { calEventId: null }));
  }, [tasks, updateTask]);

  const exportSnapshot = useCallback(() => ({
    kind: 'command-dashboard-snapshot',
    version: 3,
    exportedAt: new Date().toISOString(),
    origin: typeof window !== 'undefined' ? window.location.origin : 'command-dashboard',
    data: { tasks, team, auditLog, analytics, syncStatus },
  }), [analytics, auditLog, syncStatus, tasks, team]);

  const downloadSnapshot = useCallback(() => {
    const snapshot = exportSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `command-dashboard-snapshot-${snapshot.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return snapshot;
  }, [exportSnapshot]);

  const importSnapshot = useCallback((snapshot, { reload = true } = {}) => {
    if (!snapshot?.data || !teamId) return { ok: false, error: 'Snapshot missing data block.' };
    (async () => {
      const currentTasks = [...tasks];
      const currentTeam = [...team];
      for (const task of currentTasks) await api.tasks.remove(task.id).catch(() => {});
      for (const member of currentTeam) await api.members.remove(teamId, member.email, {}).catch(() => {});
      for (const member of snapshot.data.team || []) {
        await api.members.create(teamId, { email: member.email, name: member.name, role: member.role || 'Team member' });
        if (member.googleEmail || member.googleSub) {
          await api.members.update(teamId, member.email, {
            google_email: member.googleEmail || null,
            google_sub: member.googleSub || null,
            google_status: member.googleStatus || 'connected',
          });
        }
      }
      for (const task of snapshot.data.tasks || []) {
        await api.tasks.create({
          team_id: teamId,
          title: task.name,
          description: task.description || '',
          assignee_email: task.assignee || '',
          priority: task.priority || 'med',
          start_date: task.start || task.due,
          due_date: task.due,
        });
      }
      await api.settings.put(teamId, SETTINGS_KEYS.analytics, snapshot.data.analytics || []);
      await api.settings.put(teamId, SETTINGS_KEYS.sync, snapshot.data.syncStatus || {});
      await loadWorkspace(teamId);
      if (reload && typeof window !== 'undefined') window.location.reload();
    })().catch(() => {});
    return { ok: true, restored: 5 };
  }, [loadWorkspace, tasks, team, teamId]);

  const resetSeed = useCallback(async () => {
    importSnapshot({
      data: {
        tasks: buildSeedTasks().map((task) => ({ ...task, description: '' })),
        team: SEED_TEAM,
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
    cloudPushNow: () => loadWorkspace(teamId),
    cloudPullNow: () => loadWorkspace(teamId),
    pushTaskUpdate: persistTaskPatch,
    pushTaskDelete: (taskId) => api.tasks.remove(taskId),
    clearSyncMarkers,
  };
}
