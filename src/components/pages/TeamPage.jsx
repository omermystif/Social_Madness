import { useState } from 'react';
import MemberCard from '../ui/MemberCard.jsx';
import DeployModal, { Backdrop, Field } from '../ui/DeployModal.jsx';
import { useTasks } from '../../context/TaskContext.jsx';

export default function TeamPage() {
  const { team, tasks, addMember, auditLog } = useTasks();
  const [deployTo, setDeployTo] = useState(null);
  const [showAdd,  setShowAdd]  = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  const totals = {
    open:    tasks.filter(t => !t.done).length,
    done:    tasks.filter(t =>  t.done).length,
    overdue: tasks.filter(t => !t.done && t.due < new Date().toISOString().slice(0, 10)).length,
  };
  const connectedCount = team.filter(m => m.googleSub).length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-page text-ink">Team &amp; deployment</h1>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {team.length} member{team.length === 1 ? '' : 's'} · {connectedCount} Google-linked · {totals.open} open ·{' '}
            {totals.overdue > 0 ? `${totals.overdue} overdue` : 'on track'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAudit(true)} className="btn btn-ghost btn-sm" title="View audit log">
            Audit log ({auditLog.length})
          </button>
          <button onClick={() => setShowAdd(true)} className="btn btn-primary btn-sm">
            <span className="text-[14px] leading-none">+</span> Add member
          </button>
        </div>
      </div>

      {team.length === 0 ? (
        <div className="card text-[12.5px] text-ink-muted py-16 text-center">
          No team members yet. Add one to begin.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {team.map(m => (
            <MemberCard key={m.email} member={m} onDeploy={setDeployTo} />
          ))}
        </div>
      )}

      {deployTo && <DeployModal member={deployTo} onClose={() => setDeployTo(null)} />}
      {showAdd  && <AddMemberModal onClose={() => setShowAdd(false)} onAdd={addMember} />}
      {showAudit && <AuditLogModal entries={auditLog} onClose={() => setShowAudit(false)} />}
    </div>
  );
}

function AddMemberModal({ onClose, onAdd }) {
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole]   = useState('');
  const [err, setErr]     = useState(null);

  function submit(e) {
    e.preventDefault();
    const result = onAdd({ name: name.trim() || email, email: email.trim(), role: role.trim() });
    if (!result || result.ok === false) {
      setErr(result?.error || 'Could not add member.');
      return;
    }
    onClose();
  }

  return (
    <Backdrop onClose={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="surface w-full max-w-md animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--line)' }}>
          <div>
            <div className="text-[13.5px] font-semibold">Add team member</div>
            <div className="text-[11.5px] text-ink-muted">Email becomes the permanent identifier</div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm !h-7 !w-7 !p-0">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <Field label="Name" htmlFor="m-name">
            <input id="m-name" autoFocus value={name} onChange={e => setName(e.target.value)} className="input input-lg" placeholder="Janet Reed" />
          </Field>
          <Field label="Email" htmlFor="m-email">
            <input id="m-email" required type="email" value={email} onChange={e => setEmail(e.target.value)} className="input input-lg" placeholder="name@boxmadness.com" />
          </Field>
          <Field label="Role" htmlFor="m-role">
            <input id="m-role" value={role} onChange={e => setRole(e.target.value)} className="input input-lg" placeholder="On-camera host" />
          </Field>
          {err && <div className="chip chip-err">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--line)' }}>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
          <button className="btn btn-primary btn-sm">Add member</button>
        </div>
      </form>
    </Backdrop>
  );
}

const ACTION_LABEL = {
  email_changed:         { label: 'Email changed',         tone: 'info' },
  member_added:          { label: 'Member added',          tone: 'ok' },
  member_removed:        { label: 'Member removed',        tone: 'err' },
  google_connected:      { label: 'Google linked',         tone: 'ok' },
  google_disconnected:   { label: 'Google unlinked',       tone: 'neutral' },
  google_connect_failed: { label: 'Google link failed',    tone: 'err' },
  google_error:          { label: 'Google error',          tone: 'err' },
};

function AuditLogModal({ entries, onClose }) {
  const sorted = [...entries].reverse(); // newest first
  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="surface w-full max-w-2xl animate-scale-in flex flex-col" style={{ maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--line)' }}>
          <div>
            <div className="text-[14px] font-semibold">Audit log</div>
            <div className="text-[11.5px] text-ink-muted">
              {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · newest first
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm !h-7 !w-7 !p-0" aria-label="Close">✕</button>
        </div>
        <div className="flex-1 overflow-auto">
          {sorted.length === 0 ? (
            <div className="text-[12.5px] text-ink-muted py-16 text-center">No audit entries yet.</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-elevated">
                <tr className="text-ink-muted text-left">
                  <th className="px-4 py-2 font-semibold">When</th>
                  <th className="px-4 py-2 font-semibold">Action</th>
                  <th className="px-4 py-2 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((e, i) => {
                  const meta = ACTION_LABEL[e.action] || { label: e.action, tone: 'neutral' };
                  const chipCls = meta.tone === 'ok' ? 'chip-ok' :
                                  meta.tone === 'err' ? 'chip-err' :
                                  meta.tone === 'info' ? 'chip-info' : 'chip-neutral';
                  return (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--line-soft)' }}>
                      <td className="px-4 py-2 text-ink-muted tabular-nums whitespace-nowrap">
                        {new Date(e.ts).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`chip ${chipCls}`}>{meta.label}</span>
                      </td>
                      <td className="px-4 py-2 text-ink-dim font-mono text-[11px]">
                        {formatAuditDetails(e)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-3 border-t flex justify-end shrink-0" style={{ borderColor: 'var(--line)' }}>
          <button onClick={onClose} className="btn btn-ghost btn-sm">Close</button>
        </div>
      </div>
    </Backdrop>
  );
}

function formatAuditDetails(e) {
  switch (e.action) {
    case 'email_changed':       return `${e.oldEmail} → ${e.newEmail}`;
    case 'member_added':        return `${e.email} (${e.name || '—'})`;
    case 'member_removed':      return `${e.email}${e.reassignedTo ? ` → reassigned to ${e.reassignedTo}` : ''}`;
    case 'google_connected':    return `${e.memberEmail} ← ${e.googleEmail}`;
    case 'google_disconnected': return `${e.memberEmail}${e.previousGoogleEmail ? ` (was ${e.previousGoogleEmail})` : ''}`;
    case 'google_error':        return `${e.memberEmail}: ${e.message}`;
    case 'google_connect_failed': return `${e.memberEmail}: ${e.reason}`;
    default:                    return JSON.stringify(e);
  }
}
