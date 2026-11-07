import { api } from '@/lib/backend';
import { mockServices } from '../mock/services';
import type { ChatService } from './types';
import type { ReplyMeta } from '../types';

type ServerReply = { text: string; provider: string; model: string; label: string; language?: string; status: ReplyMeta['status']; paid?: boolean; tried?: { provider: string; label: string; model: string; paid?: boolean; reason: string }[]; automationId?: string; automationName?: string };

/**
 * AI chat over `/api/chat/reply`. The server answers with the owner's automations first, then the AI (free providers,
 * paid ones before or after them, automatic fallback). The device token identifies the visitor; keys never reach the client.
 * Every answer carries `meta` (who answered and how) for the admin; visitors never see it.
 * If the server cannot answer (no provider configured, offline, timeout) the visitor still gets the local canned reply
 * instead of an error bubble, marked `local`.
 */
export const remoteChat = (): ChatService => ({
  async reply(args) {
    // Only the recent turns are sent: it keeps the request small and the provider quota low.
    const turns = args.messages.slice(-12).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      text: (m.text || '').slice(0, 2000),
      ...(m.image ? { image: true } : {}),
    }));
    // Automations that already answered in this chat (their "once per chat" rule): read from the saved messages.
    const used = args.used ?? [...new Set(args.messages.map((m) => m.meta?.automationId).filter((id): id is string => !!id))];
    try {
      const out = await api<ServerReply>('/chat/reply', { method: 'POST', client: true, body: { messages: turns, used, ...(args.buttonId ? { buttonId: args.buttonId } : {}) }, timeoutMs: 30000 });
      if (out?.text?.trim()) {
        const tried = (out.tried ?? []).map((t) => ({ provider: t.provider, label: t.label, model: t.model, paid: t.paid, reason: t.reason }));
        return {
          text: out.text.trim(),
          meta: { status: out.status, provider: out.provider, label: out.label, model: out.model, paid: out.paid, language: out.language, automationId: out.automationId, automationName: out.automationName, ...(tried.length ? { tried } : {}) },
        };
      }
    } catch (error) {
      // NO_PROVIDER, ASSISTANT_DISABLED, rate limit, offline or timeout: use the local reply below. The trace of a NO_PROVIDER stays on the message.
      const tried = (error as { body?: { tried?: ReplyMeta['tried'] } })?.body?.tried;
      return mockServices.chat.reply(args).then((local) => (tried?.length ? { ...local, meta: { ...local.meta, tried } } : local));
    }
    return mockServices.chat.reply(args);
  },
  async buttons() {
    try {
      const out = await api<{ buttons: { id: string; label: string }[] }>('/chat/buttons', { client: true, timeoutMs: 8000 });
      return Array.isArray(out?.buttons) ? out.buttons : [];
    } catch {
      return [];
    }
  },
});
