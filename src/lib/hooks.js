import { useCallback, useEffect, useRef, useState } from 'react';

export function useData(load, deps = [], { refreshMs } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const latest = useRef(0);

  const reload = useCallback(async () => {
    latest.current += 1;
    const request = latest.current;
    try {
      const data = await load();
      if (request === latest.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (request === latest.current) setState((prev) => ({ ...prev, error, loading: false }));
    }
  }, deps);

  useEffect(() => {
    reload();
    if (!refreshMs) return undefined;
    const timer = setInterval(reload, refreshMs);
    return () => clearInterval(timer);
  }, [reload, refreshMs]);

  return { ...state, reload };
}

export function useDebounced(value, ms = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return debounced;
}
