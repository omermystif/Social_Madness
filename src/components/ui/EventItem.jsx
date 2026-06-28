const COLOR_SEEDS = ['#10B981', '#3B82F6', '#A78BFA', '#F59E0B', '#EF4444', '#06B6D4'];

function dotFor(ev) {
  const src = ev.id || ev.summary || '';
  let h = 0; for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
  return COLOR_SEEDS[Math.abs(h) % COLOR_SEEDS.length];
}

export default function EventItem({ event }) {
  const start = event.start?.dateTime || event.start?.date;
  const time = start
    ? (event.start?.dateTime
        ? new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'All day')
    : '';
  const color = dotFor(event);

  return (
    <div className="group flex items-center gap-3 px-3 py-2 rounded-md hover:bg-s1 transition-colors duration-150">
      <span className="dot shrink-0" style={{ background: color, boxShadow: `0 0 0 3px ${color}1f` }} />
      <div className="text-[11.5px] text-ink-muted tabular-nums w-16 shrink-0">{time}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-ink truncate">{event.summary || '(no title)'}</div>
        {event.description && (
          <div className="text-[11.5px] text-ink-muted truncate">{event.description}</div>
        )}
      </div>
    </div>
  );
}
