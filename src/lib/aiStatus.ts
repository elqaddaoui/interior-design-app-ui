import { useEffect, useState } from 'react';
import { api, backendEnabled } from '@/lib/backend';

export interface AiStatus {
  /** An image engine has a key: generations are real. Otherwise the app shows its sample result. */
  live: boolean;
  models: { id: string; name: string; engine: string; modelName: string; i2i: boolean; free: boolean }[];
  /** Titles of the free models that run when the admin's model has no engine of its own. */
  chain: { image: string[]; text: string[] };
}
const OFFLINE: AiStatus = { live: false, models: [], chain: { image: [], text: [] } };
let cached: { at: number; value: AiStatus } | null = null;
let pending: Promise<AiStatus> | null = null;

/** One shared, short-lived read of `/api/ai/status` (no keys). Never throws: offline simply means "demo". */
export function loadAiStatus(): Promise<AiStatus> {
  if (!backendEnabled) return Promise.resolve(OFFLINE);
  if (cached && Date.now() - cached.at < 60000) return Promise.resolve(cached.value);
  pending ??= api<AiStatus>('/ai/status')
    .then((value) => { cached = { at: Date.now(), value }; return value; })
    .catch(() => OFFLINE)
    .finally(() => { pending = null; });
  return pending;
}

export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(cached?.value ?? null);
  useEffect(() => { let alive = true; loadAiStatus().then((v) => { if (alive) setStatus(v); }); return () => { alive = false; }; }, []);
  return status;
}
