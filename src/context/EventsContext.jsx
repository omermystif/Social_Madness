// Lightweight global events cache. Loaded on Google connect; refreshable.
// Pulls primary calendar over a ~3-month window (current-1 → current+2).
// CalendarPage continues to do its own multi-calendar fetch — this is search-only.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { syncEvents } from '../api/calendarApi.js';
import { useAuth } from './AuthContext.jsx';

const EventsContext = createContext(null);

function makeWindow() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const end   = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59).toISOString();
  return { start, end };
}

export function EventsProvider({ children }) {
  const { user } = useAuth();
  const [events, setEvents]     = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [lastSyncedAt, setLast] = useState(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError(null);
    try {
      const { start, end } = makeWindow();
      const { items } = await syncEvents({
        calendarId:     'primary',
        initialTimeMin: start,
        initialTimeMax: end,
      });
      setEvents(items.filter(e => e.status !== 'cancelled'));
      setLast(Date.now());
    } catch (err) {
      console.error('EventsContext refresh failed', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Auto-load on connect; clear on sign-out.
  useEffect(() => {
    if (user) {
      refresh();
    } else {
      setEvents([]);
      setError(null);
      setLast(null);
    }
  }, [user, refresh]);

  return (
    <EventsContext.Provider value={{ events, loading, error, lastSyncedAt, refresh }}>
      {children}
    </EventsContext.Provider>
  );
}

export const useEvents = () => {
  const ctx = useContext(EventsContext);
  if (!ctx) return { events: [], loading: false, error: null, lastSyncedAt: null, refresh: () => {} };
  return ctx;
};
