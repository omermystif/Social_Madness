import { useState } from 'react';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function MiniCalendar({ markedDates = new Set(), countsByDate = {}, onPickDate, selectedDate }) {
  const [cursor, setCursor] = useState(() => {
    const d = selectedDate ? new Date(selectedDate) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year  = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days  = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);

  function iso(d) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="btn btn-ghost btn-sm !h-7 !w-7 !p-0"
          aria-label="Previous month"
        >
          <ChevL />
        </button>
        <div className="text-[13px] font-semibold tracking-tight">
          {cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <button
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          className="btn btn-ghost btn-sm !h-7 !w-7 !p-0"
          aria-label="Next month"
        >
          <ChevR />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-medium uppercase tracking-[0.06em] text-ink-faint mb-2">
        {DAYS.map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-[12.5px]">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const dateStr   = iso(d);
          const marked    = markedDates.has(dateStr);
          const count     = countsByDate[dateStr] || 0;
          const isSelected = selectedDate === dateStr;
          const isToday    = dateStr === today;
          return (
            <button
              key={i}
              onClick={() => onPickDate?.(dateStr)}
              className={`relative h-9 w-9 mx-auto rounded-md transition-all duration-150 tabular-nums ${
                isSelected
                  ? 'bg-accent-500 text-[#052E1F] font-semibold'
                  : isToday
                    ? 'bg-s2 text-ink ring-1 ring-line-strong'
                    : marked
                      ? 'text-ink hover:bg-s1'
                      : 'text-ink-dim hover:bg-s1'
              }`}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={isSelected}
            >
              {d}
              {marked && !isSelected && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                  {Array.from({ length: Math.min(count || 1, 3) }).map((_, j) => (
                    <span key={j} className="block w-1 h-1 rounded-full bg-accent-500" />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChevL() {
  return <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="10 4 6 8 10 12" /></svg>;
}
function ChevR() {
  return <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 4 10 8 6 12" /></svg>;
}
