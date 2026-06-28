import { useEffect, useMemo, useState } from 'react';
import { Backdrop, Field } from './DeployModal.jsx';
import { useTasks, resolveCurrentMember } from '../../context/TaskContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { PRIORITY_OPTIONS } from '../../lib/priorityColors.js';
import { CATEGORIES, CAT_COLORS, CAT_LABELS, categoryOf } from '../../lib/categoryColors.js';

export default function TaskEditModal({ taskId, onClose }) {
  const { tasks, team, rescheduleTask, reassign, deleteTaskWithCleanup } = useTasks();
  const { profile } = useAuth();
  const { push: toast } = useToast();

  const task = useMemo(() => tasks.find(t => t.id === taskId), [tasks, taskId]);
  const currentMember = useMemo(() => resolveCurrentMember(team, profile), [team, profile]);

  const [name, setName] = useState(task?.name || '');
  const [start, setStart] = useState(task?.start || task?.due || '');
  const [due, setDue] = useState(task?.due || '');
  const [priority, setPriority] = useState(task?.priority || 'med');
  const [assignee, setAssignee] = useState(task?.assignee || '');
  const [category, setCategory] = useState(task?.category || categoryOf(task) || '');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!task) return null;

  const duration = (() => {
    if (!start || !due) return 0;
    return Math.max(0, Math.round((new Date(due) - new Date(start)) / 86400000) + 1);
  })();

  function setDuration(days) {
    const n = Math.max(1, Number(days) || 1);
    if (!start) return;
    const newDue = new Date(start);
    newDue.setDate(newDue.getDate() + (n - 1));
    setDue(newDue.toISOString().slice(0, 10));
  }

  async function handleDelete() {
    if (!task) return;
    setDeleting(true);
    const result = await deleteTaskWithCleanup(task.id);
    setDeleting(false);
    if (!result.ok) {
      setErr(result.error || 'Delete failed');
      setConfirmDelete(false);
      return;
    }
    const msg = result.removedEvents > 0
      ? `Removed task + ${result.removedEvents} linked event${result.removedEvents === 1 ? '' : 's'}`
      : 'Task deleted';
    toast({ type: 'success', title: msg, body: truncate(task.name, 60) });
    if (result.failedEvents?.length > 0) {
      toast({ type: 'warn', title: 'Calendar cleanup partial', body: `${result.failedEvents.length} event(s) could not be removed from Google Calendar.` });
    }
    onClose();
  }

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) { setErr('Task name required.'); return; }
    if (!start || !due) { setErr('Both start and due dates required.'); return; }
    if (start > due) { setErr('End date must be on or after start date.'); return; }

    setBusy(true);

    // Reassign first if changed — that's a separate dispatch path.
    if (assignee && assignee !== task.assignee) reassign(task.id, assignee);

    const result = await rescheduleTask(
      task.id,
      { name: name.trim(), start, due, priority, category: category || null },
      { memberEmail: currentMember?.email },
    );
    setBusy(false);

    if (!result.ok) {
      setErr(result.error || 'Failed to save.');
      return;
    }
    if (!result.noop) {
      toast({ type: 'success', title: 'Task updated', body: truncate(name, 60) });
    }
    onClose();
  }

  return (
    <Backdrop onClose={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="surface w-full max-w-lg animate-scale-in relative overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--line)' }}>
          <div>
            <div className="text-[13.5px] font-semibold">Edit task</div>
            <div className="text-[11.5px] text-ink-muted truncate max-w-[400px]">{task.name}</div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm !h-7 !w-7 !p-0" aria-label="Close">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <Field label="Name" htmlFor="te-name">
            <input id="te-name" autoFocus value={name} onChange={e => setName(e.target.value)} className="input input-lg" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" htmlFor="te-start">
              <input id="te-start" type="date" value={start} onChange={e => setStart(e.target.value)} className="input" />
            </Field>
            <Field label="Due date" htmlFor="te-due">
              <input id="te-due" type="date" value={due} onChange={e => setDue(e.target.value)} className="input" max={undefined} min={start || undefined} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`Duration · ${duration} day${duration === 1 ? '' : 's'}`} htmlFor="te-duration">
              <input id="te-duration" type="number" min="1" value={duration || 1} onChange={e => setDuration(e.target.value)} className="input" />
            </Field>
            <Field label="Priority" htmlFor="te-priority">
              <PrioritySelect value={priority} onChange={setPriority} />
            </Field>
          </div>

          <Field label="Assignee" htmlFor="te-assignee">
            <select id="te-assignee" value={assignee} onChange={e => setAssignee(e.target.value)} className="input">
              {team.map(m => <option key={m.email} value={m.email}>{m.name} · {m.role}</option>)}
            </select>
          </Field>

          <Field label="Tag">
            <div className="flex flex-wrap gap-2 mt-1">
              {CATEGORIES.map((cat) => {
                const active = category === cat;
                const color = CAT_COLORS[cat];
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(active ? '' : cat)}
                    className="cat-chip"
                    style={{
                      ['--cat']: color,
                      opacity: active ? 1 : 0.45,
                      boxShadow: active ? `0 0 0 1px ${color}` : 'none',
                    }}
                    aria-pressed={active}
                    title={active ? `Remove ${CAT_LABELS[cat]} tag` : `Tag as ${CAT_LABELS[cat]}`}
                  >
                    <span className="cat-dot" />
                    {CAT_LABELS[cat]}
                  </button>
                );
              })}
            </div>
          </Field>

          {err && <div className="chip chip-err">{err}</div>}

          {task.personalSync?.[currentMember?.email]?.eventId && (
            <div className="text-[11px] text-ink-muted">
              Linked to your Google Calendar event — will auto-sync on save.
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: 'var(--line)' }}>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="btn btn-danger btn-sm"
            disabled={busy || deleting}
            title="Permanently delete this task"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 5 13 5" />
              <path d="M5 5v8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V5" />
              <path d="M6 5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2" />
            </svg>
            Delete task
          </button>
          <div className="flex items-center gap-2">
            <div className="text-[11px] text-ink-muted hidden sm:block">
              <span className="kbd">Esc</span> to cancel
            </div>
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
            <button disabled={busy || deleting} className="btn btn-primary btn-sm">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>

        {confirmDelete && (
          <ConfirmDeleteOverlay
            taskName={task.name}
            hasSyncedEvents={!!task.calEventId || Object.keys(task.personalSync || {}).length > 0}
            busy={deleting}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={handleDelete}
          />
        )}
      </form>
    </Backdrop>
  );
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function PrioritySelect({ value, onChange }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {PRIORITY_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="relative flex items-center justify-center gap-2 py-2 rounded-md text-[12px] font-medium transition-all duration-150 border"
            style={{
              background: active ? `color-mix(in srgb, ${opt.color} 22%, transparent)` : 'var(--surface-1)',
              borderColor: active ? opt.color : 'var(--line)',
              color: active ? opt.color : 'var(--ink-dim)',
              boxShadow: active ? `0 0 0 1px ${opt.color}` : 'none',
            }}
            aria-pressed={active}
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{
                background: opt.color,
                boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${opt.color} 25%, transparent)` : 'none',
              }}
            />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ConfirmDeleteOverlay({ taskName, hasSyncedEvents, busy, onCancel, onConfirm }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel();
      if (e.key === 'Enter' && !busy)  onConfirm();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel, onConfirm]);

  return (
    <div
      className="absolute inset-0 grid place-items-center animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { e.stopPropagation(); if (!busy) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-del-title"
        className="surface w-[88%] max-w-sm animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-9 h-9 rounded-full grid place-items-center" style={{ background: 'rgba(239,68,68,0.14)' }}>
              <svg viewBox="0 0 16 16" className="w-4.5 h-4.5" fill="none" stroke="#EF4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2.5L1.5 13.5h13z" /><line x1="8" y1="6" x2="8" y2="9" /><circle cx="8" cy="11.5" r="0.6" fill="#EF4444" stroke="none" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div id="confirm-del-title" className="text-[14px] font-semibold text-ink">Delete this task?</div>
              <div className="text-[12px] text-ink-muted mt-1 truncate" title={taskName}>{taskName}</div>
            </div>
          </div>
          <div className="text-[12px] text-ink-dim">
            This action cannot be undone.
            {hasSyncedEvents && (
              <span className="block mt-1.5 text-ink-muted">
                Linked Google Calendar event(s) will also be removed.
              </span>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--line)' }}>
          <button type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost btn-sm">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn btn-danger btn-sm" autoFocus>
            {busy ? 'Deleting…' : 'Delete task'}
          </button>
        </div>
      </div>
    </div>
  );
}
