// Asymmetric, calm metric. Title sits at top; large number; subtle hint + optional spark/chip.

const ACCENT = {
  default: { num: 'text-ink',     label: 'text-ink-dim' },
  ok:      { num: 'text-accent-400', label: 'text-ink-dim' },
  warn:    { num: 'text-[#FCD34D]',  label: 'text-ink-dim' },
  err:     { num: 'text-[#FCA5A5]',  label: 'text-ink-dim' },
};

export default function MetricCard({ label, value, hint, accent = 'default', trend, icon }) {
  const a = ACCENT[accent] || ACCENT.default;
  return (
    <div className="card card-hover">
      <div className="flex items-start justify-between">
        <div className={`text-[10.5px] font-semibold uppercase tracking-[0.06em] ${a.label}`}>{label}</div>
        {icon && <div className="text-ink-muted">{icon}</div>}
      </div>
      <div className={`mt-3 text-[28px] leading-none font-semibold tracking-tighter tabular-nums ${a.num}`}>
        {value}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {hint && <div className="text-[11.5px] text-ink-muted truncate">{hint}</div>}
        {trend && <div className="text-[11px] text-accent-400 font-medium tabular-nums">{trend}</div>}
      </div>
    </div>
  );
}
