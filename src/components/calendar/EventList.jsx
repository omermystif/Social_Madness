import EventItem from '../ui/EventItem.jsx';

export default function EventList({ events, title, empty = 'No events.', action }) {
  return (
    <div className="card">
      {(title || action) && (
        <div className="flex items-center justify-between mb-2 px-1">
          {title && <div className="text-[13px] font-semibold tracking-tight">{title}</div>}
          {action}
        </div>
      )}
      {events.length === 0 ? (
        <div className="text-[12.5px] text-ink-muted py-8 text-center">{empty}</div>
      ) : (
        <div className="flex flex-col">
          {events.map((ev, i) => <EventItem key={ev.id || i} event={ev} />)}
        </div>
      )}
    </div>
  );
}
