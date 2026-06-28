import { useRef, useState } from 'react';
import { useTasks, resolveCurrentMember } from '../../context/TaskContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import Avatar from './Avatar.jsx';
import TaskEditModal from './TaskEditModal.jsx';

const PRIORITY_CLASS = { high: 'dot-high', med: 'dot-med', low: 'dot-low' };

export default function TaskRow({ task, dense = false }) {
  const {
    toggleTask, completeTask, uncompleteTask,
    reassign, removeTask, deleteTaskWithCleanup, team, updateTask,
    rescheduleTask, retryTaskSync, taskSyncStatus,
  } = useTasks();
  const { profile } = useAuth();

  const member = team.find(m => m.email === task.assignee);
  const today  = new Date().toISOString().slice(0, 10);
  const overdue = !task.done && task.due && task.due < today;

  const currentMember = resolveCurrentMember(team, profile);
  const sync = taskSyncStatus?.[task.id] || { state: 'idle' };
  const hasMyMarker = !!(currentMember && task.personalSync?.[currentMember.email]?.eventId);

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName]     = useState(task.name);
  const [editingDate, setEditingDate] = useState(false);
  const [modalOpen, setModalOpen]     = useState(false);
  const dateInputRef = useRef(null);

  const dueLabel = formatDue(task.due);

  function saveName() {
    setEditingName(false);
    if (draftName.trim() && draftName !== task.name) updateTask(task.id, { name: draftName.trim() });
    else setDraftName(task.name);
  }

  function saveInlineDue(newDue) {
    setEditingDate(false);
    if (!newDue || newDue === task.due) return;
    // Inline date editor only changes the due date. Start follows if it would exceed due.
    const newStart = (task.start || task.due) > newDue ? newDue : (task.start || task.due);
    rescheduleTask(
      task.id,
      { start: newStart, due: newDue },
      { memberEmail: currentMember?.email },
    );
  }

  return (
    <>
      <div
        data-task-id={task.id}
        data-done={task.done ? 'true' : 'false'}
        className={`group flex items-center gap-3 px-3 ${dense ? 'py-1.5' : 'py-2'} rounded-md hover:bg-s1 border border-transparent hover:border-line transition-[opacity,background-color,border-color] duration-200 ease-sleek ${
          task.done ? 'opacity-60' : 'opacity-100'
        }`}
      >
        <button
          onClick={() => toggleTask(task.id)}
          className={`relative w-4 h-4 rounded-[5px] shrink-0 border transition-all duration-150 ${
            task.done
              ? 'bg-accent-500 border-accent-500'
              : 'border-line-strong hover:border-ink-dim'
          }`}
          aria-pressed={task.done}
          aria-label={task.done ? 'Mark incomplete' : 'Mark complete'}
        >
          {task.done && (
            <svg viewBox="0 0 16 16" className="absolute inset-0 w-full h-full text-[#052E1F]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 8.5 7 12 13 4" />
            </svg>
          )}
        </button>

        <span className={`dot ${PRIORITY_CLASS[task.priority] || ''}`} title={task.priority} aria-label={`Priority: ${task.priority}`} />

        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              autoFocus
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => {
                if (e.key === 'Enter') saveName();
                if (e.key === 'Escape') { setDraftName(task.name); setEditingName(false); }
              }}
              className="input h-7 -my-1 text-[13px] bg-surface"
            />
          ) : (
            <div
              onDoubleClick={() => setEditingName(true)}
              className={`text-[13px] truncate ${task.done ? 'line-through text-ink-muted' : 'text-ink'}`}
              title={task.name}
            >
              {task.name}
            </div>
          )}
        </div>

        <div className="hidden md:flex items-center gap-2 shrink-0">
          <Avatar seed={task.assignee} name={member?.name || task.assignee} size="xs" />
          <select
            value={task.assignee}
            onChange={e => reassign(task.id, e.target.value)}
            className="bg-transparent border-0 text-[12px] text-ink-dim hover:text-ink focus:outline-none cursor-pointer max-w-[120px]"
            title={member?.role || ''}
            aria-label="Reassign"
          >
            {team.map(m => (
              <option key={m.email} value={m.email} className="bg-surface text-ink">{m.name}</option>
            ))}
          </select>
        </div>

        {/* Sync status badge — visible only for tasks the current user owns + has synced */}
        {(hasMyMarker || sync.state === 'syncing' || sync.state === 'failed') && (
          <SyncBadge
            state={sync.state === 'idle' ? (hasMyMarker ? 'synced' : 'idle') : sync.state}
            error={sync.error}
            onRetry={() => retryTaskSync(task.id, currentMember?.email)}
          />
        )}

        {/* Inline due-date editor: click chip to open native date picker. */}
        {editingDate ? (
          <input
            ref={dateInputRef}
            type="date"
            defaultValue={task.due}
            autoFocus
            onBlur={(e) => saveInlineDue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveInlineDue(e.currentTarget.value);
              if (e.key === 'Escape') setEditingDate(false);
            }}
            className="input !h-6 !text-[11px] !px-1.5 !w-[120px] tabular-nums shrink-0"
            min={task.start || undefined}
          />
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setEditingDate(true); }}
            className={`text-[11.5px] tabular-nums w-14 text-right shrink-0 rounded px-1 hover:bg-s2 transition-colors duration-150 ${
              overdue ? 'text-[#FCA5A5] font-semibold' : 'text-ink-muted hover:text-ink'
            }`}
            title={`${task.due} · click to reschedule`}
            aria-label={`Due ${task.due}. Click to edit.`}
          >
            {dueLabel}
          </button>
        )}

        {/* Row-end actions */}
        <div className="flex items-center gap-0.5 shrink-0 ml-1">
          <button
            onClick={(e) => { e.stopPropagation(); setModalOpen(true); }}
            className="w-6 h-6 rounded-md grid place-items-center text-ink-faint hover:text-ink hover:bg-s2 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            title="Edit task"
            aria-label="Edit task"
          >
            <PencilIcon />
          </button>
          {task.done ? (
            <button
              onClick={(e) => { e.stopPropagation(); uncompleteTask(task.id); }}
              className="w-6 h-6 rounded-md grid place-items-center text-ink-faint hover:text-[#93C5FD] hover:bg-blue-500/10 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              title="Restore to open"
              aria-label="Restore task to open"
            >
              <RestoreIcon />
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); completeTask(task.id); }}
              className="w-6 h-6 rounded-md grid place-items-center text-ink-faint hover:text-accent-400 hover:bg-accent-500/10 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              title="Mark complete"
              aria-label="Mark complete"
            >
              <CheckIcon />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!confirm(`Permanently delete "${truncateForConfirm(task.name)}"?\n\nLinked calendar events will be removed.\nThis action cannot be undone.`)) return;
              const fn = deleteTaskWithCleanup || ((id) => Promise.resolve(removeTask(id)));
              fn(task.id);
            }}
            className="w-6 h-6 rounded-md grid place-items-center text-ink-faint hover:text-[#FCA5A5] hover:bg-red-500/10 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            title="Delete task"
            aria-label="Delete task"
          >
            <XIcon />
          </button>
        </div>
      </div>

      {modalOpen && <TaskEditModal taskId={task.id} onClose={() => setModalOpen(false)} />}
    </>
  );
}

