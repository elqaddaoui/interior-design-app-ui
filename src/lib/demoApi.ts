import { api, backendEnabled } from '@/lib/backend';
import type { Id } from '@/data/types';

/** Counts one tap on a demo message (owner statistics). Fire-and-forget: a counter must never slow down or break the chat. */
export function trackDemoClick(id: Id) {
  if (!backendEnabled) return;
  void api('/chat/demo-click', { method: 'POST', body: { id }, client: true }).catch(() => {});
}

export interface DemoStats { stats: Record<string, { used: number; last: number }>; popular: { text: string; count: number; intent: string; chats: number; last: number }[] }
/** Admin: tap counters per demo message and the questions customers ask most. */
export const loadDemoStats = () => api<DemoStats>('/admin/assistant/demo');
