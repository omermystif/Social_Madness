import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTasks } from '../context/TaskContext.jsx';

const NAV = [
  { id: 'overview', label: 'Overview', icon: OverviewIcon, kbd: '1' },
  { id: 'gantt',    label: 'Gantt',    icon: GanttIcon,    kbd: '2' },
  { id: 'calendar', label: 'Calendar', icon: CalendarIcon, kbd: '3' },
  { id: 'tasks',    label: 'Tasks',    icon: TasksIcon,    kbd: '4' },
  { id: 'team',     label: 'Team',     icon: TeamIcon,     kbd: '5' },
];

export default function Sidebar({ page, setPage }) {
  const { tasks, team } = useTasks();
  const today = new Date().toISOString().slice(0, 10);

  const counts = {
    overview: null,
    gantt:    null,
    calendar: tasks.filter(t => !t.done && t.due === today).length || null,
    tasks:    tasks.filter(t => !t.done).length || null,
    team:     team.length || null,
  };

  const [collapsed, setCollapsed] = useState(false);
  const W = collapsed ? 64 : 232;

  return (
    <aside
      className="shrink-0 h-full border-r flex flex-col bg-surface transition-[width] duration-200 ease-sleek"
      style={{ width: W, borderColor: 'var(--line)' }}
    >
      {/* Workspace switcher */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center gap-2.5 px-3 py-3.5 hover:bg-s1 transition-colors duration-150"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <div className="w-7 h-7 rounded-md grid place-items-center font-bold text-[13px] shrink-0 text-white" style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-glow-accent)' }}>B</div>
        {!collapsed && (
          <>
            <div className="flex-1 text-left min-w-0">
              <div className="text-[13px] font-semibold leading-tight truncate">Box Madness</div>
              <div className="text-[10.5px] text-ink-muted leading-tight truncate">Social ops · personal</div>
            </div>
            <ChevronIcon className="w-3.5 h-3.5 text-ink-muted" />
          </>
        )}
      </button>
      <div className="divider-h" />

      {/* Section: workspace */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5" aria-label="Primary">
        {!collapsed && (
          <div className="label px-2 py-2 select-none">Workspace</div>
        )}
        {NAV.map(n => {
          const active = page === n.id;
          const Icon = n.icon;
          return (
            <motion.button
              key={n.id}
              onClick={() => setPage(n.id)}
              whileTap={{ scale: 0.97 }}
              className={`group relative w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] transition-colors duration-150 ${
                active
                  ? 'bg-s2 text-ink'
                  : 'text-ink-dim hover:bg-s1 hover:text-ink'
              }`}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? n.label : undefined}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active-pill"
                  className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
                  style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 8px var(--accent-soft)' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-accent-500' : 'text-ink-muted group-hover:text-ink-dim'}`} />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left truncate">{n.label}</span>
                  {counts[n.id] != null && (
                    <span className="chip chip-neutral !h-[18px] !text-[10px] !px-1.5">{counts[n.id]}</span>
                  )}
                  <span className="kbd hidden group-hover:inline-flex">{n.kbd}</span>
                </>
              )}
            </motion.button>
          );
        })}

        {!collapsed && (
          <>
            <div className="label px-2 pt-5 pb-2 select-none">Period</div>
            <div className="px-2 py-1.5 text-[12px] text-ink-dim">
              Jun 2 — Jul 19, 2026
            </div>
            <div className="px-2 py-0.5 text-[11px] text-ink-muted">
              Soccer tournament · Week {currentWeek()}
            </div>
          </>
        )}
      </nav>

    </aside>
  );
}

function currentWeek() {
  const start = new Date('2026-06-02');
  const days  = Math.floor((Date.now() - start.getTime()) / 86400000);
  return Math.max(1, Math.min(4, Math.floor(days / 7) + 1));
}

/* ─── Icons (16px, 1.5 stroke, monoline) ──────────────────────────────── */
function OverviewIcon(p) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="2" y="2" width="5.5" height="6" rx="1.2" />
      <rect x="8.5" y="2" width="5.5" height="3.5" rx="1.2" />
      <rect x="2" y="9" width="5.5" height="5" rx="1.2" />
      <rect x="8.5" y="6.5" width="5.5" height="7.5" rx="1.2" />
    </svg>
  );
}
function GanttIcon(p) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...p}>
      <line x1="3" y1="4" x2="10" y2="4" />
      <line x1="5" y1="8" x2="13" y2="8" />
      <line x1="2.5" y1="12" x2="9" y2="12" />
    </svg>
  );
}
function CalendarIcon(p) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <line x1="2" y1="6.5" x2="14" y2="6.5" />
      <line x1="5.5" y1="2" x2="5.5" y2="5" />
      <line x1="10.5" y1="2" x2="10.5" y2="5" />
    </svg>
  );
}
function TasksIcon(p) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3.5 5l1.5 1.5L8 3.5" />
      <line x1="9.5" y1="5" x2="13.5" y2="5" />
      <path d="M3.5 11l1.5 1.5L8 9.5" />
      <line x1="9.5" y1="11" x2="13.5" y2="11" />
    </svg>
  );
}
function TeamIcon(p) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="6" cy="6" r="2.5" />
      <path d="M2 13c0-2.5 1.8-4 4-4s4 1.5 4 4" />
      <circle cx="11.5" cy="5.5" r="1.8" />
      <path d="M10 13c0-2 1.5-3.5 3.5-3.5" />
    </svg>
  );
}
function ChevronIcon(p) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="6 4 10 8 6 12" />
    </svg>
  );
}
function DotsIcon(p) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <circle cx="4" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="12" cy="8" r="1.2" />
    </svg>
  );
}
