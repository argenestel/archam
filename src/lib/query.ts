import { useEffect, useReducer, useRef } from 'react';
import { userFacingError } from './errors';

// Minimal shared polling cache: one in-flight request per key, shared by every subscriber,
// refreshed on an interval and whenever a local transaction changes state.
type Entry = {
  data?: unknown;
  error?: string;
  updatedAt?: number;
  promise?: Promise<void>;
  listeners: Set<() => void>;
};
const cache = new Map<string, Entry>();
const entry = (key: string) => {
  let e = cache.get(key);
  if (!e) cache.set(key, (e = { listeners: new Set() }));
  return e;
};
function load(key: string, fn: () => Promise<unknown>) {
  const e = entry(key);
  if (e.promise) return e.promise;
  e.promise = fn()
    .then((data) => {
      e.data = data;
      e.error = undefined;
      e.updatedAt = Date.now();
    })
    .catch((err) => {
      e.error = userFacingError(err, 'Could not load data from Arc. Retrying…');
    })
    .finally(() => {
      e.promise = undefined;
      e.listeners.forEach((l) => l());
    });
  return e.promise;
}
export function invalidate(prefix = '') {
  for (const [key, e] of cache) if (key.startsWith(prefix)) e.updatedAt = 0;
  window.dispatchEvent(new Event('orbit:refresh'));
}

export function useQuery<T>(
  key: string | null,
  fn: () => Promise<T>,
  interval = 12_000,
): { data?: T; error?: string; loading: boolean; updatedAt?: number; refresh: () => void } {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!key) return;
    const e = entry(key);
    e.listeners.add(rerender);
    const run = () => load(key, () => fnRef.current());
    if (!e.updatedAt || Date.now() - e.updatedAt > interval / 2) void run();
    const timer = setInterval(() => document.visibilityState === 'visible' && run(), interval);
    const onEvent = () => void run();
    window.addEventListener('orbit:transactions', onEvent);
    window.addEventListener('orbit:refresh', onEvent);
    return () => {
      e.listeners.delete(rerender);
      clearInterval(timer);
      window.removeEventListener('orbit:transactions', onEvent);
      window.removeEventListener('orbit:refresh', onEvent);
    };
  }, [key, interval]);
  const e = key ? cache.get(key) : undefined;
  return {
    data: e?.data as T | undefined,
    error: e?.error,
    loading: !!key && !e?.updatedAt && !e?.error,
    updatedAt: e?.updatedAt,
    refresh: () => key && void load(key, () => fnRef.current()),
  };
}
