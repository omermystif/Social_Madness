import { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { motion, AnimatePresence } from 'framer-motion';

import { Backdrop, Field } from '../ui/DeployModal.jsx';
import MembersFilter from '../calendar/MembersFilter.jsx';
import { useTasks } from '../../context/TaskContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { syncEvents, createEvent, listCalendars } from '../../api/calendarApi.js';
import { useToast } from '../../context/ToastContext.jsx';
import { openTask } from '../../lib/taskFocus.js';
import { useMemberFilter } from '../../lib/memberFilter.js';
import { PRIORITY_COLORS } from '../../lib/priorityColors.js';
import { CATEGORIES, CAT_COLORS, CAT_LABELS, categoryOf } from '../../lib/categoryColors.js';

const SELECTED_KEY = 'selected_calendars';
const VIEW_KEY     = 'calendar_view_pref';

export default function CalendarPage() {
  const { tasks, rescheduleTask, addTask, team } = useTasks();
  const { selected: selectedMembers, isFiltered: memberFiltered } = useMemberFilter();
  const { user, login } = useAuth();
  const { push: toast } = useToast();
  const calRef = useRef(null);

  const [view, setView]                       = useState(() => localStorage.getItem(VIEW_KEY) || 'dayGridMonth');
  const [calendars, setCalendars]             = useState([]);
  const [selectedIds, setSelectedIds]         = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(SELECTED_KEY) || '[]')); }
    catch { return new Set(); }
  });
  const [eventsByCalendar, setEventsByCalendar] = useState({});
  const [showAdd, setShowAdd]   = useState(false);
  const [addDate, setAddDate]   = useState(null);
  const [syncing, setSyncing]   = useState(false);
  const [activeCats, setActiveCats] = useState(new Set(Object.keys(CAT_COLORS)));

  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);

  // Load remote calendar list
  useEffect(() => {
    if (!user) { setCalendars([]); setEventsByCalendar({}); return; }
    listCalendars()
      .then(cals => {
        setCalendars(cals);
        setSelectedIds(prev => prev.size > 0 ? prev : new Set(cals.map(c => c.id)));
      })
      .catch(err => {
        console.error(err);
        toast({ type: 'error', title: 'Could not list calendars', body: err.message });
      });
  }, [user, toast]);

  useEffect(() => {
    try { localStorage.setItem(SELECTED_KEY, JSON.stringify([...selectedIds])); } catch {}
  }, [selectedIds]);

  // Sync remote events
  useEffect(() => {
    if (!user || calendars.length === 0) return;
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const end   = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59).toISOString();
    const targets = calendars.filter(c => selectedIds.has(c.id));

    setSyncing(true);
    Promise.all(targets.map(cal =>
      syncEvents({ calendarId: cal.id, initialTimeMin: start, initialTimeMax: end })
        .then(({ items }) => ({
          calId: cal.id,
          items: items
            .filter(e => e.status !== 'cancelled')
            .map(e => ({ ...e, _cal: cal })),
        }))
        .catch(err => {
          console.error(`Sync ${cal.summary} failed`, err);
          return { calId: cal.id, items: [] };
        })
    )).then(results => {
      const map = {};
      results.forEach(r => { map[r.calId] = r.items; });
      setEventsByCalendar(map);
    }).finally(() => setSyncing(false));
  }, [user, calendars, selectedIds]);

  const remoteEvents = useMemo(() => Object.values(eventsByCalendar).flat(), [eventsByCalendar]);

  // Build unified FullCalendar event list
  const fcEvents = useMemo(() => {
    const localEvents = tasks.filter(t => t.due).map(t => {
      const cat = categoryOf(t);
      const pri = PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.med;
      const memberMatch = !memberFiltered || selectedMembers.has(t.assignee);
      // Done tasks → muted gray + strikethrough (regardless of priority).
      const bg = t.done ? '#9CA3AF' : pri.fill; // gray-400
      const fg = t.done ? '#F3F4F6' : pri.fg;
      const classes = [];
      classes.push(memberMatch ? 'cal-event-active' : 'cal-event-dim');
      if (t.done) classes.push('cal-event-done');
      return {
        id: `local-${t.id}`,
        title: t.name,
        start: t.start || t.due,
        end:   t.due,
        allDay: true,
        backgroundColor: bg,
        borderColor: bg,
        textColor: fg,
        classNames: classes,
        extendedProps: {
          local: true,
          taskId: t.id,
          category: cat,
          assignee: t.assignee,
          priority: t.priority,
          done: t.done,
          memberMatch,
        },
      };
    }).filter(e => activeCats.has(e.extendedProps.category));

    const remote = remoteEvents.map(ev => ({
      id: `remote-${ev.id}`,
      title: ev.summary || '(no title)',
      start: ev.start?.dateTime || ev.start?.date,
      end:   ev.end?.dateTime   || ev.end?.date,
      allDay: !ev.start?.dateTime,
      backgroundColor: ev._cal?.backgroundColor || '#3B82F6',
      borderColor: ev._cal?.backgroundColor || '#3B82F6',
      url: ev.htmlLink,
      extendedProps: {
        local: false,
        calName: ev._cal?.summaryOverride || ev._cal?.summary,
        description: ev.description,
      },
    }));

    return [...localEvents, ...remote];
  }, [tasks, remoteEvents, activeCats, memberFiltered, selectedMembers]);

  // Heatmap counts (12 weeks rolling)
  const heatmapData = useMemo(() => {
    const c = {};
    tasks.filter(t => t.due).forEach(t => { c[t.due] = (c[t.due] || 0) + 1; });
    remoteEvents.forEach(ev => {
      const d = ev.start?.dateTime || ev.start?.date;
      if (d) {
        const iso = new Date(d).toISOString().slice(0, 10);
        c[iso] = (c[iso] || 0) + 1;
      }
    });
    return c;
  }, [tasks, remoteEvents]);

  function toggleCal(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleCat(cat) {
    setActiveCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  function changeView(v) {
    setView(v);
    if (calRef.current) calRef.current.getApi().changeView(v);
  }

  function handleDateClick(arg) {
    // Default behavior: create a quick local task on this date.
    // (Holding Shift opens the Google Calendar event creation modal instead.)
    if (arg.jsEvent?.shiftKey) {
      setAddDate(arg.dateStr);
      setShowAdd(true);
      return;
    }
    const name = window.prompt(`New task on ${arg.dateStr}:`, '');
    if (!name || !name.trim()) return;
    addTask({
      name: name.trim(),
      assignee: team[0]?.email || 'you@boxmadness.com',
      priority: 'med',
      start: arg.dateStr,
      due: arg.dateStr,
    });
    toast({ type: 'success', title: 'Task created', body: `${name} · ${arg.dateStr}` });
  }

  function handleEventDrop(info) {
    const ext = info.event.extendedProps;
    if (!ext.local || !ext.taskId) {
      info.revert();
      return;
    }
    const newDue = info.event.endStr || info.event.startStr;
    rescheduleTask(ext.taskId, { due: newDue.slice(0, 10), start: info.event.startStr.slice(0, 10) })
      .then(r => {
        if (!r?.ok) {
          info.revert();
          toast({ type: 'error', title: 'Reschedule failed', body: r?.error || 'unknown' });
        } else {
          toast({ type: 'success', title: 'Rescheduled', body: info.event.title });
        }
      })
      .catch(err => { info.revert(); toast({ type: 'error', title: 'Reschedule failed', body: err.message }); });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
      className="space-y-4"
    >
      {/* Hero header */}
      <div className="premium-card p-5">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-page text-ink">
                <span className="text-gradient">Calendar</span>
              </h1>
              {syncing && <span className="live-indicator">syncing</span>}
            </div>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              {fcEvents.length} event{fcEvents.length === 1 ? '' : 's'} ·{' '}
              {selectedIds.size}/{calendars.length || 0} calendar{calendars.length === 1 ? '' : 's'} ·{' '}
              {activeCats.size}/{Object.keys(CAT_COLORS).length} categories
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!user
              ? <button onClick={login} className="btn btn-gradient btn-sm">Connect Google</button>
              : <span className="chip chip-ok">Google connected</span>
            }
          </div>
        </div>

        {/* Category filter chips */}
        <div className="flex flex-wrap gap-2 mt-4">
          {Object.entries(CAT_COLORS).map(([cat, color]) => {
            const on = activeCats.has(cat);
            return (
              <motion.button
                key={cat}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => toggleCat(cat)}
                className={`cat-chip cat-${cat}`}
                style={{ opacity: on ? 1 : 0.35 }}
              >
                <span className="cat-dot" />
                {cat}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* View switcher */}
      <div className="glass-card p-2 flex items-center gap-1">
        {[
          ['dayGridMonth', 'Month'],
          ['timeGridWeek', 'Week'],
          ['timeGridDay',  'Day'],
          ['listWeek',     'Agenda'],
        ].map(([key, label]) => (
          <motion.button
            key={key}
            whileTap={{ scale: 0.97 }}
            onClick={() => changeView(key)}
            className={`btn btn-sm ${view === key ? 'btn-gradient' : 'btn-ghost'}`}
          >
            {label}
          </motion.button>
        ))}
        <div className="flex-1" />
        <motion.button whileTap={{ scale: 0.97 }} onClick={() => calRef.current?.getApi().today()} className="btn btn-secondary btn-sm">Today</motion.button>
        <motion.button whileTap={{ scale: 0.97 }} onClick={() => calRef.current?.getApi().prev()} className="btn-icon" aria-label="Previous">‹</motion.button>
        <motion.button whileTap={{ scale: 0.97 }} onClick={() => calRef.current?.getApi().next()} className="btn-icon" aria-label="Next">›</motion.button>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Sidebar: members filter (global, applies to Calendar + Gantt + Tasks) */}
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <MembersFilter />
        </div>

        {/* Main calendar */}
        <div className="col-span-12 lg:col-span-9">
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            className="card !p-3"
          >
            <FullCalendar
              ref={calRef}
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
              initialView={view}
              headerToolbar={false}
              height="auto"
              events={fcEvents}
              editable={true}
              droppable={true}
              selectable={true}
              dayMaxEvents={3}
              nowIndicator={true}
              dateClick={handleDateClick}
              eventDrop={handleEventDrop}
              eventResize={handleEventDrop}
              eventClick={(info) => {
                if (info.event.extendedProps.local && info.event.extendedProps.taskId) {
                  info.jsEvent.preventDefault();
                  openTask(info.event.extendedProps.taskId);
                }
              }}
            />
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {showAdd && (
          <AddEventModal
            date={addDate}
            calendars={calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')}
            onClose={() => setShowAdd(false)}
            onCreated={(ev, cal) =>
              setEventsByCalendar(prev => ({ ...prev, [cal.id]: [...(prev[cal.id] || []), { ...ev, _cal: cal }] }))
            }
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Calendar picker ────────────────────────────────────────────────────────
function CalendarPicker({ calendars, selectedIds, onToggle, onSelectAll, eventsByCalendar }) {
  const allOn = selectedIds.size === calendars.length;
  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="card">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-section">Calendars</div>
        <button onClick={() => onSelectAll(!allOn)} className="text-[11px] text-ink-muted hover:text-ink">
          {allOn ? 'None' : 'All'}
        </button>
      </div>
      <div className="flex flex-col gap-0.5 max-h-[280px] overflow-y-auto">
        {calendars.map(cal => {
          const count = (eventsByCalendar[cal.id] || []).length;
          const on    = selectedIds.has(cal.id);
          return (
            <motion.label
              whileHover={{ x: 2 }}
              key={cal.id}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-s1 cursor-pointer transition-colors"
            >
              <input type="checkbox" checked={on} onChange={() => onToggle(cal.id)} className="h-3.5 w-3.5 shrink-0" />
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: cal.backgroundColor || '#10B981', opacity: on ? 1 : 0.4 }} />
              <span className={`text-[12px] truncate flex-1 ${on ? 'text-ink' : 'text-ink-muted'}`} title={cal.summary}>
                {cal.summaryOverride || cal.summary}
              </span>
              {cal.primary && <span className="text-[9px] uppercase tracking-wider text-ink-faint">primary</span>}
              {count > 0 && <span className="text-[10px] text-ink-muted tabular-nums">{count}</span>}
            </motion.label>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─── Add Event Modal ────────────────────────────────────────────────────────
function AddEventModal({ date, calendars, onClose, onCreated }) {
  const writable = calendars || [];
  const defaultCal = writable.find(c => c.primary) || writable[0];
  const [summary, setSummary]   = useState('');
  const [time, setTime]         = useState('09:00');
  const [duration, setDuration] = useState(30);
  const [calId, setCalId]       = useState(defaultCal?.id || 'primary');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const start = new Date(`${date}T${time}:00`);
      const end   = new Date(start.getTime() + duration * 60000);
      const ev = await createEvent(calId, {
        summary,
        start: { dateTime: start.toISOString() },
        end:   { dateTime: end.toISOString() },
      });
      const cal = writable.find(c => c.id === calId) || { id: calId, summary: 'Selected calendar' };
      onCreated?.(ev, cal);
      onClose();
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  }

  return (
    <Backdrop onClose={onClose}>
      <motion.form
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.96 }}
        transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="glass-strong w-full max-w-md rounded-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--line)' }}>
          <div>
            <div className="text-[13.5px] font-semibold">New event</div>
            <div className="text-[11.5px] text-ink-muted">{date}</div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm !h-7 !w-7 !p-0">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <Field label="Title" htmlFor="ev-title">
            <input id="ev-title" autoFocus required value={summary} onChange={e => setSummary(e.target.value)} className="input input-lg" placeholder="Sprint planning" />
          </Field>
          {writable.length > 1 && (
            <Field label="Calendar">
              <select value={calId} onChange={e => setCalId(e.target.value)} className="input">
                {writable.map(c => <option key={c.id} value={c.id}>{c.summaryOverride || c.summary}{c.primary ? ' (primary)' : ''}</option>)}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts"><input type="time" value={time} onChange={e => setTime(e.target.value)} className="input" /></Field>
            <Field label="Duration (min)"><input type="number" min="5" step="5" value={duration} onChange={e => setDuration(+e.target.value)} className="input" /></Field>
          </div>
          {err && <div className="chip chip-err">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--line)' }}>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
          <button disabled={busy} className="btn btn-gradient btn-sm">{busy ? 'Creating…' : 'Create event'}</button>
        </div>
      </motion.form>
    </Backdrop>
  );
}
