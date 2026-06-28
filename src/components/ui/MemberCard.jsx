import { useEffect, useState } from 'react';
import { useTasks } from '../../context/TaskContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { getState as getGisState } from '../../auth/gis.js';
import Avatar from './Avatar.jsx';

const TODAY = new Date().toISOString().slice(0, 10);

export default function MemberCard({ member, onDeploy }) {
  const {
    tasks, team, isValidEmail,
    renameMember, removeMember,
    connectMemberGoogle, disconnectMemberGoogle, markMemberGoogleError,
  } = useTasks();
  const { user, login, profile, configured } = useAuth();
  const { push: toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState({ name: member.name, role: member.role, email: member.email });
  const [draftErr, setDraftErr] = useState(null);
  const [connecting, setConnecting] = useState(false);

  // Live status: stored value can lag real OAuth session. Derive a UI status.
  const liveStatus = (() => {
    if (member.googleStatus === 'error')         return 'error';
    if (!member.googleSub)                       return 'not_connected';
    // Stored connection exists. Active iff current GIS profile sub matches.
    if (profile?.sub && profile.sub === member.googleSub) return 'connected';
    return 'expired';
  })();

  const mine    = tasks.filter(t => t.assignee === member.email);
  const open    = mine.filter(t => !t.done);
  const overdue = open.filter(t => t.due && t.due < TODAY).length;
  const dueSoon = open.filter(t => t.due && t.due >= TODAY && t.due <= addDays(TODAY, 3)).length;
  const done    = mine.filter(t =>  t.done).length;
  const total   = mine.length || 1;
  const pct     = Math.round((done / total) * 100);

  // Workload signal based on team average
  const teamOpen = team.reduce((sum, m) => sum + tasks.filter(t => t.assignee === m.email && !t.done).length, 0);
  const avg = teamOpen / Math.max(1, team.length);
  let workload, workloadChip;
  if (open.length === 0)             { workload = 'idle';     workloadChip = 'chip-neutral'; }
  else if (open.length > avg * 1.4)  { workload = 'high';     workloadChip = 'chip-warn'; }
  else if (open.length < avg * 0.6)  { workload = 'light';    workloadChip = 'chip-info'; }
  else                                { workload = 'balanced'; workloadChip = 'chip-ok'; }
  if (overdue > 0)                    { workload = 'at risk';  workloadChip = 'chip-err'; }

  function startEdit() {
    setDraft({ name: member.name, role: member.role, email: member.email });
    setDraftErr(null);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft({ name: member.name, role: member.role, email: member.email });
    setDraftErr(null);
    setEditing(false);
  }

  function save() {
    const nameTrim  = draft.name.trim();
    const emailTrim = draft.email.trim();
    const roleTrim  = draft.role.trim() || 'Team member';
    if (!nameTrim) { setDraftErr('Name required.'); return; }
    if (!isValidEmail(emailTrim)) { setDraftErr('Invalid email format.'); return; }

    const result = renameMember(member.email, emailTrim, { name: nameTrim, role: roleTrim });
    if (!result.ok) {
      setDraftErr(result.error);
      return;
    }
    if (result.changed) {
      toast({ type: 'success', title: 'Email updated', body: `${member.email} → ${emailTrim}. Tasks reassigned automatically.` });
    } else {
      toast({ type: 'success', title: 'Member updated' });
    }
    setEditing(false);
  }

  function handleRemove() {
    if (!confirm(`Remove ${member.name}? Their ${mine.length} task(s) will be reassigned.`)) return;
    const others = team.filter(m => m.email !== member.email);
    if (others.length === 0) { alert('Cannot remove last team member.'); return; }
    const target = prompt(
      `Reassign ${mine.length} task(s) to which email?\n\n${others.map(m => `${m.email}  (${m.name})`).join('\n')}`,
      others[0].email
    );
    if (!target) return;
    if (!others.some(m => m.email === target)) { alert('Invalid email.'); return; }
    removeMember(member.email, target);
    toast({ type: 'info', title: 'Member removed', body: `Tasks reassigned to ${target}.` });
  }

  async function handleConnectGoogle() {
    if (!configured) {
      toast({ type: 'warn', title: 'OAuth not configured', body: 'Set VITE_GOOGLE_CLIENT_ID first.' });
      return;
    }
    setConnecting(true);
    try {
      await login();
      // Wait briefly for userinfo to populate profile.
      let attempts = 0;
      let p = profile;
      while (!p?.sub && attempts < 20) {
        await new Promise(r => setTimeout(r, 100));
        p = getGisState().profile;
        attempts++;
      }
      if (!p?.sub) {
        markMemberGoogleError(member.email, 'Userinfo not received');
        toast({ type: 'error', title: 'Connection error', body: 'Got token but Google profile did not load.' });
        return;
      }
      // Warn if Google email mismatches member email (informational only — owners often differ).
      const mismatched = p.email && p.email.toLowerCase() !== member.email.toLowerCase();
      const result = connectMemberGoogle(member.email, p);
      if (result.ok) {
        toast({
          type: 'success',
          title: `Google account linked to ${member.name}`,
          body: mismatched
            ? `${p.email} ≠ ${member.email} — linked anyway. Edit member email if needed.`
            : p.email,
        });
      } else {
        toast({ type: 'error', title: 'Connection failed', body: result.error });
      }
    } catch (err) {
      const msg = err?.message || err?.code || 'Sign-in failed';
      markMemberGoogleError(member.email, msg);
      toast({ type: 'error', title: 'Google sign-in failed', body: msg });
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    if (!confirm(`Disconnect Google account from ${member.name}?\n\nThis clears the stored link locally. It does NOT revoke Google's permissions or sign out the current OAuth session.`)) return;
    disconnectMemberGoogle(member.email);
    toast({ type: 'info', title: `Disconnected from ${member.name}` });
  }

  return (
    <div data-member-email={member.email} className="card card-hover relative group">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Avatar seed={member.email} name={member.name} size="lg" />
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-1.5">
              <input
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                placeholder="Name"
                className="input h-7 text-[13px]"
                aria-label="Name"
              />
              <input
                value={draft.email}
                onChange={e => setDraft({ ...draft, email: e.target.value })}
                placeholder="email@domain.com"
                type="email"
                className={`input h-7 text-[12px] font-mono ${draftErr ? '!border-[#EF4444]' : ''}`}
                aria-label="Email"
                aria-invalid={!!draftErr}
              />
              <input
                value={draft.role}
                onChange={e => setDraft({ ...draft, role: e.target.value })}
                placeholder="Role"
                className="input h-7 text-[12px]"
                aria-label="Role"
              />
              {draftErr && <div className="chip chip-err">{draftErr}</div>}
            </div>
          ) : (
            <>
              <div className="text-[14px] font-semibold leading-tight truncate">{member.name}</div>
              <div className="text-[12px] text-ink-dim leading-tight truncate mt-0.5">{member.role}</div>
              <div className="text-[10.5px] text-ink-muted truncate mt-0.5 font-mono">{member.email}</div>
            </>
          )}
        </div>
        {!editing && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <button onClick={startEdit} className="btn btn-ghost btn-sm !h-7 !w-7 !p-0" title="Edit" aria-label="Edit">
              <PencilIcon />
            </button>
            <button onClick={handleRemove} className="btn btn-ghost btn-sm !h-7 !w-7 !p-0 hover:!text-[#FCA5A5]" title="Remove" aria-label="Remove member">
              <TrashIcon />
            </button>
          </div>
        )}
      </div>

      {!editing && (
        <>
          {/* Workload chips */}
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            <span className={`chip ${workloadChip}`}>{workload}</span>
            {overdue > 0 && <span className="chip chip-err">{overdue} overdue</span>}
            {dueSoon > 0 && <span className="chip chip-warn">{dueSoon} this week</span>}
          </div>

          {/* Progress */}
          <div className="mt-3 flex items-center justify-between text-[11px] text-ink-muted">
            <span>{done} done · {open.length} open</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="mt-1.5 h-1 bg-s1 rounded-full overflow-hidden">
            <div className="h-full bg-accent-500 transition-[width] duration-300 ease-sleek" style={{ width: `${pct}%` }} />
          </div>

          {/* Google account block */}
          <GoogleAccountBlock
            member={member}
            liveStatus={liveStatus}
            connecting={connecting}
            onConnect={handleConnectGoogle}
            onDisconnect={handleDisconnect}
          />

          {/* Actions */}
          <div className="mt-3 flex gap-2">
            <button onClick={() => onDeploy(member)} className="btn btn-secondary btn-sm flex-1 justify-center">
              <PlusIcon /> Deploy task
            </button>
          </div>
        </>
      )}

      {editing && (
        <div className="mt-3 flex gap-2">
          <button onClick={save}   className="btn btn-primary btn-sm flex-1">Save</button>
          <button onClick={cancelEdit} className="btn btn-ghost btn-sm flex-1">Cancel</button>
        </div>
      )}
    </div>
  );
}

