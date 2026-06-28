import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTasks } from '../context/TaskContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useEvents } from '../context/EventsContext.jsx';
import { AvatarStack } from './ui/Avatar.jsx';
import ThemeToggle from './ui/ThemeToggle.jsx';
import RestorePanel from './ui/RestorePanel.jsx';
import Avatar from './ui/Avatar.jsx';
import { Backdrop, Field } from './ui/DeployModal.jsx';
import { setClientIdOverride } from '../auth/gis.js';
import { scoreMember, scoreTask, scoreEvent } from '../lib/search.js';

const DEBOUNCE_MS = 300;
const PER_GROUP   = 6; // max results per group
const TOTAL_MAX   = 18;

export default function Topbar({ page, onJump }) {
  const { user, login, signOut, configured, loading, error, fullyAuthorized, scopesRequested } = useAuth();
  const { team, tasks, cloudStatus } = useTasks();
  const { events: gcalEvents, loading: eventsLoading } = useEvents();
  const { push: toast } = useToast();
  const searchRef = useRef(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  // ─── Search ──────────────────────────────────────────────────────────────
  const [query, setQuery]   = useState('');         // raw input
  const [debounced, setDebounced] = useState('');   // debounced query used for scoring
  const [focused, setFocused] = useState(false);
  const [active, setActive]   = useState(0);        // flat index into rendered results
  const containerRef = useRef(null);

  // Debounce: drives `debounced` 300ms after the last keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    function onKey(e) {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close dropdown when clicking outside the search container
  useEffect(() => {
    function onDown(e) {
      if (!containerRef.current?.contains(e.target)) setFocused(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  // Token expiry countdown — live every 30s
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!user?.expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [user?.expiresAt]);

  // Scored, ranked, grouped results.
  // - Scoring uses lib/search.js (exact > prefix > token-prefix > contains > numeric > fuzzy).
  // - Each group ranks descending by score, sliced to PER_GROUP.
  // - `flat` flattens groups in display order so keyboard nav indexes into it.
  const { groups, flat } = useMemo(() => {
    const q = debounced;
    if (!q) return { groups: [], flat: [] };

    const memberHits = team
      .map(m => ({ kind: 'member', member: m, score: scoreMember(m, q) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_GROUP);

    const taskHits = tasks
      .map(t => ({ kind: 'task', task: t, member: team.find(m => m.email === t.assignee), score: scoreTask(t, q) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_GROUP);

    const eventHits = gcalEvents
      .map(ev => ({ kind: 'event', event: ev, score: scoreEvent(ev, q) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_GROUP);

    const groupsArr = [
      { id: 'member', label: 'Members', items: memberHits },
      { id: 'task',   label: 'Tasks',   items: taskHits },
      { id: 'event',  label: 'Events',  items: eventHits },
    ].filter(g => g.items.length > 0);

    const flatArr = groupsArr.flatMap(g => g.items).slice(0, TOTAL_MAX);
    return { groups: groupsArr, flat: flatArr };
  }, [debounced, tasks, team, gcalEvents]);

  // Reset active when debounced query changes
  useEffect(() => { setActive(0); }, [debounced]);

  function commitResult(r) {
    if (!r) return;
    setQuery('');
    setDebounced('');
    setFocused(false);
    if (r.kind === 'task') {
      onJump?.('tasks');
      setTimeout(() => flashAndScroll(`[data-task-id="${r.task.id}"]`), 200);
    } else if (r.kind === 'member') {
      onJump?.('team');
      setTimeout(() => flashAndScroll(`[data-member-email="${r.member.email}"]`), 200);
    } else if (r.kind === 'event') {
      // Open event in Google Calendar (new tab). htmlLink is provided by API.
      if (r.event.htmlLink) {
        window.open(r.event.htmlLink, '_blank', 'noopener,noreferrer');
      } else {
        onJump?.('calendar');
      }
    }
  }

  function onInputKeyDown(e) {
    if (e.key === 'ArrowDown')      { e.preventDefault(); setActive(i => Math.min(i + 1, flat.length - 1)); setFocused(true); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter')     { e.preventDefault(); commitResult(flat[active]); }
    else if (e.key === 'Escape')    { e.preventDefault(); setQuery(''); setDebounced(''); searchRef.current?.blur(); setFocused(false); }
  }

  const titleByPage = {
    overview: 'Overview',
    gantt:    'Gantt',
    calendar: 'Calendar',
    tasks:    'Tasks',
    team:     'Team',
  };

  const tokenMinutesLeft = user?.expiresAt ? Math.max(0, Math.round((user.expiresAt - now) / 60000)) : 0;
  const partialScope = user && !fullyAuthorized;

  async function handleConnect() {
    if (!configured) { setSetupOpen(true); return; }
    try {
      await login();
    } catch (err) {
      toast({ type: 'error', title: 'Google sign-in failed', body: err?.message || err?.code || 'Try again.' });
    }
  }

  const showDropdown = focused && (query.trim().length > 0);
  const isStalePending = focused && query.trim() !== debounced; // typing, awaiting debounce
  const totalCount = flat.length;

  return (
    <header
      className="h-12 px-4 flex items-center gap-3 border-b shrink-0 bg-canvas/80 backdrop-blur"
      style={{ borderColor: 'var(--line)' }}
    >
      <div className="flex items-center gap-2 text-[12.5px] min-w-0">
        <span className="text-ink-muted">Workspace</span>
        <SlashIcon />
        <span className="text-ink truncate">{titleByPage[page] || 'Dashboard'}</span>
      </div>

      <div ref={containerRef} className="ml-4 flex-1 max-w-xl relative">
        <label className="relative block group">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocused(true); }}
            onFocus={() => setFocused(true)}
            onKeyDown={onInputKeyDown}
            placeholder="Search tasks, events, members…"
            className="input pl-8 pr-3 h-8 bg-surface border-line hover:border-line-strong focus:border-line-strong focus:bg-elevated"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls="topbar-search-results"
            aria-autocomplete="list"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); searchRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink text-[12px] w-4 h-4 grid place-items-center"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </label>

        {showDropdown && (
          <div
            id="topbar-search-results"
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+6px)] surface z-50 py-1 shadow-e3 animate-slide-up overflow-hidden"
          >
            {totalCount === 0 ? (
              isStalePending ? (
                <div className="px-3 py-4 text-[12.5px] text-ink-muted text-center">Searching…</div>
              ) : (
                <div className="px-3 py-4 text-[12.5px] text-ink-muted text-center">
                  No results found for <span className="text-ink">&quot;{debounced}&quot;</span>
                </div>
              )
            ) : (
              <ul className="max-h-[65vh] overflow-y-auto">
                {(() => {
                  let flatIdx = 0;
                  return groups.map(g => (
                    <li key={g.id}>
                      <div className="sticky top-0 px-3 py-1 bg-elevated text-[10.5px] uppercase tracking-[0.06em] font-semibold text-ink-muted border-b z-10" style={{ borderColor: 'var(--line)' }}>
                        {g.label}
                        <span className="ml-1 text-ink-faint normal-case font-normal tracking-normal">· {g.items.length}</span>
                      </div>
                      <ul>
                        {g.items.map((r) => {
                          const idx = flatIdx++;
                          const key = r.kind === 'member' ? r.member.email
                                    : r.kind === 'task'   ? r.task.id
                                    :                       r.event.id;
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={idx === active}
                                onMouseEnter={() => setActive(idx)}
                                onMouseDown={(e) => { e.preventDefault(); commitResult(r); }}
                                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors duration-100 ${
                                  idx === active ? 'bg-s2' : 'hover:bg-s1'
                                }`}
                              >
                                <ResultRow r={r} query={debounced} />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ));
                })()}
              </ul>
            )}
            <div className="border-t mt-1 pt-1 px-3 py-1 text-[10.5px] text-ink-faint flex items-center justify-between" style={{ borderColor: 'var(--line)' }}>
              <span>
                {isStalePending
                  ? 'Searching…'
                  : `${totalCount} result${totalCount === 1 ? '' : 's'}`}
                {eventsLoading && <span className="ml-2 text-ink-faint">· events loading</span>}
              </span>
              <span className="flex items-center gap-1">
                <span className="kbd">↑</span><span className="kbd">↓</span> navigate
                <span className="ml-2 kbd">↵</span> open
                <span className="ml-2 kbd">esc</span> close
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setRestoreOpen(true)}
          className="btn btn-ghost btn-sm !h-8 !w-8 !p-0"
          aria-label="Restore from audit log"
          title="Restore to a point in time"
        >
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8a5 5 0 1 1 1.46 3.54" />
            <polyline points="3 4 3 8 7 8" />
            <line x1="8" y1="5" x2="8" y2="8" />
            <line x1="8" y1="8" x2="10.5" y2="9.5" />
          </svg>
        </button>
        <ThemeToggle />
        <AvatarStack members={team} max={5} size="sm" />

        {!configured && (
          <button
            onClick={() => setSetupOpen(true)}
            className="chip chip-warn hover:!border-line-strong"
            title="Click to set up Google OAuth"
          >
            OAuth not configured
          </button>
        )}

        {configured && error && !user && (
          <span className="chip chip-err" title={error.message || ''}>Auth error</span>
        )}

        {configured && partialScope && (
          <span className="chip chip-warn" title={`Missing: ${scopesRequested.filter(s => !user.scopes.includes(s)).join(', ')}`}>
            Partial scope
          </span>
        )}

        {cloudStatus?.state === 'saving' && (
          <span className="chip chip-info" title="Latest change is still being written to the shared database">
            Saving...
          </span>
        )}
        {cloudStatus?.state === 'saved' && (
          <span className="chip chip-ok" title="Latest change was stored in the shared database">
            Saved
          </span>
        )}
        {cloudStatus?.state === 'error' && (
          <span className="chip chip-err" title={cloudStatus.error || 'A save failed'}>
            Error Saving
          </span>
        )}

        {user ? (
          <>
            <span
              className="chip chip-ok"
              title={`Token expires in ~${tokenMinutesLeft} min · auto-refreshes silently`}
            >
              Calendar synced{tokenMinutesLeft > 0 ? ` · ${tokenMinutesLeft}m` : ''}
            </span>
            <button onClick={signOut} className="btn btn-ghost btn-sm">Sign out</button>
          </>
        ) : (
          <button onClick={handleConnect} disabled={loading} className="btn btn-primary btn-sm">
            {loading ? 'Connecting…' : configured ? 'Connect Google' : 'Set up Google'}
          </button>
        )}
      </div>

      {setupOpen && <SetupModal onClose={() => setSetupOpen(false)} toast={toast} />}
      {restoreOpen && <RestorePanel onClose={() => setRestoreOpen(false)} />}
    </header>
  );
}

function flashAndScroll(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash-highlight');
  setTimeout(() => el.classList.remove('flash-highlight'), 1500);
}

const PRIORITY_DOT = { high: 'bg-red-500', med: 'bg-amber-500', low: 'bg-emerald-500' };

function ResultRow({ r, query }) {
  if (r.kind === 'event') {
    const ev = r.event;
    const start = ev.start?.dateTime || ev.start?.date;
    const dateStr = start ? new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const timeStr = ev.start?.dateTime
      ? new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : 'All day';
    return (
      <>
        <span className="text-[10px] uppercase tracking-wider text-ink-faint w-10 shrink-0">event</span>
        <CalendarMiniIcon />
        <span className="flex-1 min-w-0">
          <div className="text-[12.5px] text-ink truncate">
            <Highlight text={ev.summary || '(no title)'} q={query} />
          </div>
          <div className="text-[10.5px] text-ink-muted truncate">
            {dateStr} · {timeStr}
            {ev.location && <span className="ml-1.5"><Highlight text={ev.location} q={query} /></span>}
            {ev.organizer?.displayName && <span className="ml-1.5">· <Highlight text={ev.organizer.displayName} q={query} /></span>}
          </div>
        </span>
        {ev.htmlLink && <span className="text-[10.5px] text-ink-faint shrink-0">↗</span>}
      </>
    );
  }
  if (r.kind === 'task') {
    const t = r.task;
    const m = r.member;
    const today = new Date().toISOString().slice(0, 10);
    const overdue = !t.done && t.due && t.due < today;
    return (
      <>
        <span className="text-[10px] uppercase tracking-wider text-ink-faint w-10 shrink-0">task</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[t.priority] || 'bg-slate-400'}`} />
        <span className={`flex-1 min-w-0 text-[12.5px] truncate ${t.done ? 'line-through text-ink-muted' : 'text-ink'}`}>
          <Highlight text={t.name} q={query} />
        </span>
        {m && (
          <span className="flex items-center gap-1 text-[10.5px] text-ink-muted shrink-0">
            <Avatar seed={m.email} name={m.name} size="xs" />
            <span className="truncate max-w-[100px]">{m.name}</span>
          </span>
        )}
        <span className={`text-[10.5px] tabular-nums shrink-0 w-12 text-right ${overdue ? 'text-[#FCA5A5]' : 'text-ink-faint'}`}>
          {t.due || ''}
        </span>
      </>
    );
  }
  const m = r.member;
  const status = m.googleSub ? 'Linked' : 'Not linked';
  return (
    <>
      <span className="text-[10px] uppercase tracking-wider text-ink-faint w-10 shrink-0">member</span>
      <Avatar seed={m.email} name={m.name} size="sm" />
      <span className="flex-1 min-w-0">
        <div className="text-[12.5px] text-ink truncate">
          <Highlight text={m.name} q={query} />
        </div>
        <div className="text-[10.5px] text-ink-muted truncate font-mono">
          <Highlight text={m.email} q={query} />
        </div>
      </span>
      <span className="text-[10.5px] text-ink-muted shrink-0 truncate max-w-[110px]">{m.role}</span>
      <span className={`chip ${m.googleSub ? 'chip-ok' : 'chip-neutral'} !h-[18px] !text-[9.5px] !px-1.5 shrink-0`}>{status}</span>
    </>
  );
}

function Highlight({ text, q }) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-accent-500/30 text-ink rounded-sm px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function SetupModal({ onClose, toast }) {
  const currentEnv = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  const currentOverride = (() => {
    try { return localStorage.getItem('gcal_client_id_override') || ''; } catch { return ''; }
  })();
  const [id, setId] = useState(currentOverride);

  function save(e) {
    e.preventDefault();
    const trimmed = id.trim();
    if (trimmed && !/\.apps\.googleusercontent\.com$/.test(trimmed)) {
      toast({ type: 'warn', title: 'Looks unusual', body: 'Client IDs normally end in .apps.googleusercontent.com — saving anyway.' });
    }
    setClientIdOverride(trimmed);
    toast({ type: 'success', title: trimmed ? 'Client ID saved' : 'Override cleared', body: 'Reloading…' });
    setTimeout(() => window.location.reload(), 500);
  }

  function clearOverride() {
    setClientIdOverride('');
    toast({ type: 'info', title: 'Override cleared', body: 'Reloading…' });
    setTimeout(() => window.location.reload(), 400);
  }

  return (
    <Backdrop onClose={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="surface w-full max-w-lg animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--line)' }}>
          <div>
            <div className="text-[14px] font-semibold">Set up Google Calendar</div>
            <div className="text-[11.5px] text-ink-muted mt-0.5">Paste an OAuth Client ID to enable real sync</div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm !h-7 !w-7 !p-0" aria-label="Close">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <ol className="text-[12.5px] text-ink-dim space-y-2 list-decimal pl-4">
            <li>Open <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer noopener" className="text-accent-400 hover:underline">Google Cloud Console</a> → enable <b>Google Calendar API</b>.</li>
            <li>OAuth consent screen → scope <code className="text-[11px] bg-s2 px-1 rounded">calendar.events</code>.</li>
            <li>Credentials → OAuth client ID → <b>Web application</b>:
              <div className="mt-1 ml-1 text-[11.5px] text-ink-muted">
                Authorized JS origins: <code className="text-[10.5px] bg-s2 px-1 rounded">{window.location.origin}</code>
                <br/>Redirect URIs: <b>none</b> (GIS uses postMessage)
              </div>
            </li>
            <li>Copy the Client ID → paste below.</li>
          </ol>

          <Field label="OAuth Client ID">
            <input
              value={id}
              onChange={e => setId(e.target.value)}
              placeholder="123456789-abc...xyz.apps.googleusercontent.com"
              className="input input-lg font-mono text-[12px]"
              autoFocus
              spellCheck={false}
            />
          </Field>

          <div className="text-[11.5px] text-ink-muted">
            Stored in <code className="text-[10.5px] bg-s2 px-1 rounded">localStorage["gcal_client_id_override"]</code> for this browser.
            For production deploys, set <code className="text-[10.5px] bg-s2 px-1 rounded">VITE_GOOGLE_CLIENT_ID</code> in <code className="text-[10.5px] bg-s2 px-1 rounded">.env</code> instead.
          </div>

          {currentEnv && !currentEnv.startsWith('YOUR_CLIENT_ID') && (
            <div className="chip chip-info">.env value detected — override will take precedence</div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--line)' }}>
          <button
            type="button"
            onClick={clearOverride}
            className="btn btn-ghost btn-sm"
            disabled={!currentOverride}
          >
            Clear override
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={!id.trim()}>Save &amp; reload</button>
          </div>
        </div>
      </form>
    </Backdrop>
  );
}

function SearchIcon(p) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" {...p}>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" />
    </svg>
  );
}
function CalendarMiniIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-ink-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <line x1="2" y1="6.5" x2="14" y2="6.5" />
      <line x1="5.5" y1="2" x2="5.5" y2="5" />
      <line x1="10.5" y1="2" x2="10.5" y2="5" />
    </svg>
  );
}
function SlashIcon() {
  return <span className="text-ink-faint">/</span>;
}
