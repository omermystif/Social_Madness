import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface SearchBarProps {
  /** Called with the current input value after debounce, on Enter, on Clear. */
  onSearch: (value: string) => void;
  /** Placeholder shown when empty. Also used as the input's aria-label. */
  placeholder?: string;
  /** When true, replaces clear/submit affordance with a spinner and prevents new fires. */
  isLoading?: boolean;
  /** Delay before `onSearch` fires after user stops typing. Default 500ms. */
  debounceMs?: number;
  /** Optional initial value (uncontrolled — parent does not need to manage input state). */
  initialValue?: string;
  /** Disables interaction entirely. */
  disabled?: boolean;
  /** Extra className appended to the root <form>. Tailwind utilities recommended. */
  className?: string;
}

/**
 * Reusable, accessible, debounced search bar.
 *
 * Behavior:
 * - Controlled internally; parent only sees `onSearch(value)` calls.
 * - Typing schedules a debounced fire (default 500ms).
 * - Enter cancels the pending timer and fires immediately.
 * - Esc cancels and clears.
 * - Clear button fires `onSearch('')` synchronously.
 * - During isLoading, the spinner shows and Enter / submit are suppressed.
 *
 * Wrapped in React.memo so re-renders only happen when its own props change.
 * Parents should memoize the `onSearch` callback (useCallback) to preserve memo benefits.
 */
const SearchBar = memo(function SearchBar({
  onSearch,
  placeholder = 'Search…',
  isLoading = false,
  debounceMs = 500,
  initialValue = '',
  disabled = false,
  className = '',
}: SearchBarProps) {
  const [value, setValue] = useState<string>(initialValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef<boolean>(true);
  // Latest onSearch held in a ref so the debounce timer always calls the
  // current callback even if the parent forgets to memoize it (avoids stale closures).
  const onSearchRef = useRef<(v: string) => void>(onSearch);

  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const cancelDebounce = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fire = useCallback((next: string) => {
    if (!mountedRef.current) return;
    onSearchRef.current(next);
  }, []);

  const scheduleDebounced = useCallback(
    (next: string) => {
      cancelDebounce();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fire(next);
      }, debounceMs);
    },
    [cancelDebounce, fire, debounceMs],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setValue(next);
      scheduleDebounced(next);
    },
    [scheduleDebounced],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isLoading || disabled) return;
      cancelDebounce();
      fire(value);
    },
    [cancelDebounce, disabled, fire, isLoading, value],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape' && value) {
        event.preventDefault();
        cancelDebounce();
        setValue('');
        fire('');
      }
    },
    [cancelDebounce, fire, value],
  );

  const handleClear = useCallback(() => {
    if (disabled) return;
    cancelDebounce();
    setValue('');
    fire('');
  }, [cancelDebounce, disabled, fire]);

  const showClear = value.length > 0 && !isLoading && !disabled;

  return (
    <form
      role="search"
      aria-label="Site search"
      onSubmit={handleSubmit}
      className={['relative w-full max-w-xl', className].filter(Boolean).join(' ')}
    >
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500 dark:text-slate-400"
        >
          <SearchIcon className="h-4 w-4" />
        </span>

        <input
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-busy={isLoading || undefined}
          aria-disabled={disabled || undefined}
          className={[
            'w-full rounded-lg border bg-white pl-9 pr-10 py-2 text-sm shadow-sm transition',
            'placeholder:text-slate-400 text-slate-900',
            'border-slate-300 hover:border-slate-400',
            'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500',
            'focus-visible:ring-2 focus-visible:ring-indigo-500',
            'disabled:cursor-not-allowed disabled:opacity-60',
            'dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700',
            'dark:placeholder:text-slate-500 dark:hover:border-slate-600',
            'dark:focus:ring-indigo-400 dark:focus:border-indigo-400',
          ].join(' ')}
        />

        <div className="absolute inset-y-0 right-0 flex items-center pr-2">
          {isLoading ? (
            <Spinner />
          ) : showClear ? (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear search"
              className={[
                'inline-flex h-7 w-7 items-center justify-center rounded-md',
                'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                'dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800',
              ].join(' ')}
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Search"
              disabled={disabled || isLoading}
              className={[
                'inline-flex h-7 w-7 items-center justify-center rounded-md',
                'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                'disabled:cursor-not-allowed disabled:opacity-40',
                'dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800',
              ].join(' ')}
            >
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Polite live region announces loading state to screen readers without stealing focus. */}
        <span className="sr-only" aria-live="polite">
          {isLoading ? 'Searching…' : ''}
        </span>
      </div>
    </form>
  );
});

export default SearchBar;

// ─── Internal icons (kept local to avoid an external dependency) ─────────────

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="6" />
      <line x1="13.5" y1="13.5" x2="17" y2="17" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="5" y1="5" x2="15" y2="15" />
      <line x1="15" y1="5" x2="5" y2="15" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="4" y1="10" x2="15" y2="10" />
      <polyline points="11 6 15 10 11 14" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label="Searching"
      className="inline-flex h-7 w-7 items-center justify-center"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="h-4 w-4 animate-spin text-slate-500 dark:text-slate-400"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}