// ─── Google account UI per member ───────────────────────────────────────────
function GoogleAccountBlock({ member, liveStatus, connecting, onConnect, onDisconnect }) {
  const STATUS = {
    not_connected: { label: 'Not connected',   chip: 'chip-neutral', icon: <DotIcon color="#71717A" /> },
    connected:     { label: 'Connected',       chip: 'chip-ok',      icon: <DotIcon color="#10B981" pulse /> },
    expired:       { label: 'Token expired',   chip: 'chip-warn',    icon: <DotIcon color="#F59E0B" /> },
    error:         { label: 'Connection error',chip: 'chip-err',     icon: <DotIcon color="#EF4444" /> },
  };
  const s = STATUS[liveStatus] || STATUS.not_connected;

  return (
    <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          <GoogleGlyph /> Google
        </div>
        <span className={`chip ${s.chip}`}>{s.icon} {s.label}</span>
      </div>

      {member.googleEmail && (
        <div className="text-[11.5px] text-ink-dim mb-2 font-mono truncate" title={member.googleEmail}>
          {member.googleEmail}
        </div>
      )}

      {member.googleError && liveStatus === 'error' && (
        <div className="text-[10.5px] text-[#FCA5A5] mb-2 line-clamp-2" title={member.googleError}>
          {member.googleError}
        </div>
      )}

      {liveStatus === 'expired' && (
        <div className="text-[10.5px] text-[#FCD34D] mb-2">
          Active OAuth session differs from this account. Reconnect to refresh.
        </div>
      )}

      {liveStatus === 'connected' && (
        <button
          onClick={onDisconnect}
          className="btn btn-ghost btn-sm w-full justify-center text-[#FCA5A5] hover:bg-red-500/10"
        >
          Disconnect
        </button>
      )}
      {liveStatus !== 'connected' && (
        <button
          onClick={onConnect}
          disabled={connecting}
          className="btn btn-secondary btn-sm w-full justify-center"
          title="Opens Google OAuth — the account that signs in gets linked to this member"
        >
          {connecting
            ? <><Spinner /> Connecting…</>
            : <><GoogleGlyph /> {liveStatus === 'not_connected' ? 'Connect Google account' : 'Reconnect'}</>}
        </button>
      )}
    </div>
  );
}

function addDays(iso, n) {
  const d = new Date(iso); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2.5" y1="4.5" x2="13.5" y2="4.5" />
      <path d="M4 4.5V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.5" />
      <path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <line x1="8" y1="3.5" x2="8" y2="12.5" />
      <line x1="3.5" y1="8" x2="12.5" y2="8" />
    </svg>
  );
}
function DotIcon({ color, pulse }) {
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full mr-0.5 ${pulse ? 'animate-pulse' : ''}`}
      style={{ background: color, boxShadow: `0 0 0 3px ${color}22` }}
    />
  );
}
function Spinner() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 animate-spin" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
      <path d="M14 8a6 6 0 0 1-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" className="w-3 h-3 shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.72v2.26h2.9c1.7-1.56 2.69-3.86 2.69-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.46-.8 5.95-2.18l-2.9-2.26c-.8.54-1.83.86-3.05.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.34A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.96 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.06l3-2.34z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.94l3 2.34C4.67 5.16 6.66 3.58 9 3.58z"/>
    </svg>
  );
}
