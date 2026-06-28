import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * GitHub-style activity heatmap.
 * Props:
 *   data:  { 'YYYY-MM-DD': count }
 *   weeks: number of weeks to show (default 12)
 */
export default function ActivityHeatmap({ data = {}, weeks = 12 }) {
  const [hover, setHover] = useState(null);

  const cells = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Roll back to start of this week (Sunday)
    const startOfThisWeek = new Date(today);
    startOfThisWeek.setDate(today.getDate() - today.getDay());

    // Build weeks columns
    const cols = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(startOfThisWeek);
        date.setDate(startOfThisWeek.getDate() - w * 7 + d);
        const iso = date.toISOString().slice(0, 10);
        col.push({ iso, count: data[iso] || 0, date, future: date > today });
      }
      cols.push(col);
    }
    return cols;
  }, [data, weeks]);

  const maxCount = useMemo(() => Math.max(1, ...Object.values(data)), [data]);
  const level = (count) => {
    if (!count) return 0;
    const r = count / maxCount;
    if (r > 0.75) return 4;
    if (r > 0.50) return 3;
    if (r > 0.25) return 2;
    return 1;
  };

  const total = useMemo(() => Object.values(data).reduce((a, b) => a + b, 0), [data]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-section">Activity</div>
          <div className="text-[10.5px] text-ink-muted mt-0.5">{total} events · last {weeks} weeks</div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-ink-faint">
          <span>less</span>
          {[0, 1, 2, 3, 4].map(l => (
            <span key={l} className={`heat-${l}`} style={{ width: 8, height: 8, borderRadius: 2 }} />
          ))}
          <span>more</span>
        </div>
      </div>
      <div className="flex gap-[3px]">
        {cells.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[3px]">
            {col.map((cell) => (
              <motion.div
                key={cell.iso}
                whileHover={{ scale: 1.4, zIndex: 5 }}
                onMouseEnter={() => setHover(cell)}
                onMouseLeave={() => setHover(null)}
                className={cell.future ? '' : `heat-${level(cell.count)}`}
                style={{
                  width: 12, height: 12,
                  borderRadius: 3,
                  opacity: cell.future ? 0.15 : 1,
                  background: cell.future ? 'var(--surface-1)' : undefined,
                  cursor: cell.future ? 'default' : 'pointer',
                }}
                title={`${cell.iso}: ${cell.count} event${cell.count === 1 ? '' : 's'}`}
              />
            ))}
          </div>
        ))}
      </div>
      {hover && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 pt-3 border-t text-[11px]"
          style={{ borderColor: 'var(--line)' }}
        >
          <span className="text-ink font-medium">{hover.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          <span className="text-ink-muted ml-2">{hover.count} event{hover.count === 1 ? '' : 's'}</span>
        </motion.div>
      )}
    </motion.div>
  );
}
