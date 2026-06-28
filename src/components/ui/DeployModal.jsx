import { useEffect, useState } from 'react';
import { useTasks } from '../../context/TaskContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { createTaskEvent } from '../../api/calendarApi.js';
import Avatar from './Avatar.jsx';

export default function DeployModal({ member, onClose }) {
  const { addTask } = useTasks();
  const { user }    = useAuth();

  const [name, setName]         = useState('');
  const [priority, setPriority] = useState('med');
  const [due, setDue]           = useState(new Date().toISOString().slice(0, 10));
  const [syncCal, setSyncCal]   = useState(true);
  const [busy, setBusy]         = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!member) return null;

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);

    let calEventId = null;
    if (syncCal && user) {
      try {
        const ev = await createTaskEvent({
          taskName: name, assigneeEmail: member.email, dueDate: due, durationMinutes: 30,
        });
        calEventId = ev?.id || null;
      } catch (err) { console.error('Calendar sync failed:', err); }
    }

    addTask({ name, assignee: member.email, priority, due, calEventId });
    setBusy(false);
    onClose();
  }

  return (
    <Backdrop onClose={onClose}>
      <form
        onSubmit={submit}
        className="surface w-full max-w-md animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-3">
            <Avatar seed={member.email} name={member.name} size="md" />
            <div>
              <div className="text-[13.5px] font-semibold leading-tight">Deploy to {member.name}</div>
              <div className="text-[11.5px] text-ink-muted leading-tight">{member.role}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm !h-7 !w-7 !p-0" aria-label="Close">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <Field label="Task" htmlFor="dep-name">
            <input
              id="dep-name"
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              className="input input-lg"
              placeholder="e.g. Cut 3 reels from Friday Live"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <select value={priority} onChange={e => setPriority(e.target.value)} className="input">
                <option value="high">High</option>
                <option value="med">Medium</option>
                <option value="low">Low</option>
              </select>
            </Field>
            <Field label="Due">
              <input type="date" value={due} onChange={e => setDue(e.target.value)} className="input" />
            </Field>
          </div>

          <label className="flex items-start gap-2.5 text-[13px] text-ink-dim cursor-pointer">
            <input type="checkbox" checked={syncCal} onChange={e => setSyncCal(e.target.checked)} disabled={!user} className="mt-0.5" />
            <span>
              Block assignee calendar
              {!user && <span className="ml-2 chip chip-warn">connect Google first</span>}
            </span>
          </label>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between text-[11px] text-ink-muted" style={{ borderColor: 'var(--line)' }}>
          <div>
            Press <span className="kbd">Esc</span> to cancel
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
            <button disabled={busy || !name.trim()} className="btn btn-primary btn-sm">
              {busy ? 'Deploying…' : 'Deploy'}
            </button>
          </div>
        </div>
      </form>
    </Backdrop>
  );
}

export function Backdrop({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  );
}

export function Field({ label, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[11px] font-medium text-ink-muted uppercase tracking-[0.04em] mb-1.5">{label}</label>
      {children}
    </div>
  );
}