function SyncBadge({ state, error, onRetry }) {
  if (state === 'idle') return null;
  const map = {
    pending:  { cls: 'chip-neutral', icon: <DotIcon color="#71717A" />,         text: 'Pending' },
    syncing:  { cls: 'chip-info',    icon: <DotIcon color="#3B82F6" pulse />,  text: 'Syncing…' },
    synced:   { cls: 'chip-ok',      icon: <DotIcon color="#10B981" />,        text: 'Synced' },
    failed:   { cls: 'chip-err',     icon: <DotIcon color="#EF4444" />,        text: 'Sync failed' },
  };
  const s = map[state] || map.synced;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (state === 'failed') onRetry(); }}
      className={`chip ${s.cls} !h-[20px] !text-[10px] shrink-0 ${state === 'failed' ? 'cursor-pointer hover:!border-line-strong' : 'cursor-default'}`}
      title={state === 'failed' ? `${error || 'Sync failed'} — click to retry` : s.text}
      aria-label={`Calendar ${s.text}`}
    >
      {s.icon} {state === 'failed' ? 'Retry' : s.text}
    </button>
  );
}

function DotIcon({ color, pulse }) {
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${pulse ? 'animate-pulse' : ''}`}
      style={{ background: color, boxShadow: `0 0 0 3px ${color}22` }}
    />
  );
}

function truncateForConfirm(s) { return s && s.length > 60 ? s.slice(0, 59) + '…' : s; }

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 8.5 7 12 13 4" />
    </svg>
  );
}
function RestoreIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8a5 5 0 1 0 1.6-3.7" />
      <polyline points="2.5 3 2.5 6 5.5 6" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="3" x2="13" y2="13" />
      <line x1="13" y1="3" x2="3" y2="13" />
    </svg>
  );
}

function formatDue(due) {
  if (!due) return '';
  const d = new Date(due);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: '2-digit' }) });
}
