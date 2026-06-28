import { useEffect, useMemo, useRef, useState } from 'react';
import TaskRow from '../ui/TaskRow.jsx';
import { useTasks } from '../../context/TaskContext.jsx';
import { useMemberFilter } from '../../lib/memberFilter.js';
import { resolveCurrentMember } from '../../context/TaskContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const FILTERS = [
  { id: 'open', label: 'Open',          k: 'O' },
  { id: 'all',  label: 'All',           k: 'A' },
  { id: 'mine', label: 'Mine',          k: 'M' },
  { id: 'done', label: 'Done',          k: 'D' },
  { id: 'high', label: 'High priority', k: 'H' },
];

const ME = 'you@boxmadness.com';

export default function TasksPage() {
  const {
    tasks, team, addTask, resetSeed,
    bulkSyncToGoogle, bulkUnsyncFromGoogle, clearSyncMarkers,
    bulkSyncMyTasksToGoogle, bulkUnsyncMyTasksFromGoogle, syncStatus,
    downloadSnapshot, importSnapshot,
  } = useTasks();
  const fileInputRef = useRef(null);
  const { user, login, profile } = useAuth();
  const { push: toast } = useToast();
  const [filter, setFilter]               = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all'); // 'all' | 'me' | 'unassigned' | <email>
  const [query, setQuery]                 = useState('');
  const [syncing, setSyncing]             = useState(null); // { done, total, op } | null
  const today = new Date().toISOString().slice(0, 10);

  const currentMember = useMemo(() => resolveCurrentMember(team, profile), [team, profile]);
  const myEmail = currentMember?.email || null;
  const myStatus = myEmail ? (syncStatus?.[myEmail] || null) : null;

  const syncedCount   = tasks.filter(t => t.calEventId).length;
  const eligibleCount = tasks.filter(t => !t.calEventId && !t.done && t.due).length;
  const myEligibleCount = myEmail
    ? tasks.filter(t => t.assignee === myEmail && t.due && !t.done && !t.personalSync?.[myEmail]?.eventId).length
    : 0;
  const myOrphanCount = myEmail
    ? tasks.filter(t => t.personalSync?.[myEmail]?.eventId && t.assignee !== myEmail).length
    : 0;
  const mySyncedCount = myEmail ? tasks.filter(t => t.personalSync?.[myEmail]?.eventId).length : 0;

  async function handleSyncToGoogle() {
    if (!user) { login(); return; }
    if (eligibleCount === 0) {
      toast({ type: 'info', title: 'Nothing to sync', body: 'All open tasks with due dates already have Google events.' });
      return;
    }
    setSyncing({ done: 0, total: eligibleCount, op: 'sync' });
    try {
      const result = await bulkSyncToGoogle({
        onProgress: ({ done, total }) => setSyncing({ done, total, op: 'sync' }),
      });
      if (result.failed === 0) {
        toast({ type: 'success', title: 'Synced to Google', body: `${result.synced} task${result.synced === 1 ? '' : 's'} now visible in primary calendar.` });
      } else {
        toast({ type: 'warn', title: 'Partial sync', body: `${result.synced} synced, ${result.failed} failed. See console for details.` });
        console.error('Sync failures:', result.errors);
      }
    } catch (err) {
      toast({ type: 'error', title: 'Sync failed', body: err.message });
    } finally {
      setSyncing(null);
    }
  }

  async function handleUnsyncFromGoogle() {
    if (!user) { login(); return; }
    if (syncedCount === 0) {
      toast({ type: 'info', title: 'Nothing to unsync', body: 'No tasks are currently synced to Google.' });
      return;
    }
    if (!confirm(`Delete ${syncedCount} event(s) from your Google Calendar and unmark them as synced?\n\nThis is reversible — you can re-sync afterwards.`)) return;
    setSyncing({ done: 0, total: syncedCount, op: 'unsync' });
    try {
      const result = await bulkUnsyncFromGoogle({
        onProgress: ({ done, total }) => setSyncing({ done, total, op: 'unsync' }),
      });
      if (result.failed === 0) {
        toast({ type: 'success', title: 'Unsynced from Google', body: `${result.unsynced} event${result.unsynced === 1 ? '' : 's'} removed from primary calendar.` });
      } else {
        toast({ type: 'warn', title: 'Partial unsync', body: `${result.unsynced} removed, ${result.failed} failed. See console.` });
        console.error('Unsync failures:', result.errors);
      }
    } catch (err) {
      toast({ type: 'error', title: 'Unsync failed', body: err.message });
    } finally {
      setSyncing(null);
    }
  }

  function handleClearMarkers() {
    if (!confirm(`Clear local sync markers for ${syncedCount} task(s)?\n\nThis does NOT delete events from Google Calendar — it just forgets which tasks were synced. You can manually delete the events in Google Calendar if needed.`)) return;
    clearSyncMarkers();
    toast({ type: 'info', title: 'Sync markers cleared', body: 'Next sync will re-create events (may produce duplicates in Google Calendar).' });
  }

  // ─── Backup / Restore ──────────────────────────────────────────────────
  function handleExportSnapshot() {
    try {
      const snap = downloadSnapshot();
      toast({
        type: 'success',
        title: 'Snapshot downloaded',
        body: `${snap.keyCount} key${snap.keyCount === 1 ? '' : 's'} · ${snap.exportedAt.slice(0,16).replace('T',' ')}`,
      });
    } catch (err) {
      toast({ type: 'error', title: 'Export failed', body: err?.message || 'Try again.' });
    }
  }

  function triggerImportFile() {
    fileInputRef.current?.click();
  }

  function handleImportFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast({ type: 'error', title: 'File too large', body: 'Max 10 MB.' }); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const snap = JSON.parse(String(reader.result));
        const summary = [
          `Restore from ${snap.origin || 'unknown origin'}?`,
          `Exported: ${snap.exportedAt || '(unknown)'}`,
          `Keys: ${snap.keyCount ?? Object.keys(snap.data || {}).length}`,
          '',
          'This OVERWRITES your current tasks, team, audit log, and sync state.',
          'Browser will reload after import.',
        ].join('\n');
        if (!confirm(summary)) return;
        const result = importSnapshot(snap, { mode: 'replace', reload: true });
        if (!result.ok) toast({ type: 'error', title: 'Import failed', body: result.error });
        else            toast({ type: 'success', title: 'Snapshot restored', body: `${result.restored} keys · reloading…` });
      } catch (err) {
        toast({ type: 'error', title: 'Import failed', body: 'File is not valid JSON.' });
      }
    };
    reader.onerror = () => toast({ type: 'error', title: 'Read failed', body: reader.error?.message || 'Could not read file.' });
    reader.readAsText(file);
  }

  async function handleSyncMyTasks() {
    if (!user) { login(); return; }
    if (!myEmail) {
      toast({
        type: 'warn',
        title: 'No matching team member',
        body: 'Your Google account isn\'t linked to any team member. Link it from the Team page first.',
      });
      return;
    }
    const totalOps = myEligibleCount + myOrphanCount;
    if (totalOps === 0) {
      toast({ type: 'info', title: 'Up to date', body: `${mySyncedCount} task(s) already synced. Nothing to do.` });
      return;
    }
    setSyncing({ done: 0, total: totalOps, op: 'personal-sync' });
    try {
      const result = await bulkSyncMyTasksToGoogle({
        memberEmail: myEmail,
        onProgress: ({ done, total }) => setSyncing({ done, total, op: 'personal-sync' }),
      });
      const parts = [];
      if (result.synced)  parts.push(`+${result.synced} created`);
      if (result.deleted) parts.push(`−${result.deleted} removed (reassigned)`);
      if (result.updated) parts.push(`${result.updated} updated`);
      if (result.failed === 0) {
        toast({ type: 'success', title: 'My tasks synced', body: parts.join(' · ') || 'No changes.' });
      } else {
        toast({ type: 'warn', title: 'Partial sync', body: `${parts.join(' · ')} · ${result.failed} failed.` });
      }
    } catch (err) {
      toast({ type: 'error', title: 'Sync failed', body: err.message });
    } finally {
      setSyncing(null);
    }
  }

  async function handleUnsyncMyTasks() {
    if (!myEmail) return;
    if (!confirm(`Delete ${mySyncedCount} event(s) from your Google Calendar?\n\nReversible — re-sync afterwards.`)) return;
    setSyncing({ done: 0, total: mySyncedCount, op: 'personal-unsync' });
    try {
      const result = await bulkUnsyncMyTasksFromGoogle({
        memberEmail: myEmail,
        onProgress: ({ done, total }) => setSyncing({ done, total, op: 'personal-unsync' }),
      });
      toast({
        type: result.failed === 0 ? 'success' : 'warn',
        title: 'My tasks unsynced',
        body: `${result.unsynced} removed${result.failed ? ` · ${result.failed} failed` : ''}.`,
      });
    } catch (err) {
      toast({ type: 'error', title: 'Unsync failed', body: err.message });
    } finally {
      setSyncing(null);
    }
  }

  const newRef = useRef(null);
  const [adderOpen, setAdderOpen] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        setAdderOpen(true);
        setTimeout(() => newRef.current?.focus(), 50);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [draft, setDraft] = useState({
    name: '', assignee: team[0]?.email || ME, priority: 'med', start: today, due: today,
  });

  const { selected: selectedMembers, isFiltered: memberFiltered } = useMemberFilter();

  const filtered = useMemo(() => {
    let list = [...tasks];
    // Global Members panel filter (Calendar sidebar) — applies first.
    if (memberFiltered) list = list.filter(t => selectedMembers.has(t.assignee));
    // User filter (combinable with status filter below)
    if (assigneeFilter === 'me' && myEmail)            list = list.filter(t => t.assignee === myEmail);
    else if (assigneeFilter === 'unassigned')          list = list.filter(t => !t.assignee || !team.some(m => m.email === t.assignee));
    else if (assigneeFilter !== 'all' && assigneeFilter !== 'me') list = list.filter(t => t.assignee === assigneeFilter);
    // Status filter
    if (filter === 'mine') list = list.filter(t => t.assignee === (myEmail || ME));
    if (filter === 'open') list = list.filter(t => !t.done);
    if (filter === 'done') list = list.filter(t =>  t.done);
    if (filter === 'high') list = list.filter(t => t.priority === 'high' && !t.done);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(t => t.name.toLowerCase().includes(q) || (t.assignee || '').includes(q));
    }
    return list.sort((a, b) => (a.done - b.done) || a.due.localeCompare(b.due));
  }, [tasks, filter, assigneeFilter, query, myEmail, team, memberFiltered, selectedMembers]);

  // Group by due-date buckets
  const groups = useMemo(() => groupByBucket(filtered, today), [filtered, today]);

  function submit(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    addTask(draft);
    setDraft({ ...draft, name: '' });
    setAdderOpen(false);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-page text-ink">Task management</h1>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {filtered.length} {filter === 'all' ? 'total' : filter}
            {assigneeFilter !== 'all' && ` · filtered by ${assigneeFilter === 'me' ? 'me' : assigneeFilter === 'unassigned' ? 'unassigned' : (team.find(m => m.email === assigneeFilter)?.name || assigneeFilter)}`}
            {' · '}{syncedCount} synced (admin)
            {myEmail && ` · ${mySyncedCount} personal`}
            {' · press '}<span className="kbd">C</span>{' to create'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput value={query} onChange={setQuery} />
          <SyncMyTasksButton
            user={user}
            currentMember={currentMember}
            syncing={syncing}
            mySyncedCount={mySyncedCount}
            myEligibleCount={myEligibleCount}
            myOrphanCount={myOrphanCount}
            myStatus={myStatus}
            onSync={handleSyncMyTasks}
            onUnsync={handleUnsyncMyTasks}
          />
          <SyncToGoogleButton
            user={user}
            syncing={syncing}
            eligibleCount={eligibleCount}
            syncedCount={syncedCount}
            onSync={handleSyncToGoogle}
            onUnsync={handleUnsyncFromGoogle}
            onClearMarkers={handleClearMarkers}
          />
          <button onClick={() => setAdderOpen(v => !v)} className="btn btn-primary btn-sm">+ New task</button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 p-1 surface-1 rounded-lg border border-line">
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-2.5 h-7 rounded-md text-[12px] font-medium transition-colors duration-150 ${
                  filter === f.id ? 'bg-s3 text-ink shadow-e1' : 'text-ink-dim hover:text-ink hover:bg-s2'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <UserFilter
            team={team}
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            myEmail={myEmail}
          />
        </div>
        <div className="flex items-center gap-2">
          <BackupMenu
            onExport={handleExportSnapshot}
            onImport={triggerImportFile}
            taskCount={tasks.length}
          />
          <button
            onClick={() => { if (confirm('Reset to the World Cup campaign seed?')) resetSeed(); }}
            className="btn btn-ghost btn-sm text-ink-muted"
          >
            Reset seed
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFileChange}
          />
        </div>
      </div>

      {/* Inline adder */}
      {adderOpen && (
        <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 animate-slide-up">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[11px] font-medium text-ink-muted uppercase tracking-[0.04em] mb-1.5">Task</label>
            <input
              ref={newRef}
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder="What needs to happen?"
              className="input input-lg"
              onKeyDown={e => { if (e.key === 'Escape') setAdderOpen(false); }}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-muted uppercase tracking-[0.04em] mb-1.5">Assignee</label>
            <select value={draft.assignee} onChange={e => setDraft({ ...draft, assignee: e.target.value })} className="input">
              {team.map(m => <option key={m.email} value={m.email} className="bg-surface">{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-muted uppercase tracking-[0.04em] mb-1.5">Priority</label>
            <select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })} className="input">
              <option value="high">High</option>
              <option value="med">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-muted uppercase tracking-[0.04em] mb-1.5">Due</label>
            <input type="date" value={draft.due} onChange={e => setDraft({ ...draft, due: e.target.value })} className="input" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdderOpen(false)} className="btn btn-ghost btn-sm">Cancel</button>
            <button className="btn btn-primary btn-sm">Add</button>
          </div>
        </form>
      )}

      {/* Grouped list */}
      <div className="space-y-5">
        {groups.length === 0 && (
          <div className="card text-[12.5px] text-ink-muted py-12 text-center">
            No tasks match {filter}.
          </div>
        )}
        {groups.map(g => (
          <section key={g.id} className="card !p-2.5">
            <div className="flex items-center justify-between px-2 py-1.5">
              <div className="text-[12px] font-semibold text-ink uppercase tracking-[0.04em]">{g.label}</div>
              <span className="text-[11px] text-ink-muted tabular-nums">{g.items.length}</span>
            </div>
            <div className="flex flex-col">
              {g.items.map(t => <TaskRow key={t.id} task={t} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function groupByBucket(list, today) {
  const buckets = {
    overdue: { id: 'overdue', label: 'Overdue',     items: [] },
    today:   { id: 'today',   label: 'Today',       items: [] },
    week:    { id: 'week',    label: 'This week',   items: [] },
    later:   { id: 'later',   label: 'Later',       items: [] },
    done:    { id: 'done',    label: 'Completed',   items: [] },
  };
  const end = new Date(today); end.setDate(end.getDate() + 7);
  const endIso = end.toISOString().slice(0, 10);

  list.forEach(t => {
    if (t.done) buckets.done.items.push(t);
    else if (t.due < today)              buckets.overdue.items.push(t);
    else if (t.due === today)            buckets.today.items.push(t);
    else if (t.due <= endIso)            buckets.week.items.push(t);
    else                                  buckets.later.items.push(t);
  });
  return Object.values(buckets).filter(b => b.items.length > 0);
}

function UserFilter({ team, value, onChange, myEmail }) {
  const label =
    value === 'all'        ? 'All users'
  : value === 'me'         ? 'My tasks'
  : value === 'unassigned' ? 'Unassigned'
  : (team.find(m => m.email === value)?.name) || value;

  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="btn btn-secondary btn-sm"
        title="Filter by assignee"
      >
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="6" r="2.5" />
          <path d="M3 13c0-2.5 2.2-4 5-4s5 1.5 5 4" />
        </svg>
        {label}
        <svg viewBox="0 0 16 16" className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[calc(100%+4px)] surface w-56 z-50 py-1 shadow-e2 animate-slide-up max-h-[320px] overflow-y-auto">
            <FilterOption value="all"        active={value === 'all'}        onSelect={() => { onChange('all'); setOpen(false); }}>All users</FilterOption>
            <FilterOption value="me"         active={value === 'me'}         onSelect={() => { onChange('me'); setOpen(false); }} disabled={!myEmail} hint={myEmail ? `(${myEmail})` : 'link Google first'}>My tasks</FilterOption>
            <FilterOption value="unassigned" active={value === 'unassigned'} onSelect={() => { onChange('unassigned'); setOpen(false); }}>Unassigned</FilterOption>
            <div className="border-t my-1" style={{ borderColor: 'var(--line)' }} />
            <div className="label px-3 py-1.5">Members</div>
            {team.map(m => (
              <FilterOption
                key={m.email}
                value={m.email}
                active={value === m.email}
                onSelect={() => { onChange(m.email); setOpen(false); }}
                hint={m.role}
              >
                {m.name}
              </FilterOption>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FilterOption({ children, active, onSelect, disabled, hint }) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-s1 flex items-center justify-between gap-2 disabled:opacity-40 disabled:hover:bg-transparent ${active ? 'bg-s2 text-ink' : 'text-ink-dim'}`}
    >
      <span className="truncate flex items-center gap-2">
        {active && <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />}
        {children}
      </span>
      {hint && <span className="text-[10.5px] text-ink-muted truncate max-w-[120px]">{hint}</span>}
    </button>
  );
}

function BackupMenu({ onExport, onImport, taskCount }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="btn btn-secondary btn-sm"
        title="Export or restore a JSON snapshot of all dashboard data"
      >
        <BackupIcon /> Backup
        <svg viewBox="0 0 16 16" className="w-2.5 h-2.5 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[calc(100%+4px)] surface w-72 z-50 py-1 shadow-e2 animate-slide-up">
            <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-[0.06em] text-ink-muted font-semibold">
              Workspace snapshot · {taskCount} tasks
            </div>
            <button
              onClick={() => { setOpen(false); onExport(); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-s1 flex items-center justify-between"
            >
              <span>Export to JSON</span>
              <span className="text-[10.5px] text-ink-muted">downloads file</span>
            </button>
            <button
              onClick={() => { setOpen(false); onImport(); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-s1 flex items-center justify-between"
            >
              <span>Restore from JSON</span>
              <span className="text-[10.5px] text-ink-muted">file picker</span>
            </button>
            <div className="border-t my-1" style={{ borderColor: 'var(--line)' }} />
            <div className="px-3 py-1.5 text-[11px] text-ink-muted leading-snug">
              Includes tasks, team, audit log, sync state, analytics. <b>Excludes</b> Google access tokens (memory-only).
              <div className="mt-1 text-ink-faint">Use to move data between origins (localhost ↔ production).</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BackupIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="1.2" />
      <line x1="2.5" y1="6.5" x2="13.5" y2="6.5" />
      <line x1="6" y1="9.5" x2="10" y2="9.5" />
    </svg>
  );
}

function SyncMyTasksButton({ user, currentMember, syncing, mySyncedCount, myEligibleCount, myOrphanCount, myStatus, onSync, onUnsync }) {
  const [menuOpen, setMenuOpen] = useState(false);

  if (syncing?.op === 'personal-sync' || syncing?.op === 'personal-unsync') {
    const pct = syncing.total ? Math.round((syncing.done / syncing.total) * 100) : 0;
    const verb = syncing.op === 'personal-unsync' ? 'Unsyncing my tasks' : 'Syncing my tasks';
    return (
      <button disabled className="btn btn-secondary btn-sm relative overflow-hidden" style={{ minWidth: 200 }}>
        <span className="relative z-10">{verb}… {syncing.done}/{syncing.total}</span>
        <span
          className={`absolute inset-y-0 left-0 transition-[width] duration-200 ease-sleek ${syncing.op === 'personal-unsync' ? 'bg-red-500/20' : 'bg-accent-500/30'}`}
          style={{ width: `${pct}%` }}
        />
      </button>
    );
  }

  if (!user || !currentMember) {
    return (
      <button
        onClick={onSync}
        className="btn btn-secondary btn-sm opacity-80"
        title={!user ? 'Connect Google first' : 'Your Google account is not linked to a team member — link it from the Team page'}
      >
        <GoogleGlyph /> Sync My Tasks
      </button>
    );
  }

  const stale = myStatus?.lastSyncedAt
    ? `Last sync ${timeAgo(myStatus.lastSyncedAt)}`
    : 'Never synced';

  const pendingOps = myEligibleCount + myOrphanCount;

  return (
    <div className="relative">
      <div className="flex">
        <button
          onClick={onSync}
          className="btn btn-secondary btn-sm rounded-r-none border-r-0"
          title={`${pendingOps} pending ops (${myEligibleCount} create, ${myOrphanCount} cleanup) · ${stale}`}
        >
          <GoogleGlyph />
          <span className="flex flex-col items-start leading-tight">
            <span>Sync My Tasks ({currentMember.name.split(' ')[0]})</span>
            <span className="text-[10px] text-ink-muted">
              {mySyncedCount} synced · {pendingOps > 0 ? `${pendingOps} pending` : 'up to date'}
            </span>
          </span>
        </button>
        <button
          onClick={() => setMenuOpen(v => !v)}
          className="btn btn-secondary btn-sm rounded-l-none !px-2"
          aria-label="Personal sync options"
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </button>
      </div>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-[calc(100%+4px)] surface w-72 z-50 py-2 shadow-e2 animate-slide-up">
            <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-[0.06em] text-ink-muted font-semibold">Personal sync · {currentMember.email}</div>
            <button
              onClick={() => { setMenuOpen(false); onSync(); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-s1"
              disabled={pendingOps === 0}
            >
              Sync now ({pendingOps} pending)
            </button>
            <button
              onClick={() => { setMenuOpen(false); onUnsync(); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-s1 text-[#FCA5A5]"
              disabled={mySyncedCount === 0}
            >
              Unsync all my events ({mySyncedCount})
            </button>
            <div className="border-t my-1" style={{ borderColor: 'var(--line)' }} />
            <div className="px-3 py-1.5 text-[11px] text-ink-muted">
              {stale}
              {myStatus?.errors?.length > 0 && (
                <div className="text-[#FCA5A5] mt-1">{myStatus.errors.length} error{myStatus.errors.length === 1 ? '' : 's'} last run</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function SyncToGoogleButton({ user, syncing, eligibleCount, syncedCount, onSync, onUnsync, onClearMarkers }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdminOp = syncing && (syncing.op === 'sync' || syncing.op === 'unsync');

  if (isAdminOp) {
    const pct = syncing.total ? Math.round((syncing.done / syncing.total) * 100) : 0;
    const verb = syncing.op === 'unsync' ? 'Unsyncing' : 'Syncing';
    return (
      <button disabled className="btn btn-secondary btn-sm relative overflow-hidden" style={{ minWidth: 160 }}>
        <span className="relative z-10">{verb}… {syncing.done}/{syncing.total}</span>
        <span
          className={`absolute inset-y-0 left-0 transition-[width] duration-200 ease-sleek ${syncing.op === 'unsync' ? 'bg-red-500/20' : 'bg-accent-500/20'}`}
          style={{ width: `${pct}%` }}
        />
      </button>
    );
  }

  if (!user) {
    return (
      <button
        onClick={onSync}
        className="btn btn-secondary btn-sm"
        title="Connect Google first, then sync tasks"
      >
        <GoogleGlyph /> Sync to Google
      </button>
    );
  }

  // Primary action depends on state — if everything synced, primary becomes Unsync.
  const allSynced = eligibleCount === 0 && syncedCount > 0;

  return (
    <div className="relative">
      <div className="flex">
        <button
          onClick={allSynced ? onUnsync : onSync}
          className="btn btn-secondary btn-sm rounded-r-none border-r-0"
          title={
            allSynced
              ? `Remove ${syncedCount} event${syncedCount === 1 ? '' : 's'} from your primary Google Calendar`
              : eligibleCount === 0
                ? 'No tasks to sync'
                : `Push ${eligibleCount} task${eligibleCount === 1 ? '' : 's'} to your primary Google Calendar`
          }
          disabled={!allSynced && eligibleCount === 0}
        >
          <GoogleGlyph />
          {allSynced
            ? `Unsync ${syncedCount} from Google`
            : `Sync ${eligibleCount} to Google`}
        </button>
        <button
          onClick={() => setMenuOpen(v => !v)}
          className="btn btn-secondary btn-sm rounded-l-none !px-2"
          aria-label="More sync options"
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </button>
      </div>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-[calc(100%+4px)] surface w-60 z-50 py-1 shadow-e2 animate-slide-up">
            <button
              onClick={() => { setMenuOpen(false); onSync(); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-s1 disabled:opacity-40 disabled:hover:bg-transparent"
              disabled={eligibleCount === 0}
            >
              Sync {eligibleCount > 0 ? `${eligibleCount} ` : ''}now
            </button>
            <button
              onClick={() => { setMenuOpen(false); onUnsync(); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-s1 text-[#FCA5A5] disabled:opacity-40 disabled:hover:bg-transparent"
              disabled={syncedCount === 0}
            >
              Unsync all ({syncedCount}) from Google
            </button>
            <button
              onClick={() => { setMenuOpen(false); onClearMarkers(); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-s1 text-ink-dim disabled:opacity-40 disabled:hover:bg-transparent"
              disabled={syncedCount === 0}
              title="Local-only — does not delete remote events"
            >
              Clear sync markers only
            </button>
            <div className="border-t my-1" style={{ borderColor: 'var(--line)' }} />
            <a
              href="https://calendar.google.com"
              target="_blank"
              rel="noreferrer noopener"
              className="block px-3 py-1.5 text-[12.5px] hover:bg-s1 text-ink-dim"
              onClick={() => setMenuOpen(false)}
            >
              Open Google Calendar ↗
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.72v2.26h2.9c1.7-1.56 2.69-3.86 2.69-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.46-.8 5.95-2.18l-2.9-2.26c-.8.54-1.83.86-3.05.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.34A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.96 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.06l3-2.34z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.94l3 2.34C4.67 5.16 6.66 3.58 9 3.58z"/>
    </svg>
  );
}

function SearchInput({ value, onChange }) {
  return (
    <label className="relative">
      <svg viewBox="0 0 16 16" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="7" cy="7" r="4.5" /><line x1="10.5" y1="10.5" x2="13.5" y2="13.5" />
      </svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Filter…"
        className="input pl-8 w-56"
      />
    </label>
  );
}
