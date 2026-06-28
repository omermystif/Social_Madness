import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTasks } from '../../context/TaskContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const ACTION_LABEL = {
  task_rescheduled:  'Task edited',
  task_completed:    'Task completed',
  task_uncompleted:  'Task reopened',
  task_deleted:      'Task deleted',
  member_added:      'Member added',
  member_removed:    'Member removed',
  email_changed:     'Member email changed',
  google_connected:  'Google connected',
  google_disconnected: 'Google disconnected',
  personal_sync:     'Personal Google sync',
  personal_unsync:   'Personal Google unsync',
  snapshot_imported: 'Snapshot imported',
  restored_to_point: 'Restored to point',
};

function fmt(ts) {
  return new Date(ts).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
}

function describe(e) {
  switch (e.action) {
    case 'task_rescheduled':  return e.before?.name || e.taskId;
    case 'task_completed':    return e.name || e.taskId;
    case 'task_uncompleted':  return e.name || e.taskId;
    case 'task_deleted':      return e.name || e.taskId;
    case 'member_added':      return `${e.name || e.email}${e.role ? ' · ' + e.role : ''}`;
    case 'member_removed':    return e.email;
    case 'email_changed':     return `${e.oldEmail} → ${e.newEmail}`;
    case 'google_connected':  return `${e.memberEmail} ↔ ${e.googleEmail}`;
    case 'restored_to_point': return `Reverted ${e.reverted}, skipped ${e.skipped}`;
    default: return '';
  }
}

export default function RestorePanel({ onClose }) {
  const { auditLog = [], restoreToPoint } = useTasks();
  const { push: toast } = useToast();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const sorted = useMemo(
    () => [...auditLog].sort((a, b) => b.ts - a.ts),
    [auditLog],
  );

  const filtered = useMemo(() => {
    if (!q.trim()) return sorted;
    const needle = q.toLowerCase();
    return sorted.filter(e =>
      (e.action || '').includes(needle) ||
      (describe(e) || '').toLowerCase().includes(needle) ||
      JSON.stringify(e).toLowerCase().includes(needle),
    );
  }, [sorted, q]);

  async function handleRestore(cutoffTs, summary) {
    if (busy) return;
    if (!confirm(`Restore to state right after:\n\n${summary}\n\nReverses all later changes. A backup is saved first.`)) return;
    setBusy(true);
    const res = restoreToPoint(cutoffTs);
    setBusy(false);
    if (!res?.ok) {
      toast({ type: 'error', title: 'Restore failed', body: res?.error || 'unknown' });
      return;
    }
    toast({
      type: 'success',
      title: `Restored. Reverted ${res.reverted}${res.skipped ? `, skipped ${res.skipped}` : ''}`,
      body: `Backup at ${res.backupKey}`,
    });
    onClose();
  }

  // ─── Fixed-position popup, rendered to document.body via portal ──────────
  // Inline styles only — no flex/grid layout tricks that can collapse.
  const overlay = {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: 'rgba(0,0,0,0.65)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'block',
  };
  const panel = {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(92vw, 720px)',
    height: 'min(88vh, 720px)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
    color: 'var(--ink)',
    overflow: 'hidden',
    display: 'grid',
    gridTemplateRows: 'auto auto 1fr auto',
  };

  return createPortal(
    <div style={overlay} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Restore to a point in time">
      <div style={panel} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Restore to a point in time</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>
              {auditLog.length} audit entries · pick one and every later change will be reversed
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ height: 28, width: 28, padding: 0 }} aria-label="Close">✕</button>
        </div>

        {/* Search */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)' }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, action, email…  (e.g. ‘angie’)"
            className="input input-lg"
            style={{ width: '100%' }}
          />
        </div>

        {/* Scrollable list */}
        <div style={{ overflowY: 'auto', padding: '8px 8px' }}>
          {filtered.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', padding: '48px 0', textAlign: 'center' }}>No matching entries.</div>
          )}
          {filtered.map((e, i) => {
            const label = ACTION_LABEL[e.action] || e.action;
            const desc  = describe(e);
            return (
              <div
                key={`${e.ts}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 6,
                  marginBottom: 2,
                }}
                onMouseEnter={(ev) => { ev.currentTarget.style.background = 'var(--surface-1)'; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ fontSize: 10.5, color: 'var(--ink-muted)', fontVariantNumeric: 'tabular-nums', width: 180, flexShrink: 0 }}>
                  {fmt(e.ts)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                  {desc && <div style={{ fontSize: 10.5, color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{desc}</div>}
                </div>
                <button
                  onClick={() => handleRestore(e.ts, `${label} — ${desc} (${fmt(e.ts)})`)}
                  disabled={busy}
                  className="btn btn-secondary btn-sm"
                  style={{ flexShrink: 0 }}
                  title="Reverse every audit entry after this one"
                >
                  Restore here
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-muted)' }}>
          <span>Backups saved as <code style={{ color: 'var(--ink-dim)' }}>dashboard_tasks__backup_&lt;ts&gt;</code></span>
          <button onClick={onClose} className="btn btn-ghost btn-sm">Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
