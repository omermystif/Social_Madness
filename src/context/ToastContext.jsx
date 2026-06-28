import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) { clearTimeout(tm); timers.current.delete(id); }
  }, []);

  const push = useCallback((toast) => {
    const id = (crypto?.randomUUID?.() || String(Math.random())) + '';
    const t = { id, type: 'info', ttl: 3500, ...toast };
    setToasts((ts) => [...ts, t].slice(-5));
    if (t.ttl) {
      const tm = setTimeout(() => dismiss(id), t.ttl);
      timers.current.set(id, tm);
    }
    return id;
  }, [dismiss]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

function Toaster({ toasts, onDismiss }) {
  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

const ICON_FOR = {
  success: SuccessIcon,
  error:   ErrorIcon,
  warn:    WarnIcon,
  info:    InfoIcon,
};

const ACCENT_FOR = {
  success: '#10B981',
  error:   '#EF4444',
  warn:    '#F59E0B',
  info:    '#3B82F6',
};

function Toast({ toast, onDismiss }) {
  const Icon = ICON_FOR[toast.type] || InfoIcon;
  const accent = ACCENT_FOR[toast.type] || ACCENT_FOR.info;
  return (
    <div
      className="surface px-3 py-2.5 flex items-start gap-2.5 animate-slide-up pointer-events-auto shadow-e3"
      style={{ borderColor: 'var(--line-strong)' }}
      role="status"
    >
      <div
        className="w-5 h-5 rounded-full grid place-items-center shrink-0 mt-0.5"
        style={{ background: `${accent}22`, color: accent }}
      >
        <Icon />
      </div>
      <div className="flex-1 min-w-0">
        {toast.title && <div className="text-[13px] font-medium leading-snug truncate">{toast.title}</div>}
        {toast.body  && <div className="text-[12px] text-ink-dim leading-snug mt-0.5">{toast.body}</div>}
      </div>
      <button
        onClick={onDismiss}
        className="text-ink-faint hover:text-ink text-[12px] -mr-1 -mt-0.5 px-1"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

function SuccessIcon() {
  return (
    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2.5 6.5 5 9 9.5 3.5" />
    </svg>
  );
}
function ErrorIcon() {
  return (
    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="3" x2="9" y2="9" /><line x1="9" y1="3" x2="3" y2="9" />
    </svg>
  );
}
function WarnIcon() {
  return (
    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="2" x2="6" y2="7" /><circle cx="6" cy="9.5" r="0.5" fill="currentColor" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="5" x2="6" y2="9" /><circle cx="6" cy="3" r="0.5" fill="currentColor" />
    </svg>
  );
}
