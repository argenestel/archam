import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import type { FeedTrade } from './data';

// Follows are a personal watchlist kept in this browser. They are not published anywhere.
const key = 'orbit.follows.v1';
const read = (): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v.filter((a): a is string => /^0x[0-9a-f]{40}$/.test(a)).slice(0, 200) : [];
  } catch {
    return [];
  }
};
export function useFollows() {
  const [follows, setFollows] = useState<string[]>(read);
  useEffect(() => {
    const sync = () => setFollows(read());
    window.addEventListener('orbit:follows', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('orbit:follows', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const toggle = useCallback((address: Address) => {
    const a = address.toLowerCase();
    const next = read().includes(a) ? read().filter((x) => x !== a) : [...read(), a];
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* optional */
    }
    window.dispatchEvent(new Event('orbit:follows'));
  }, []);
  const isFollowing = useCallback((address: string) => follows.includes(address.toLowerCase()), [follows]);
  return { follows, toggle, isFollowing };
}

/** Calls `onTrade` once for each new trade by a followed wallet that appears in the feed. */
export function useFollowAlerts(feed: FeedTrade[] | undefined, follows: string[], onTrade: (t: FeedTrade) => void) {
  const seen = useRef<Set<string> | null>(null);
  const callback = useRef(onTrade);
  callback.current = onTrade;
  useEffect(() => {
    if (!feed) return;
    if (!seen.current) {
      seen.current = new Set(feed.map((t) => t.id));
      return;
    }
    for (const t of [...feed].reverse()) {
      if (seen.current.has(t.id)) continue;
      seen.current.add(t.id);
      if (follows.includes(t.trader.toLowerCase())) callback.current(t);
    }
  }, [feed, follows]);
}
