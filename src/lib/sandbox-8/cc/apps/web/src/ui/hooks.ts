import { useEffect, useRef, useState } from 'preact/hooks';
import type { Query } from '../protocol.ts';
import { app } from './state.ts';

/**
 * Poll a worker query while the component is mounted. Stale responses (from a previous key)
 * are dropped. `key` changes restart polling immediately.
 */
export function useQuery<T>(query: Query | null, intervalMs = 1000, key: string = JSON.stringify(query)): { data: T | null; error: string | null; loaded: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const tick = useRef<() => void>(() => {});
  useEffect(() => {
    if (!query) {
      setData(null);
      return;
    }
    const my = ++seq.current;
    let timer = 0;
    let alive = true;
    setData(null);
    setLoaded(false);
    const run = () => {
      app.client
        .query<T>(query)
        .then((r) => {
          if (alive && my === seq.current) {
            setData(r);
            setLoaded(true);
            setError(null);
          }
        })
        .catch((e: Error) => {
          if (alive && my === seq.current) setError(e.message);
        })
        .finally(() => {
          if (alive && intervalMs > 0) timer = window.setTimeout(run, document.hidden ? intervalMs * 4 : intervalMs);
        });
    };
    tick.current = () => {
      clearTimeout(timer);
      run();
    };
    run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs]);
  return { data, error, loaded, refresh: () => tick.current() };
}

/** Projection shortcut. */
export function useProjection<T>(name: string, intervalMs = 1000, args?: Record<string, unknown>) {
  return useQuery<T>(args ? { kind: 'projection', name, args } : { kind: 'projection', name }, intervalMs);
}

/** Persisted local state (localStorage, best effort). */
export function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`cc.${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  return [
    v,
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(`cc.${key}`, JSON.stringify(nv));
      } catch {
        /* ignore */
      }
    },
  ];
}

/** Width of an element (ResizeObserver), for charts that must not scale their text. */
export function useWidth<E extends HTMLElement>(fallback = 360): [import('preact').RefObject<E | null>, number] {
  const ref = useRef<E>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const nw = Math.round(el.clientWidth);
      if (nw > 0) setW(nw);
    });
    ro.observe(el);
    const nw = Math.round(el.clientWidth);
    if (nw > 0) setW(nw);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
