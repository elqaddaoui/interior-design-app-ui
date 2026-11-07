import type { RenderRequest, RequestStatus } from '@/data/types';
import { backendEnabled } from '@/lib/backend';
import { useStore } from '@/store/useStore';

/**
 * Changes the status of a request. The ONE implementation used by the Requests page and by the dashboard quick view.
 * Delivering also fills the client's design history (`after`) with the delivered picture, as before.
 */
export async function markRequest(r: RenderRequest, status: RequestStatus, extra: Partial<RenderRequest> = {}): Promise<void> {
  const s = useStore.getState();
  await s.update('requests', r.id, { status, ...extra });
  if (status === 'delivered') {
    const out = extra.finalResult ?? r.finalResult ?? r.aiResult;
    if (r.historyId && out && !(backendEnabled && /^[a-f0-9]{8}-/.test(r.id))) await s.update('history', r.historyId, { after: out, status: 'done' });
  }
}
