/**
 * Tiny URL-hash-based task router.
 *
 * Any view can call openTask(id) to deep-link to a task. App.jsx subscribes
 * via useFocusedTask() and mounts TaskEditModal when a task is focused.
 *
 * Hash format: #task/<taskId>
 */
import { useEffect, useSyncExternalStore } from 'react';

const PREFIX = '#task/';
const listeners = new Set();

function readHash() {
  const h = typeof window !== 'undefined' ? window.location.hash : '';
  return h.startsWith(PREFIX) ? decodeURIComponent(h.slice(PREFIX.length)) : null;
}

function subscribe(cb) {
  listeners.add(cb);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('hashchange', notify);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('hashchange', notify);
    }
  };
}

function notify() { listeners.forEach((fn) => fn()); }

export function openTask(taskId) {
  if (!taskId) return;
  const next = `${PREFIX}${encodeURIComponent(taskId)}`;
  if (window.location.hash !== next) {
    window.location.hash = next;
  } else {
    notify();
  }
}

export function closeTask() {
  if (window.location.hash.startsWith(PREFIX)) {
    // History-friendly: replace state to drop the hash without scroll jump.
    history.replaceState(null, '', window.location.pathname + window.location.search);
    notify();
  }
}

export function useFocusedTask() {
  return useSyncExternalStore(subscribe, readHash, () => null);
}

/** Lock body scroll when modal mounts (cosmetic, optional). */
export function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}
