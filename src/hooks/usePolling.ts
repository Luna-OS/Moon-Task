import { useCallback, useEffect, useRef, useState } from "react";

export interface Polled<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads `load()` now and then every `intervalMs` (0 = only on demand)
 * while `enabled`. Results of a request that finished after `load`
 * changed are dropped, so switching processes never shows stale details.
 */
export function usePolling<T>(
  load: (() => Promise<T>) | null,
  intervalMs: number,
  enabled = true,
): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    if (!load || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      setLoading(true);
      try {
        const result = await load();
        if (generation.current !== mine) return;
        setData(result);
        setError(null);
      } catch (e) {
        if (generation.current !== mine) return;
        setError(String(e));
      } finally {
        if (generation.current === mine) {
          setLoading(false);
          if (intervalMs > 0) timer = setTimeout(() => void run(), intervalMs);
        }
      }
    };
    void run();
    return () => {
      generation.current += 1;
      clearTimeout(timer);
    };
  }, [load, intervalMs, enabled, nonce]);

  // A new `load` means different data: forget the old one (React's
  // "adjust state while rendering" pattern, no effect round-trip).
  const [lastLoad, setLastLoad] = useState(() => load);
  if (lastLoad !== load) {
    setLastLoad(() => load);
    setData(null);
    setError(null);
  }

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
