import { useEffect, useMemo, useState } from 'react';
import MetricCard from '../ui/MetricCard.jsx';
import TaskRow from '../ui/TaskRow.jsx';
import EventList from '../calendar/EventList.jsx';
import Avatar from '../ui/Avatar.jsx';
import { useTasks } from '../../context/TaskContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { getTodaysEvents } from '../../api/calendarApi.js';

const PRIORITY_ORDER = { high: 0, med: 1, low: 2 };

function greet() {
  const h = new Date().getHours();
  if (h < 5)  return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Overview() {
  const { tasks, team } = useTasks();
  const { user, login } = useAuth();
  const [events, setEvents] = useState([]);
  const [calErr, setCalErr] = useState(null);

  const today = new Date().toISOString().slice(0, 10);
  const open      = tasks.filter(t => !t.done);
  const doneToday = tasks.filter(t => t.done && t.due === today);
  const overdue   = open.filter(t => t.due && t.due < today);

  const topPriority = useMemo(() => [...open]
    .sort((a, b) => (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) || a.due.localeCompare(b.due))
    .slice(0, 4), [open]);

  const upcoming7 = useMemo(() => {
    const end = new Date(today); end.setDate(end.getDate() + 7);
    const endIso = end.toISOString().slice(0, 10);
    return open.filter(t => t.due >= today && t.due <= endIso);
  }, [open, today]);

  const completionPct = tasks.length
    ? Math.round((tasks.filter(t => t.done).length / tasks.length) * 100)
    : 0;

  // Per-member workload (top 3 by open count)
  const teamLoad = useMemo(() => team.map(m => {
    const memTasks = tasks.filter(t => t.assignee === m.email);
    const op = memTasks.filter(t => !t.done).length;
    const dn = memTasks.filter(t => t.done).length;
    return { ...m, open: op, done: dn, total: memTasks.length };
  }).sort((a, b) => b.open - a.open).slice(0, 4), [team, tasks]);

  useEffect(() => {
    if (!user) return;
    getTodaysEvents().then(setEvents).catch(err => setCalErr(err.message));
  }, [user]);

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-display text-ink">{greet()} — here&apos;s your day</h1>
          <p className="mt-1.5 text-[13px] text-ink-dim">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            <span className="mx-2 text-ink-faint">·</span>
            {open.length} open task{open.length === 1 ? '' : 's'}
            {overdue.length > 0 && <><span className="mx-2 text-ink-faint">·</span><span className="text-[#FCA5A5]">{overdue.length} overdue</span></>}
          </p>
        </div>
      </header>

      {/* Metric strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Open tasks"      value={open.length}      hint={`across ${team.length} member${team.length === 1 ? '' : 's'}`} />
        <MetricCard label="Completed today" value={doneToday.length} accent="ok"   hint="keep going" />
        <MetricCard label="Events today"    value={user ? events.length : '—'}    hint={user ? 'live from Google' : 'connect Google'} />
        <MetricCard label="Overdue"         value={overdue.length}   accent={overdue.length > 0 ? 'err' : 'default'} hint={overdue.length > 0 ? 'needs attention' : 'all clear'} />
      </div>

      {/* Asymmetric content grid */}
      <div className="grid grid-cols-12 gap-4">
        {/* Priority tasks — wide */}
        <section className="col-span-12 lg:col-span-7 card">
          <div className="flex items-center justify-between mb-3 px-1">
            <div>
              <div className="text-section">Priority queue</div>
              <div className="text-[11.5px] text-ink-muted">High-signal work surfaced from your board</div>
            </div>
            <span className="chip chip-neutral">{topPriority.length}</span>
          </div>
          <div className="flex flex-col">
            {topPriority.length === 0
              ? <div className="text-[12.5px] text-ink-muted py-8 text-center">All clear. Nice.</div>
              : topPriority.map(t => <TaskRow key={t.id} task={t} dense />)
            }
          </div>
          {/* Progress bar */}
          <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center justify-between text-[11.5px] text-ink-muted mb-1.5">
              <span>Sprint completion</span>
              <span className="tabular-nums text-ink">{completionPct}%</span>
            </div>
            <div className="h-1.5 bg-s1 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-accent-500 to-accent-400 transition-[width] duration-500 ease-sleek" style={{ width: `${completionPct}%` }} />
            </div>
          </div>
        </section>

        {/* Today's calendar — narrow */}
        <aside className="col-span-12 lg:col-span-5 card flex flex-col">
          <div className="flex items-center justify-between mb-2 px-1">
            <div>
              <div className="text-section">Today&apos;s schedule</div>
              <div className="text-[11.5px] text-ink-muted">
                {user ? `${events.length} event${events.length === 1 ? '' : 's'} from Google Calendar` : 'Not connected'}
              </div>
            </div>
            {!user && <button onClick={login} className="btn btn-secondary btn-sm">Connect</button>}
          </div>
          <div className="flex-1 flex flex-col">
            {!user ? (
              <ConnectCallout onConnect={login} />
            ) : events.length === 0 ? (
              <div className="text-[12.5px] text-ink-muted py-8 text-center">{calErr || 'No events on the books.'}</div>
            ) : (
              events.map((ev, i) => <EventItemMini key={ev.id || i} event={ev} />)
            )}
          </div>
        </aside>

        {/* Upcoming 7 days */}
        <section className="col-span-12 lg:col-span-7 card">
          <div className="flex items-center justify-between mb-3 px-1">
            <div>
              <div className="text-section">Upcoming · next 7 days</div>
              <div className="text-[11.5px] text-ink-muted">Open tasks due this week</div>
            </div>
            <span className="chip chip-neutral">{upcoming7.length}</span>
          </div>
          {upcoming7.length === 0
            ? <div className="text-[12.5px] text-ink-muted py-8 text-center">Nothing due in the next week.</div>
            : upcoming7.slice(0, 6).map(t => <TaskRow key={t.id} task={t} dense />)
          }
        </section>

        {/* Team load */}
        <section className="col-span-12 lg:col-span-5 card">
          <div className="flex items-center justify-between mb-3 px-1">
            <div>
              <div className="text-section">Team load</div>
              <div className="text-[11.5px] text-ink-muted">By open task count</div>
            </div>
          </div>
          <div className="space-y-2.5">
            {teamLoad.map(m => {
              const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
              return (
                <div key={m.email} className="flex items-center gap-3 px-1">
                  <Avatar seed={m.email} name={m.name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12.5px] truncate">{m.name}</div>
                      <div className="text-[11px] text-ink-muted tabular-nums">{m.open} open · {pct}%</div>
                    </div>
                    <div className="mt-1 h-1 bg-s1 rounded-full overflow-hidden">
                      <div className="h-full bg-accent-500 transition-[width] duration-300 ease-sleek" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function EventItemMini({ event }) {
  const start = event.start?.dateTime || event.start?.date;
  const time = start
    ? (event.start?.dateTime
        ? new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'All day')
    : '';
  return (
    <div className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-s1 transition-colors duration-150">
      <span className="dot bg-accent-500" />
      <span className="text-[11.5px] tabular-nums text-ink-muted w-16">{time}</span>
      <span className="text-[13px] text-ink truncate">{event.summary || '(no title)'}</span>
    </div>
  );
}

function ConnectCallout({ onConnect }) {
  return (
    <div className="surface-1 rounded-md border border-line p-3 mt-1">
      <div className="text-[12.5px] text-ink">Connect Google Calendar</div>
      <div className="text-[11.5px] text-ink-muted mt-0.5">
        See live events, create meetings, invite teammates from any task.
      </div>
      <button onClick={onConnect} className="btn btn-primary btn-sm mt-2">Connect</button>
    </div>
  );
}
