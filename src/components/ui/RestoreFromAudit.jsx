/**
 * TEMPORARY restore tool. Floating button bottom-right.
 *
 * Reverses every entry in dashboard_audit_log that's newer than a
 * "marker" entry the user picks (e.g. "member_added angie@mystify.com").
 * Idempotent within a single click. Backs up state before mutating.
 *
 * Remove this file + its mount in App.jsx once recovery is done.
 */
import { useState } from 'react';

const TASKS_KEY = 'dashboard_tasks';
const TEAM_KEY  = 'dashboard_team';
const AUDIT_KEY = 'dashboard_audit_log';

function readJson(k, fallback) {
  try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function backup() {
  const ts = Date.now();
  for (const k of [TASKS_KEY, TEAM_KEY, AUDIT_KEY]) {
    const v = localStorage.getItem(k);
    if (v != null) localStorage.setItem(`${k}__backup_${ts}`, v);
  }
  return ts;
}

function findMarkerTs(audit, action, matchFn) {
  // Walk reverse: most recent occurrence wins.
  for (let i = audit.length - 1; i >= 0; i--) {
    const e = audit[i];
    if (e.action === action && matchFn(e)) return e.ts;
  }
  return null;
}

function revert(taskId, tasks, byId, e) {
  const t = byId[taskId];
  if (!t) return false;
  if (e.action === 'task_rescheduled' && e.before) {
    Object.assign(t, e.before);
    return true;
  }
  if (e.action === 'task_completed') {
    t.done = false; t.completedAt = null; t.completedBy = null;
    return true;
  }
  if (e.action === 'task_uncompleted') {
    t.done = true;
    return true;
  }
  return false;
}

export default function RestoreFromAudit() {
  const [open, setOpen] = useState(false);
  const [log, setLog]   = useState([]);

  function pushLog(line) { setLog((prev) => [...prev, line]); }

  function run({ action, email, name }) {
    setLog([]);
    const audit = readJson(AUDIT_KEY, []);
    const tasks = readJson(TASKS_KEY, []);
    const team  = readJson(TEAM_KEY, []);
    if (!audit.length) { pushLog('No audit log found. Nothing to restore.'); return; }

    const matchFn = (e) => {
      const d = e.details || e;
      return (email && (d.email === email || d.memberEmail === email))
          || (name && d.name === name);
    };
    const cutoff = findMarkerTs(audit, action, matchFn);
    if (cutoff == null) {
      pushLog(`No "${action}" entry found matching email=${email || '-'} name=${name || '-'}.`);
      // Show recent member_added events to help user pick
      const recent = audit
        .filter((e) => e.action === action)
        .slice(-5)
        .map((e) => `  ${new Date(e.ts).toLocaleString()} → ${JSON.stringify(e.details || {})}`);
      if (recent.length) {
        pushLog(`Recent "${action}" entries:`);
        recent.forEach(pushLog);
      }
      return;
    }
    pushLog(`Cutoff timestamp: ${new Date(cutoff).toLocaleString()} (ts=${cutoff})`);

    const backupTs = backup();
    pushLog(`Backup written: localStorage keys with suffix __backup_${backupTs}`);

    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    const newer = audit.filter((e) => e.ts > cutoff).sort((a, b) => b.ts - a.ts);
    let reverted = 0, skipped = 0;

    // Mutable copies
    const teamMut = [...team];
    const teamIdx = (em) => teamMut.findIndex((m) => m.email === em);

    for (const e of newer) {
      if (e.action === 'member_added') {
        const em = e.details?.email || e.email;
        const i = teamIdx(em);
        if (i >= 0) { teamMut.splice(i, 1); reverted++; } else skipped++;
        continue;
      }
      if (e.action === 'member_removed' && (e.details?.email || e.email)) {
        const em = e.details?.email || e.email;
        const m = e.details?.member || null;
        if (m && teamIdx(em) < 0) { teamMut.push(m); reverted++; } else skipped++;
        continue;
      }
      if (e.action === 'member_renamed' || e.action === 'member_updated') {
        const em = e.details?.email || e.email;
        const i = teamIdx(em);
        if (i >= 0 && e.before) { teamMut[i] = { ...teamMut[i], ...e.before }; reverted++; } else skipped++;
        continue;
      }
      if (revert(e.taskId, tasks, byId, e)) { reverted++; continue; }
      skipped++;
    }

    localStorage.setItem(TASKS_KEY, JSON.stringify(Object.values(byId)));
    localStorage.setItem(TEAM_KEY,  JSON.stringify(teamMut));

    pushLog(`Reverted ${reverted}, skipped ${skipped}. Reloading in 2s…`);
    setTimeout(() => window.location.reload(), 2000);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="btn btn-danger btn-sm shadow-e3"
          title="Restore tasks/team from audit log"
        >
          ↺ Restore
        </button>
      )}
      {open && (
        <div className="surface p-4 max-w-md w-[420px] shadow-e4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13.5px] font-semibold">Restore from audit log</div>
            <button onClick={() => setOpen(false)} className="btn btn-ghost btn-sm !h-7 !w-7 !p-0">✕</button>
          </div>
          <div className="text-[11.5px] text-ink-muted mb-3">
            Reverts every change after the chosen marker. Backs up current state first.
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => run({ action: 'member_added', email: 'angie@mystify.com' })}
              className="btn btn-secondary btn-sm justify-start"
            >
              ↺ Restore to: angie@mystify.com added
            </button>
            <button
              onClick={() => run({ action: 'member_added', email: prompt('Restore to which member email?') || '' })}
              className="btn btn-ghost btn-sm justify-start"
            >
              ↺ Restore to: another member_added…
            </button>
          </div>
          {log.length > 0 && (
            <pre className="mt-3 p-2 surface-1 text-[10.5px] max-h-48 overflow-y-auto whitespace-pre-wrap">
              {log.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
