import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Avatar from '../ui/Avatar.jsx';
import { useTasks } from '../../context/TaskContext.jsx';
import { useMemberFilter } from '../../lib/memberFilter.js';

/**
 * Members filter panel (replaces calendar left sidebar).
 *
 * - Lists every active team member.
 * - Multi-select: click toggles. "Clear" wipes selection.
 * - Selection is global (persisted to localStorage via memberFilter store) and
 *   applies to Calendar, Gantt, and Tasks simultaneously.
 */
export default function MembersFilter() {
  const { team, tasks } = useTasks();
  const { selected, isFiltered, toggle, clear } = useMemberFilter();

  const counts = useMemo(() => {
    const m = {};
    for (const t of tasks) if (t.assignee) m[t.assignee] = (m[t.assignee] || 0) + 1;
    return m;
  }, [tasks]);

  const sorted = useMemo(
    () => [...team].sort((a, b) => (counts[b.email] || 0) - (counts[a.email] || 0)),
    [team, counts],
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
      className="card !p-0 overflow-hidden"
    >
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <div className="text-section">Members</div>
          <div className="text-[10.5px] text-ink-muted mt-0.5">
            {isFiltered
              ? `${selected.size} selected · filtering`
              : `${team.length} active · show all`}
          </div>
        </div>
        <AnimatePresence>
          {isFiltered && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={clear}
              className="btn btn-ghost btn-sm !h-7 !text-[11px]"
              title="Clear member filter"
            >
              Clear
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="px-2 pb-2 flex flex-col gap-0.5 max-h-[480px] overflow-y-auto">
        {sorted.map((m) => {
          const active = selected.has(m.email);
          const count  = counts[m.email] || 0;
          return (
            <motion.button
              key={m.email}
              onClick={() => toggle(m.email)}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
              className={`relative w-full flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors duration-150 ${
                active
                  ? 'bg-accent-soft text-ink'
                  : isFiltered
                    ? 'opacity-55 hover:opacity-85 hover:bg-s1 text-ink-dim'
                    : 'hover:bg-s1 text-ink-dim'
              }`}
              aria-pressed={active}
              title={active ? `Hide ${m.name}'s tasks from filter` : `Filter to ${m.name}`}
            >
              {active && (
                <motion.span
                  layoutId="member-filter-rail"
                  className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
                  style={{ background: 'var(--gradient-accent)' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <Avatar seed={m.email} name={m.name} size="sm" />
              <div className="flex-1 min-w-0 text-left">
                <div className="text-[12.5px] leading-tight truncate">{m.name}</div>
                <div className="text-[10.5px] text-ink-faint leading-tight truncate">{m.role || m.email}</div>
              </div>
              {count > 0 && (
                <span className={`chip !h-[18px] !text-[10px] !px-1.5 ${active ? 'chip-info' : 'chip-neutral'}`}>
                  {count}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
