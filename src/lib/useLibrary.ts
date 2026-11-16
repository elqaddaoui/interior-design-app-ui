import { useCallback, useEffect, useRef, useState } from 'react';
import { listLibrary, type LibItem, type LibKind } from '@/lib/mediaLibrary';

/** Pages through the store's media library (newest first). The search text waits for the typing to stop; a late answer never overwrites a newer one. */
export function useLibrary({ kind = '', q = '', enabled = true }: { kind?: LibKind; q?: string; enabled?: boolean }) {
  const [state, setState] = useState<{ items: LibItem[]; more: boolean; total: number; loading: boolean; error: boolean }>({ items: [], more: false, total: 0, loading: enabled, error: false });
  const run = useRef(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const id = ++run.current;
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true, error: false }));
      listLibrary({ kind, q: q.trim() }).then(
        (page) => { if (id === run.current) setState({ ...page, loading: false, error: false }); },
        () => { if (id === run.current) setState((s) => ({ ...s, loading: false, error: true })); },
      );
    }, q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [kind, q, enabled, tick]);
  const loadMore = useCallback(async () => {
    const id = run.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const page = await listLibrary({ kind, q: q.trim(), offset: state.items.length });
      if (id === run.current) setState((s) => ({ items: [...s.items, ...page.items.filter((n) => !s.items.some((o) => o.id === n.id))], more: page.more, total: page.total, loading: false, error: false }));
    } catch { if (id === run.current) setState((s) => ({ ...s, loading: false, error: true })); }
  }, [kind, q, state.items.length]);
  return { ...state, reload: () => setTick((n) => n + 1), loadMore };
}
