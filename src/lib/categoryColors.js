/**
 * Shared task category palette. Used by:
 *   - CalendarPage (event color + filter chips)
 *   - TaskEditModal (tag picker)
 *   - GanttPage (optional category lens)
 *
 * A task's tag/category is stored on `task.category` after explicit selection.
 * For legacy tasks lacking a category, `categoryOf(task)` falls back to a
 * keyword heuristic against the task name + tags array.
 */

export const CATEGORIES = [
  'content',
  'design',
  'social',
  'ops',
  'event',
  'milestone',
  'meeting',
];

export const CAT_COLORS = {
  content:   '#8B5CF6',
  design:    '#EC4899',
  social:    '#06B6D4',
  ops:       '#F59E0B',
  event:     '#10B981',
  milestone: '#EF4444',
  meeting:   '#3B82F6',
};

export const CAT_LABELS = {
  content:   'Content',
  design:    'Design',
  social:    'Social',
  ops:       'Ops',
  event:     'Event',
  milestone: 'Milestone',
  meeting:   'Meeting',
};

/** Heuristic fallback when task has no explicit category. */
export function categoryOf(task) {
  if (task?.category && CAT_COLORS[task.category]) return task.category;
  const n = (task?.name || '').toLowerCase();
  const t = (task?.tags || []).map((x) => String(x).toLowerCase()).join(' ');
  const blob = `${n} ${t}`;
  if (/design|brand|asset/.test(blob))                  return 'design';
  if (/content|copy|blog|article/.test(blob))           return 'content';
  if (/social|post|tweet|ig|instagram|tiktok/.test(blob)) return 'social';
  if (/ops|admin|invoice|billing/.test(blob))           return 'ops';
  if (/event|launch|match|game/.test(blob))             return 'event';
  if (/milestone|deadline|deliverable/.test(blob))      return 'milestone';
  if (/meeting|sync|standup/.test(blob))                return 'meeting';
  return 'social';
}
