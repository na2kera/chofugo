import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

/** 要素の幅（px）を追う。 */
export function useWidth<T extends HTMLElement>(initial = 366): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** 一定間隔で描き直すための現在時刻。 */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, active]);
  return now;
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** OS の「視差効果を減らす」設定（prefers-reduced-motion: reduce）。設定が変わったら描き直す。 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (on) => {
      const mq = globalThis.matchMedia?.(REDUCED_QUERY);
      if (mq === undefined) return () => {};
      mq.addEventListener('change', on);
      return () => mq.removeEventListener('change', on);
    },
    () => globalThis.matchMedia?.(REDUCED_QUERY).matches ?? false,
  );
}
