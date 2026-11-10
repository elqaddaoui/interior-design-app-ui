import { useCallback, useEffect, useRef, useState } from 'react';
import { BackendError } from '@/lib/backend';
import { saApi } from '@/lib/superadmin';

/** GET one Super Admin resource; `reload()` asks again (after a change). A stale answer never replaces a newer one. */
export function useSuperData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const had = useRef(false);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    if (!had.current) setLoading(true); // a refresh keeps showing the old data instead of a spinner
    try { const value = await saApi<T>(path); if (mine === seq.current) { had.current = true; setData(value); setError(''); } }
    catch (e) { if (mine === seq.current) setError(e instanceof BackendError ? e.code || 'BACKEND_UNAVAILABLE' : 'BACKEND_UNAVAILABLE'); }
    finally { if (mine === seq.current) setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
