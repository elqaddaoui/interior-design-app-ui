import { api, apiUrl, BackendError } from '@/lib/backend';
import { BkError, type Transport } from '@/lib/backupClient';

const wrap = (error: unknown): never => {
  if (error instanceof BackendError) throw new BkError(error.status, error.code || 'UNKNOWN', (error.body && typeof error.body === 'object' ? error.body : {}) as Record<string, unknown>);
  throw new BkError(0, 'NETWORK');
};
/** Store-admin transport: `/api/admin/backup/*` (cookie on the web, Bearer on native), same session as every other admin call. */
export const adminTransport: Transport = {
  json: async <T,>(path: string, options: { method?: string; body?: unknown } = {}) => {
    try { return await api<T>(`/admin/backup${path}`, { method: options.method, body: options.body, timeoutMs: 30000 }); } catch (e) { return wrap(e); }
  },
  chunk: async <T,>(path: string, body: Blob) => {
    try { return await api<T>(`/admin/backup${path}`, { method: 'POST', raw: body, headers: { 'Content-Type': 'application/octet-stream' }, timeoutMs: 180000 }); } catch (e) { return wrap(e); }
  },
  downloadUrl: (id) => apiUrl(`/admin/backup/jobs/${id}/download`),
};
