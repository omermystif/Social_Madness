// Theme manager — keeps html[data-theme] + class + colorScheme in sync.
// Bootstrap (no-flash) runs in index.html before React mounts.
// React side subscribes to changes via useSyncExternalStore.
//
// Persistence key: localStorage 'cmd_theme'. Allowed values: 'light' | 'dark' | 'system'.
// When 'system', the resolved theme follows prefers-color-scheme live.

import { useSyncExternalStore } from 'react';

const KEY = 'cmd_theme';
const MQ  = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: light)')
  : null;

const listeners = new Set();
function emit() { listeners.forEach((fn) => fn()); }

function readStoredPref() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {}
  return 'system';
}

function systemTheme() {
  return MQ?.matches ? 'light' : 'dark';
}

export function getPreference() { return readStoredPref(); }
export function getResolvedTheme() {
  const p = readStoredPref();
  return p === 'system' ? systemTheme() : p;
}

function applyTheme(resolved) {
  const root = document.documentElement;
  // Brief opt-in transition so CSS color/bg morph smoothly.
  root.classList.add('theme-transition');
  root.setAttribute('data-theme', resolved);
  root.classList.toggle('dark',  resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
  root.style.colorScheme = resolved;
  // Drop the transition flag after the morph completes so future hover/focus
  // transitions don't inherit the wide selector cost.
  window.setTimeout(() => root.classList.remove('theme-transition'), 320);
}

export function setPreference(pref) {
  const safe = pref === 'light' || pref === 'dark' || pref === 'system' ? pref : 'system';
  try { localStorage.setItem(KEY, safe); } catch {}
  applyTheme(safe === 'system' ? systemTheme() : safe);
  emit();
}

export function toggleTheme() {
  // Cycles between dark and light, ignoring 'system' for direct toggling UX.
  const next = getResolvedTheme() === 'dark' ? 'light' : 'dark';
  setPreference(next);
}

// Follow OS changes only when preference === 'system'.
if (MQ) {
  const onChange = () => {
    if (readStoredPref() === 'system') {
      applyTheme(systemTheme());
      emit();
    }
  };
  // Modern + legacy listener registration.
  if (MQ.addEventListener) MQ.addEventListener('change', onChange);
  else if (MQ.addListener) MQ.addListener(onChange);
}

// Cross-tab sync via storage event.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (ev.key === KEY) {
      applyTheme(getResolvedTheme());
      emit();
    }
  });
}

// ─── React hook ─────────────────────────────────────────────────────────────
function subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function snapshot()    { return readStoredPref() + ':' + getResolvedTheme(); }

export function useTheme() {
  // Returns { pref, resolved, setPreference, toggleTheme }.
  // Re-renders when either the stored preference or the resolved theme changes.
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    pref:     readStoredPref(),
    resolved: getResolvedTheme(),
    setPreference,
    toggleTheme,
  };
}
