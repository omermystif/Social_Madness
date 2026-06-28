import { useCallback, useEffect, useRef, useState } from 'react';
import SearchBar from '../ui/SearchBar';

interface UserResult {
  id: string;
  name: string;
  email: string;
}

const SEED: UserResult[] = [
  { id: '1', name: 'Jonathan Smith', email: 'jon@acme.io' },
  { id: '2', name: 'Mia Carter',     email: 'mia@acme.io' },
  { id: '3', name: 'Devon Ortiz',    email: 'devon@acme.io' },
  { id: '4', name: 'Sam Lin',        email: 'sam@acme.io' },
  { id: '5', name: 'Alex Greene',    email: 'alex@acme.io' },
];

/** Simulates a network search. Honors AbortSignal so superseded requests are cancellable. */
async function fetchUsers(query: string, signal: AbortSignal): Promise<UserResult[]> {
  if (!query) return [];
  await new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, 350);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
  const q = query.toLowerCase();
  return SEED.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
}

export default function UserSearchPanel() {
  const [results, setResults] = useState<UserResult[]>([]);
  const [isLoading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string>('');
  const inflightRef = useRef<AbortController | null>(null);

  const handleSearch = useCallback(async (value: string) => {
    // Cancel any in-flight request before starting a new one — prevents
    // out-of-order responses overwriting fresher results.
    inflightRef.current?.abort();
    setLastQuery(value);

    if (!value) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    inflightRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const data = await fetchUsers(value, controller.signal);
      if (controller.signal.aborted) return;
      setResults(data);
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      if (inflightRef.current === controller) setLoading(false);
    }
  }, []);

  // Abort any in-flight request on unmount.
  useEffect(() => () => inflightRef.current?.abort(), []);

  return (
    <section className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Team directory</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Search by name or email. Press <kbd className="rounded border border-slate-300 bg-slate-100 px-1 text-[10px] dark:border-slate-700 dark:bg-slate-800">Enter</kbd> to skip debounce or
          {' '}<kbd className="rounded border border-slate-300 bg-slate-100 px-1 text-[10px] dark:border-slate-700 dark:bg-slate-800">Esc</kbd> to clear.
        </p>
      </header>

      <SearchBar
        onSearch={handleSearch}
        placeholder="Search team members…"
        isLoading={isLoading}
        debounceMs={400}
      />

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <ul
        aria-live="polite"
        aria-busy={isLoading}
        className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900"
      >
        {!lastQuery && !isLoading && (
          <li className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Start typing to search…
          </li>
        )}
        {lastQuery && !isLoading && results.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No results for &ldquo;{lastQuery}&rdquo;
          </li>
        )}
        {results.map((u) => (
          <li key={u.id} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{u.name}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{u.email}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
