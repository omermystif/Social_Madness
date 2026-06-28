import { useCallback, useEffect, useMemo, useState } from 'react';
import { pb, pbEnabled } from '../lib/pb.js';

export function useRealtimeCollection(collectionName, options = {}) {
  const {
    sort = '-updated',
    expand,
    filter,
    mapRecord = (record) => record,
  } = options;

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(Boolean(pbEnabled));
  const [error, setError] = useState(null);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  const queryOptions = useMemo(
    () => ({
      sort,
      ...(expand ? { expand } : {}),
      ...(filter ? { filter } : {}),
    }),
    [expand, filter, sort]
  );

  const reload = useCallback(async () => {
    if (!pbEnabled) {
      setRecords([]);
      setLoading(false);
      return [];
    }

    setLoading(true);
    setError(null);

    try {
      const list = await pb.collection(collectionName).getFullList(queryOptions);
      const mapped = list.map(mapRecord);
      setRecords(mapped);
      setLastLoadedAt(Date.now());
      return mapped;
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, [collectionName, mapRecord, queryOptions]);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  useEffect(() => {
    if (!pbEnabled) return undefined;

    let cancelled = false;
    let unsubscribe = null;

    pb.collection(collectionName)
      .subscribe('*', async () => {
        if (cancelled) return;
        try {
          await reload();
        } catch {}
      })
      .then((fn) => {
        unsubscribe = fn;
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError);
      });

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [collectionName, reload]);

  return {
    records,
    setRecords,
    loading,
    error,
    lastLoadedAt,
    reload,
  };
}
