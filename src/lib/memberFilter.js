/**
 * Shared global member-selection filter.
 *
 * Used by Calendar, Gantt, and Tasks to highlight tasks belonging to selected
 * members (multi-select). Empty selection = "show all" (no filter).
 *
 *   import { useMemberFilter, useSelectedMembers, toggleMember, clearMembers } from '../lib/memberFilter.js';
 */
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'member_filter_selection';
const listeners = new Set();

let state = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
})();

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...state])); } catch {}
}

function notify() { listeners.forEach((fn) => fn()); }

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot() { return state; }

/** Returns the live Set of selected member emails. */
export function useSelectedMembers() {
  return useSyncExternalStore(subscribe, getSnapshot, () => new Set());
}

/** Convenience: { selected, toggle, clear, isFiltered, isActive(email) }. */
export function useMemberFilter() {
  const selected = useSelectedMembers();
  return {
    selected,
    isFiltered: selected.size > 0,
    isActive: (email) => selected.size === 0 || selected.has(email),
    toggle: toggleMember,
    clear: clearMembers,
    setOnly: setOnlyMember,
  };
}

export function toggleMember(email) {
  if (!email) return;
  const next = new Set(state);
  if (next.has(email)) next.delete(email); else next.add(email);
  state = next;
  persist();
  notify();
}

export function clearMembers() {
  if (state.size === 0) return;
  state = new Set();
  persist();
  notify();
}

export function setOnlyMember(email) {
  state = email ? new Set([email]) : new Set();
  persist();
  notify();
}

/**
 * Filter a task list by the current member selection.
 * Empty selection → pass through unchanged.
 */
export function applyMemberFilter(tasks) {
  if (state.size === 0) return tasks;
  return tasks.filter((t) => state.has(t.assignee));
}
