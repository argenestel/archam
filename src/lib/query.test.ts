import { expect, it, vi } from 'vitest';

it('re-fetches when a refresh arrives while a request is in flight', async () => {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} });
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const { invalidate } = await import('./query');
  // Exercise the loader directly through a tiny harness: the second call during flight must
  // trigger one more fetch whose result wins.
  const mod = await import('./query');
  let value = 0;
  let calls = 0;
  const fn = () =>
    new Promise<number>((r) => {
      calls++;
      const v = value;
      setTimeout(() => r(v), 10);
    });
  const load = mod.__load;
  const first = load('k', fn);
  value = 1; // state changes on chain while the first request is in flight
  load('k', fn);
  await first;
  await new Promise((r) => setTimeout(r, 30));
  expect(calls).toBe(2);
  expect(mod.__peek('k')).toBe(1);
  invalidate();
});
