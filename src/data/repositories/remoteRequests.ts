import type { CollectionRepo } from './types';
import type { RenderRequest } from '@/data/types';
import { api, BackendError } from '@/lib/backend';
import { useLocal } from '@/store/useLocal';
import { useUserSession } from '@/store/useUserSession';
import { uid } from '@/lib/uid';

/** Requests live only in the database: admins see all of them, a signed-in client sees their own. */
export function remoteRequests(): CollectionRepo<RenderRequest> {
  return {
    async list() {
      if (useLocal.getState().adminSession) {
        try { return await api<RenderRequest[]>('/requests'); }
        catch (error) {
          if (error instanceof BackendError && error.status === 401 && !useLocal.getState().adminOffline) useLocal.getState().set({ adminSession: false });
          else if (!(error instanceof BackendError)) throw error;
        }
      }
      return useUserSession.getState().user ? api<RenderRequest[]>('/user/requests') : [];
    },
    get: id => api<RenderRequest>(`/requests/${encodeURIComponent(id)}`, { client: true }),
    // Stable ID supplied by the lead form makes retries idempotent after a lost response.
    create: input => api<RenderRequest>('/requests', { method: 'POST', client: true, body: { ...input, id: input.id || uid('req') } }),
    update: (id, patch) => api<RenderRequest>(`/requests/${encodeURIComponent(id)}`, { method: 'PATCH', client: true, body: patch }),
    remove: async id => { await api(`/requests/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    async removeMany(ids) { for (let i = 0; i < ids.length; i += 200) await api('/admin/requests/bulk', { method: 'POST', body: { action: 'delete', ids: ids.slice(i, i + 200) } }); },
  };
}
