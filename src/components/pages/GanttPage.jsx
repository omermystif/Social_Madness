import { useEffect, useMemo, useRef, useState } from 'react';
import { useTasks, resolveCurrentMember } from '../../context/TaskContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Avatar from '../ui/Avatar.jsx';
import { openTask } from '../../lib/taskFocus.js';
import { useMemberFilter } from '../../lib/memberFilter.js';

const RANGE_START = '2026-06-01';
const RANGE_END   = '2026-07-26';

const PRIORITY_BAR = {
  high: { fill: '#EF4444', soft: 'rgba(239,68,68,0.18)',  border: 'rgba(239,68,68,0.5)' },
  med:  { fill: '#F59E0B', soft: 'rgba(245,158,11,0.18)', border: 'rgba(245,158,11,0.5)' },
  low:  { fill: '#10B981', soft: 'rgba(16,185,129,0.18)', border: 'rgba(16,185,129,0.5)' },
};

function dayDiff(aIso, bIso) {
  return Math.round((new Date(bIso) - new Date(aIso)) / 86400000);
}
function listDates(startIso, endIso) {
  const out = []; const start = new Date(startIso);
  const days = dayDiff(startIso, endIso) + 1;
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i); out.push(d);
  }
  return out;
}
function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftIso(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

export default function GanttPage() {
  const { tasks, team, updateTask, toggleTask, rescheduleTask } = useTasks();
  const { profile } = useAuth();
  const currentMember = useMemo(() => resolveCurrentMember(team, profile), [team, profile]);
  const myEmail = currentMember?.email || null;
  const { selected: selectedMembers, isFiltered: memberFiltered } = useMemberFilter();
  const [groupBy, setGroupBy]       = useState('assignee');
  const [filterDone, setFilterDone] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState('all'); // 'all' | 'me' | 'unassigned' | <email>
  const [zoom, setZoom]             = useState('comfortable'); // compact | comfortable | wide
  const [pinnedTaskId, setPinnedTaskId] = useState(null);

  const togglePin = (id) => setPinnedTaskId(prev => prev === id ? null : id);

  const COL_PX = zoom === 'compact' ? 22 : zoom === 'wide' ? 38 : 28;
  const LABEL_PX = 320;

  // Auto-expand range to fit all tasks, with a sensible floor (the campaign window).
  // Pads ±3 days so bars don't kiss the edges.
  const today = isoDay(new Date());
  const { rangeStart, rangeEnd } = useMemo(() => {
    const withDates = tasks.filter(t => t.due);
    let min = RANGE_START;
    let max = RANGE_END;
    for (const t of withDates) {
      const s = t.start || t.due;
      if (s && s < min) min = s;
      if (t.due && t.due > max) max = t.due;
    }
    return { rangeStart: shiftIso(min, -3), rangeEnd: shiftIso(max, 3) };
  }, [tasks]);
  const totalDays = dayDiff(rangeStart, rangeEnd) + 1;
  const dates = listDates(rangeStart, rangeEnd);

  const visible = useMemo(() => {
    let list = tasks.filter(t => t.due);
    if (filterDone) list = list.filter(t => !t.done);
    if (assigneeFilter === 'me' && myEmail)            list = list.filter(t => t.assignee === myEmail);
    else if (assigneeFilter === 'unassigned')          list = list.filter(t => !t.assignee || !team.some(m => m.email === t.assignee));
    else if (assigneeFilter !== 'all' && assigneeFilter !== 'me') list = list.filter(t => t.assignee === assigneeFilter);
    return list.sort((a, b) => (a.start || a.due).localeCompare(b.start || b.due));
  }, [tasks, filterDone, assigneeFilter, myEmail, team]);

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: 'All tasks', items: visible }];
    if (groupBy === 'priority') {
      const order = ['high', 'med', 'low'];
      return order.map(p => ({
        key: p,
        label: { high: 'High priority', med: 'Medium priority', low: 'Low priority' }[p],
        items: visible.filter(t => t.priority === p),
      })).filter(g => g.items.length > 0);
    }
    return team.map(m => ({
      key: m.email,
      label: m.name,
      sub: m.role,
      member: m,
      items: visible.filter(t => t.assignee === m.email),
    })).filter(g => g.items.length > 0);
  }, [visible, team, groupBy]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-page text-ink">Gantt</h1>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {visible.length} task{visible.length === 1 ? '' : 's'} · {rangeStart} → {rangeEnd}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <GanttUserFilter team={team} value={assigneeFilter} onChange={setAssigneeFilter} myEmail={myEmail} />
          <Segmented
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { id: 'assignee', label: 'Assignee' },
              { id: 'priority', label: 'Priority' },
              { id: 'none',     label: 'Flat' },
            ]}
          />
          <Segmented
            value={zoom}
            onChange={setZoom}
            options={[
              { id: 'compact',     label: '−' },
              { id: 'comfortable', label: '·' },
              { id: 'wide',        label: '+' },
            ]}
          />
          <label className="flex items-center gap-1.5 text-[12px] text-ink-dim ml-1">
            <input type="checkbox" checked={filterDone} onChange={e => setFilterDone(e.target.checked)} />
            Hide completed
          </label>
        </div>
      </div>

      {/* Gantt body */}
      <div className="card !p-0 overflow-auto">
        <div style={{ minWidth: LABEL_PX + COL_PX * totalDays + 16 }}>
          {/* Header row */}
          <div className="sticky top-0 z-10 bg-elevated border-b flex" style={{ borderColor: 'var(--line)' }}>
            <div className="shrink-0 px-3 py-2 label border-r" style={{ width: LABEL_PX, borderColor: 'var(--line)' }}>
              Task · Assignee
            </div>
            <div className="flex" style={{ width: COL_PX * totalDays }}>
              {dates.map((d, i) => {
                const iso = isoDay(d);
                const dow = d.getDay();
                const weekend = dow === 0 || dow === 6;
                const isMonday = dow === 1;
                const isFirst  = d.getDate() === 1;
                const isToday  = iso === today;
                return (
                  <div
                    key={i}
                    className={`shrink-0 text-center py-1.5 border-r ${weekend ? 'bg-canvas/40 text-ink-faint' : 'text-ink-muted'} ${isToday ? 'bg-accent-500/10 text-accent-400' : ''}`}
                    style={{
                      width: COL_PX,
                      borderColor: isFirst || isMonday ? 'var(--line-strong)' : 'var(--line-soft)',
                    }}
                    title={iso}
                  >
                    <div className="text-[9px] uppercase tracking-wider">{d.toLocaleString('en-US', { month: 'short' })[0]}</div>
                    <div className={`text-[11px] tabular-nums ${isToday ? 'font-bold' : ''}`}>{d.getDate()}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Groups */}
          {groups.map(g => (
            <div key={g.key}>
              <div className="flex items-center gap-2 px-3 py-2 bg-surface border-b" style={{ borderColor: 'var(--line)' }}>
                {g.member && <Avatar seed={g.member.email} name={g.member.name} size="xs" />}
                <span className="text-[12.5px] font-semibold text-ink">{g.label}</span>
                {g.sub && <span className="text-[11px] text-ink-muted">{g.sub}</span>}
                <span className="ml-auto chip chip-neutral !h-[18px] !text-[10px] !px-1.5">{g.items.length}</span>
              </div>
              {g.items.map(task => (
                <GanttRow
                  key={task.id}
                  task={task}
                  totalDays={totalDays}
                  rangeStart={rangeStart}
                  today={today}
                  dates={dates}
                  colPx={COL_PX}
                  labelPx={LABEL_PX}
                  team={team}
                  pinned={pinnedTaskId === task.id}
                  dim={memberFiltered && !selectedMembers.has(task.assignee)}
                  onTogglePin={() => togglePin(task.id)}
                  onOpenDetail={() => openTask(task.id)}
                  onUpdate={(patch) => rescheduleTask(task.id, patch, { memberEmail: myEmail })}
                  onToggle={() => toggleTask(task.id)}
                />
              ))}
            </div>
          ))}

          {groups.length === 0 && (
            <div className="text-[12.5px] text-ink-muted py-12 text-center">No tasks to show.</div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-[11.5px] text-ink-muted">
        <LegendDot color="#EF4444" label="High" />
        <LegendDot color="#F59E0B" label="Medium" />
        <LegendDot color="#10B981" label="Low" />
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded ring-1 ring-[#EF4444]" /> Overdue</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-accent-500/30" /> Today</span>
        <span className="text-ink-faint">Hover to expand · click to pin · double-click to edit dates · drag grip to reschedule.</span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 0 3px ${color}22` }} />
      {label}
    </span>
  );
}

function GanttUserFilter({ team, value, onChange, myEmail }) {
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
        className="px-2.5 h-7 rounded-md text-[12px] font-medium surface-1 border border-line text-ink-dim hover:text-ink hover:bg-s2 flex items-center gap-1.5"
      >
        <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="6" r="2.5" /><path d="M3 13c0-2.5 2.2-4 5-4s5 1.5 5 4" />
        </svg>
        {label}
        <svg viewBox="0 0 16 16" className="w-2.5 h-2.5 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[calc(100%+4px)] surface w-56 z-50 py-1 shadow-e2 animate-slide-up max-h-[320px] overflow-y-auto">
            {[
              { id: 'all',        label: 'All users' },
              { id: 'me',         label: 'My tasks', disabled: !myEmail, hint: myEmail || 'link Google first' },
              { id: 'unassigned', label: 'Unassigned' },
            ].map(o => (
              <button
                key={o.id}
                onClick={() => { onChange(o.id); setOpen(false); }}
                disabled={o.disabled}
                className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-s1 flex items-center justify-between disabled:opacity-40 disabled:hover:bg-transparent ${value === o.id ? 'bg-s2 text-ink' : 'text-ink-dim'}`}
              >
                <span>{o.label}</span>
                {o.hint && <span className="text-[10.5px] text-ink-muted">{o.hint}</span>}
              </button>
            ))}
            <div className="border-t my-1" style={{ borderColor: 'var(--line)' }} />
            <div className="label px-3 py-1.5">Members</div>
            {team.map(m => (
              <button
                key={m.email}
                onClick={() => { onChange(m.email); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-s1 ${value === m.email ? 'bg-s2 text-ink' : 'text-ink-dim'}`}
              >
                {m.name}
                <span className="text-[10.5px] text-ink-muted ml-2">{m.role}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 surface-1 rounded-md border border-line">
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2 h-7 rounded text-[12px] font-medium transition-colors duration-150 ${
            value === o.id ? 'bg-s3 text-ink' : 'text-ink-dim hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function addDaysIso(iso, n) {
  const d = new Date(iso); d.setDate(d.getDate() + n);
  return isoDay(d);
}

function GanttRow({ task, totalDays, rangeStart, today, dates, colPx, labelPx, team, pinned, dim = false, onTogglePin, onOpenDetail, onUpdate, onToggle }) {
  const start = task.start || task.due;
  const end   = task.due;
  const origStartCol = Math.max(0, dayDiff(rangeStart, start));
  const origEndCol   = Math.min(totalDays - 1, dayDiff(rangeStart, end));
  const span         = Math.max(1, origEndCol - origStartCol + 1);

  const { push: toast } = useToast();

  // Drag state — live in refs to avoid React rerenders per pointermove.
  // React state is used only for visible chip text + dragging boolean.
  const barRef    = useRef(null);
  const chipRef   = useRef(null);
  const ghostRef  = useRef(null);
  const dragRef   = useRef(null); // { pointerId, startX, startCol, span, el, currentTargetCol, moved }
  const rafRef    = useRef(0);
  const [dragging, setDragging] = useState(false);

  // Expand-on-hover + pinned state.
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;
  // Measure natural label width for smooth px-to-px transition (no max-content jank).
  const measureRef = useRef(null);
  const [naturalLabelPx, setNaturalLabelPx] = useState(0);
  useEffect(() => {
    if (measureRef.current) {
      setNaturalLabelPx(Math.ceil(measureRef.current.getBoundingClientRect().width));
    }
  }, [task.name]);

  const member = team.find(m => m.email === task.assignee);
  const overdue = !task.done && end < today;
  const colors  = PRIORITY_BAR[task.priority] || PRIORITY_BAR.low;

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  function applyVisual(startCol, currentSpan) {
    const left  = startCol * colPx + 3;
    const width = currentSpan * colPx - 6;
    if (barRef.current)   { barRef.current.style.left = `${left}px`; barRef.current.style.width = `${width}px`; }
    if (ghostRef.current) { ghostRef.current.style.left = `${left}px`; ghostRef.current.style.width = `${width}px`; }
    if (chipRef.current) {
      const endCol = startCol + currentSpan - 1;
      const startIso = addDaysIso(rangeStart, startCol);
      const endIso   = addDaysIso(rangeStart, endCol);
      chipRef.current.style.left = `${left}px`;
      chipRef.current.textContent = startIso === endIso ? startIso : `${startIso} → ${endIso}`;
    }
  }

  // mode: 'translate' (move whole bar) | 'resize-start' (drag left edge) | 'resize-end' (drag right edge)
  function makePointerDown(mode) {
    return function onHandlePointerDown(e) {
      if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      try { el.setPointerCapture(e.pointerId); } catch {}
      dragRef.current = {
        pointerId: e.pointerId,
        startX:    e.clientX,
        startCol:  origStartCol,
        span,
        el,
        mode,
        currentStartCol: origStartCol,
        currentSpan:     span,
        moved: false,
      };
      setDragging(true);
    };
  }

  function onHandlePointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const dxPx = e.clientX - d.startX;
    const dxCols = Math.round(dxPx / colPx);

    let newStartCol = d.startCol;
    let newSpan     = d.span;

    if (d.mode === 'translate') {
      newStartCol = d.startCol + dxCols;
      if (newStartCol < 0) newStartCol = 0;
      if (newStartCol + d.span - 1 > totalDays - 1) newStartCol = totalDays - 1 - (d.span - 1);
    } else if (d.mode === 'resize-start') {
      newStartCol = d.startCol + dxCols;
      if (newStartCol < 0) newStartCol = 0;
      if (newStartCol > d.startCol + d.span - 1) newStartCol = d.startCol + d.span - 1;
      newSpan = d.span - (newStartCol - d.startCol);
    } else if (d.mode === 'resize-end') {
      newSpan = d.span + dxCols;
      if (newSpan < 1) newSpan = 1;
      if (d.startCol + newSpan - 1 > totalDays - 1) newSpan = totalDays - d.startCol;
    }

    if (newStartCol === d.currentStartCol && newSpan === d.currentSpan) return;
    d.currentStartCol = newStartCol;
    d.currentSpan     = newSpan;
    d.moved = d.moved || newStartCol !== d.startCol || newSpan !== d.span;

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => applyVisual(newStartCol, newSpan));
  }

  function endDrag(commit) {
    const d = dragRef.current;
    if (!d) return;
    try { d.el.releasePointerCapture?.(d.pointerId); } catch {}
    dragRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setDragging(false);

    if (!commit || !d.moved) {
      applyVisual(origStartCol, span);
      return;
    }

    const newStart = addDaysIso(rangeStart, d.currentStartCol);
    const newDue   = addDaysIso(rangeStart, d.currentStartCol + d.currentSpan - 1);

    // rescheduleTask (passed via onUpdate) returns a Promise and handles revert internally.
    Promise.resolve(onUpdate({ start: newStart, due: newDue })).then((result) => {
      if (result && result.ok === false) {
        toast({ type: 'error', title: 'Reschedule failed', body: result.error || 'Update did not persist.' });
        applyVisual(origStartCol, span);
      } else if (!result?.noop) {
        toast({
          type:  'success',
          title: 'Rescheduled',
          body:  `${truncate(task.name, 48)} → ${newStart}${newStart !== newDue ? ` → ${newDue}` : ''}`,
        });
      }
    }).catch((err) => {
      console.error('Reschedule failed', err);
      applyVisual(origStartCol, span);
      toast({ type: 'error', title: 'Reschedule failed', body: err?.message || 'Try again.' });
    });
  }

  const onHandlePointerDown = makePointerDown('translate');
  function onHandlePointerUp()      { endDrag(true);  }
  function onHandlePointerCancel()  { endDrag(false); }
  const onResizeStartPointerDown = makePointerDown('resize-start');
  const onResizeEndPointerDown   = makePointerDown('resize-end');

  // Bar position when not dragging — React-controlled. During drag, mutated via ref.
  const barLeft  = origStartCol * colPx + 3;
  const barWidth = span * colPx - 6;

  // Handle (16) + horizontal padding (12) + label natural width + pin badge (when pinned) + safety (8).
  const GRIP_W = 16, PAD = 20, SAFETY = 8;
  const PIN_BADGE_W = pinned ? 62 : 0;
  const expandedWidth = Math.max(barWidth, GRIP_W + PAD + naturalLabelPx + PIN_BADGE_W + SAFETY);
  const displayWidth  = (expanded && !dragging) ? expandedWidth : barWidth;

  function onBarClick(e) {
    if (dragging) return;
    // Grip's onClick stopPropagation prevents this firing from grip clicks.
    // Shift/Alt+click = toggle pin (power user). Plain click = open task detail.
    if (e.shiftKey || e.altKey) {
      onTogglePin?.();
      return;
    }
    onOpenDetail?.();
  }
  function onBarDoubleClick(e) {
    if (dragging) return;
    e.stopPropagation();
    const newStart = prompt('Start date (YYYY-MM-DD):', start);
    if (!newStart) return;
    const newDue = prompt('Due date (YYYY-MM-DD):', end);
    if (!newDue) return;
    try { onUpdate({ start: newStart, due: newDue }); }
    catch (err) { toast({ type: 'error', title: 'Update failed', body: err?.message || 'Try again.' }); }
  }

  return (
    <div
      className={`flex border-b group transition-all duration-200 ${dragging ? 'bg-s1/40' : 'hover:bg-s1/60'} ${dim ? 'opacity-30 hover:opacity-70' : 'opacity-100'}`}
      style={{ borderColor: 'var(--line-soft)' }}
    >
      <div className="shrink-0 px-3 py-1.5 border-r text-[12px] flex items-center gap-2" style={{ width: labelPx, borderColor: 'var(--line)' }}>
        <button
          onClick={onToggle}
          className={`w-3.5 h-3.5 rounded-[4px] border transition-colors duration-150 grid place-items-center ${task.done ? 'bg-accent-500 border-accent-500' : 'border-line-strong hover:border-ink-dim'}`}
          aria-label="Toggle"
        >
          {task.done && (
            <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-[#052E1F]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="2 6.5 5 9.5 10 3.5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenDetail?.(); }}
          className="flex-1 min-w-0 text-left cursor-pointer hover:text-accent-500 transition-colors duration-150"
          title={`${task.name} — click to open`}
        >
          <div className={`truncate ${task.done ? 'line-through text-ink-muted' : 'text-ink'}`}>{task.name}</div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-ink-muted mt-0.5 truncate">
            {member && <Avatar seed={member.email} name={member.name} size="xs" />}
            <span className="truncate">{member?.name || task.assignee} · {start === end ? start : `${start} → ${end}`}</span>
          </div>
        </button>
      </div>

      <div className="relative flex" style={{ width: colPx * totalDays, height: 40 }}>
        {dates.map((d, i) => {
          const dow = d.getDay();
          const weekend = dow === 0 || dow === 6;
          const iso = isoDay(d);
          const isToday  = iso === today;
          const isMonday = dow === 1;
          const isFirst  = d.getDate() === 1;
          return (
            <div
              key={i}
              className={`shrink-0 border-r ${weekend ? 'bg-canvas/30' : ''} ${isToday ? 'bg-accent-500/10' : ''}`}
              style={{
                width: colPx,
                borderColor: isFirst || isMonday ? 'var(--line-soft)' : 'transparent',
              }}
            />
          );
        })}

        {/* Original-position ghost outline (visible during drag) */}
        <div
          ref={ghostRef}
          className={`absolute top-2 bottom-2 rounded-md pointer-events-none border border-dashed transition-opacity duration-150 ${dragging ? 'opacity-100' : 'opacity-0'}`}
          style={{
            left:  barLeft,
            width: barWidth,
            borderColor: 'var(--line-strong)',
          }}
          aria-hidden="true"
        />

        {/* Target date chip (visible during drag) */}
        <div
          ref={chipRef}
          className={`absolute -top-1 chip chip-neutral !bg-elevated !border-line-strong shadow-e2 pointer-events-none tabular-nums z-20 transition-opacity duration-150 ${dragging ? 'opacity-100' : 'opacity-0'}`}
          style={{
            left:  barLeft,
            transform: 'translateY(-100%)',
          }}
          aria-hidden="true"
        >
          {start}{start !== end ? ` → ${end}` : ''}
        </div>

        {/* Hidden measurement node — gives us natural label width for smooth transitions */}
        <span
          ref={measureRef}
          aria-hidden="true"
          className="absolute -top-[9999px] -left-[9999px] text-[10.5px] whitespace-nowrap"
        >
          {task.name}
        </span>

        {/* The bar — click to pin, double-click to edit, hover to expand */}
        <div
          ref={barRef}
          role="button"
          tabIndex={0}
          aria-label={`${task.name}: ${start === end ? start : `${start} to ${end}`}, priority ${task.priority}${pinned ? ', pinned' : ''}`}
          aria-pressed={pinned}
          data-task-bar="true"
          data-pinned={pinned ? 'true' : 'false'}
          className={`group/bar absolute top-2 bottom-2 rounded-md flex items-center px-1 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
            dragging ? '' : 'transition-[left,width] duration-[220ms] ease-sleek cursor-pointer'
          } ${expanded && !dragging ? 'z-30 shadow-e2' : 'z-10'}`}
          style={{
            left:  barLeft,
            width: displayWidth,
            background: task.done ? 'rgba(156,163,175,0.22)' : colors.soft, // pale gray when done
            border:     `1px solid ${task.done ? 'rgba(156,163,175,0.55)' : (expanded ? colors.fill : colors.border)}`,
            opacity:    task.done ? 0.55 : 1,
            boxShadow:  !task.done && overdue ? `inset 0 0 0 1px #EF4444` : undefined,
            willChange: dragging ? 'left' : 'width',
          }}
          title={`${task.name}\n${start} → ${end}\nPriority: ${task.priority}\n${member?.name || task.assignee}\nClick: open detail · Shift+click: pin · Double-click: edit dates · Drag grip: reschedule`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={onBarClick}
          onDoubleClick={onBarDoubleClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTogglePin?.(); }
            if (e.key === 'Escape' && pinned) { onTogglePin?.(); }
          }}
        >
          {/* Left edge — drag to change START date only */}
          <button
            type="button"
            data-drag-handle="resize-start"
            aria-label={`Drag to change ${task.name} start date`}
            className={`absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize touch-none select-none opacity-0 group-hover/bar:opacity-100 hover:opacity-100 ${dragging ? '!opacity-100' : ''}`}
            style={{ background: `linear-gradient(to right, ${colors.fill}88, transparent)` }}
            onPointerDown={onResizeStartPointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerCancel}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            title="Drag to change start date"
          />

          {/* Drag handle (translate whole bar) — pointer events captured here */}
          <button
            type="button"
            data-drag-handle="true"
            aria-label={`Drag ${task.name} to reschedule`}
            className={`shrink-0 w-4 h-6 grid place-items-center rounded-sm touch-none select-none ml-1 ${dragging ? 'cursor-grabbing bg-white/10' : 'cursor-grab hover:bg-white/10'}`}
            style={{ color: colors.fill }}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerCancel}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <GripIcon />
          </button>

          {/* Right edge — drag to change DUE date only */}
          <button
            type="button"
            data-drag-handle="resize-end"
            aria-label={`Drag to change ${task.name} due date`}
            className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize touch-none select-none opacity-0 group-hover/bar:opacity-100 hover:opacity-100 ${dragging ? '!opacity-100' : ''}`}
            style={{ background: `linear-gradient(to left, ${colors.fill}88, transparent)` }}
            onPointerDown={onResizeEndPointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerCancel}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            title="Drag to change due date"
          />

          {/* Label — always rendered; bar's overflow:hidden clips it in compact mode */}
          <span className={`text-[10.5px] whitespace-nowrap ml-1 pointer-events-none transition-opacity duration-150 ${
            task.done ? 'line-through text-ink-muted' : 'text-ink'
          } ${expanded ? 'opacity-100' : (span >= 3 ? 'opacity-100' : 'opacity-0')}`}>
            {task.name}
          </span>

          {/* Pin badge — visible only when pinned */}
          {pinned && !dragging && (
            <span
              aria-hidden="true"
              className="ml-auto pl-2 shrink-0 inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-semibold text-accent-400 pointer-events-none"
            >
              <PinIcon /> pinned
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function GripIcon() {
  return (
    <svg viewBox="0 0 8 12" className="w-2 h-3" fill="currentColor" aria-hidden="true">
      <circle cx="2" cy="2"  r="1" />
      <circle cx="6" cy="2"  r="1" />
      <circle cx="2" cy="6"  r="1" />
      <circle cx="6" cy="6"  r="1" />
      <circle cx="2" cy="10" r="1" />
      <circle cx="6" cy="10" r="1" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="currentColor" aria-hidden="true">
      <path d="M7.5 1.2 6.7 2l1.4 1.4-3.3 1.7-1.5-1.5-.85.85L4.5 6.6 2 9.2v.6h.6L5.2 7.3l2.1 2.1.85-.85L6.7 7l1.7-3.3L9.8 5l.85-.85L7.5 1.2z" />
    </svg>
  );
}
