import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../../lib/theme.js';

/**
 * Compact theme toggle:
 *  - Single click → flips dark ↔ light.
 *  - Long-press / right-click / caret → opens preference popover (Light / Dark / System).
 */
export default function ThemeToggle() {
  const { pref, resolved, setPreference, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!containerRef.current?.contains(e.target)) setOpen(false); }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative flex items-center">
      <button
        onClick={toggleTheme}
        onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}
        className="btn btn-ghost btn-sm !h-8 !w-8 !p-0"
        title={`Theme: ${pref}${pref === 'system' ? ` (${resolved})` : ''} — click to flip, right-click for options`}
        aria-label={`Toggle theme (currently ${resolved})`}
      >
        {resolved === 'dark' ? <MoonIcon /> : <SunIcon />}
      </button>
      <button
        onClick={() => setOpen(v => !v)}
        className="btn btn-ghost btn-sm !h-8 !w-4 !p-0 -ml-1 text-ink-faint hover:text-ink"
        aria-label="Theme preferences"
        title="Theme preferences"
      >
        <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] surface py-1 z-50 shadow-e2 animate-slide-up w-44">
          <PrefItem label="Light"  icon={<SunIcon />}     active={pref === 'light'}  onClick={() => { setPreference('light');  setOpen(false); }} />
          <PrefItem label="Dark"   icon={<MoonIcon />}    active={pref === 'dark'}   onClick={() => { setPreference('dark');   setOpen(false); }} />
          <PrefItem label="System" icon={<SystemIcon />}  active={pref === 'system'} onClick={() => { setPreference('system'); setOpen(false); }} sub={pref === 'system' ? `now ${resolved}` : null} />
        </div>
      )}
    </div>
  );
}

function PrefItem({ label, icon, active, onClick, sub }) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-1.5 text-[12.5px] flex items-center gap-2.5 hover:bg-s1 ${active ? 'text-ink' : 'text-ink-dim'}`}
    >
      <span className={`w-4 h-4 grid place-items-center ${active ? 'text-accent-500' : 'text-ink-faint'}`}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {sub && <span className="text-[10.5px] text-ink-faint">{sub}</span>}
      {active && <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="3.2" />
      <line x1="8" y1="1.5" x2="8" y2="3" />
      <line x1="8" y1="13" x2="8" y2="14.5" />
      <line x1="1.5" y1="8" x2="3" y2="8" />
      <line x1="13" y1="8" x2="14.5" y2="8" />
      <line x1="3.4" y1="3.4" x2="4.5" y2="4.5" />
      <line x1="11.5" y1="11.5" x2="12.6" y2="12.6" />
      <line x1="3.4" y1="12.6" x2="4.5" y2="11.5" />
      <line x1="11.5" y1="4.5" x2="12.6" y2="3.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 9.4a5.6 5.6 0 1 1-6.9-6.9 4.5 4.5 0 0 0 6.9 6.9z" />
    </svg>
  );
}
function SystemIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="8" rx="1.2" />
      <line x1="5" y1="14" x2="11" y2="14" />
      <line x1="8" y1="11" x2="8" y2="14" />
    </svg>
  );
}
