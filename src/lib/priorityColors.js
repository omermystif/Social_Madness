/**
 * Centralized priority → color mapping.
 * Used by TaskRow, TaskEditModal, GanttPage bars, CalendarPage events.
 *
 * Keep these in sync with PRIORITY_BAR in GanttPage and the Tailwind palette.
 */
export const PRIORITY_COLORS = {
  high: {
    fill:   '#EF4444', // red-500
    soft:   'rgba(239,68,68,0.18)',
    border: 'rgba(239,68,68,0.55)',
    glow:   '0 0 0 3px rgba(239,68,68,0.18)',
    label:  'High',
    dot:    '🔴',
    fg:     '#FFFFFF',
  },
  med: {
    fill:   '#F59E0B', // amber-500
    soft:   'rgba(245,158,11,0.18)',
    border: 'rgba(245,158,11,0.55)',
    glow:   '0 0 0 3px rgba(245,158,11,0.18)',
    label:  'Medium',
    dot:    '🟠',
    fg:     '#FFFFFF',
  },
  low: {
    fill:   '#10B981', // emerald-500
    soft:   'rgba(16,185,129,0.18)',
    border: 'rgba(16,185,129,0.55)',
    glow:   '0 0 0 3px rgba(16,185,129,0.18)',
    label:  'Low',
    dot:    '🟢',
    fg:     '#FFFFFF',
  },
};

export function priorityColor(priority) {
  return PRIORITY_COLORS[priority] || PRIORITY_COLORS.med;
}

export const PRIORITY_OPTIONS = [
  { value: 'high', label: 'High',   color: PRIORITY_COLORS.high.fill },
  { value: 'med',  label: 'Medium', color: PRIORITY_COLORS.med.fill  },
  { value: 'low',  label: 'Low',    color: PRIORITY_COLORS.low.fill  },
];
