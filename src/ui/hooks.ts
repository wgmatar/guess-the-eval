import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

/** The element's client size, re-read whenever it or the window resizes. */
export function useElementSize(el: HTMLElement | null): { width: number; height: number } | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!el) return () => {};
      const observer = new ResizeObserver(onChange);
      observer.observe(el);
      window.addEventListener('resize', onChange);
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', onChange);
      };
    },
    [el],
  );
  const key = useSyncExternalStore(
    subscribe,
    () => (el ? `${el.clientWidth}x${el.clientHeight}` : ''),
    () => '',
  );
  return useMemo(() => {
    if (!key) return null;
    const [width, height] = key.split('x').map(Number);
    return { width, height };
  }, [key]);
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** `value`, once it has stopped changing for `delay` ms: "after the animation settles". */
export function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(settled, value)) return;
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay, settled]);
  return settled;
}
