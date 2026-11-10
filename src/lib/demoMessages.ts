/**
 * Demo messages of the assistant: the suggestions of an empty chat, the instant answer of the owner and the follow-ups that come next.
 * Pure functions (no React, no network): used by both chat views, by Admin > Assistant > Demo messages, and by `npm run check:demo`.
 */
import { STARTER_DEMO } from '../data/mock/demoStarter';
import type { AssistantConfig, ChatMessage, DemoConfig, DemoCta, DemoMessage, Lang, LText, ReplyMeta } from '../data/types';

export { STARTER_DEMO };
export const DEMO_PREFIX = 'demo:';
export const MAX_DEMO_ITEMS = 30;
export const MAX_FOLLOW_UPS = 4;
/** How many suggestions are offered after an answer when the owner chose no follow-ups. */
export const MAX_NEXT = 4;
const LANGS: Lang[] = ['dar', 'ar', 'fr'];

/** The text in the person's language, else the first language that has one (same rule as the rest of the app). */
export const pickText = (v: LText | undefined, lang: Lang): string => (v ? (v[lang] || v.fr || v.ar || v.dar || '').trim() : '');
export const emptyL = (): LText => ({ dar: '', ar: '', fr: '' });
const filled = (v?: LText) => !!v && LANGS.some((l) => (v[l] || '').trim());

/** The configuration in force: the owner's, or the built-in starter set until they edit it. */
export const demoConfigOf = (assistant?: Pick<AssistantConfig, 'demo'>): DemoConfig => assistant?.demo ?? STARTER_DEMO;

/** The suggestions a person sees: enabled, with a label in some language. A disabled section shows nothing. */
export function demoItems(config: DemoConfig, lang: Lang): DemoMessage[] {
  if (config.enabled === false) return [];
  return config.items.filter((item) => item.enabled !== false && !!pickText(item.label, lang));
}

/** What a tap does: `fill` puts a starter sentence in the message box, `answer` shows the owner's text at once, `ask` sends the question to the normal pipeline (automations, then the AI). */
export type DemoAction =
  | { kind: 'fill'; text: string }
  | { kind: 'answer'; question: string; answer: string }
  | { kind: 'ask'; question: string };

export function demoAction(item: DemoMessage, lang: Lang): DemoAction {
  const label = pickText(item.label, lang);
  if (item.mode === 'write') return { kind: 'fill', text: pickText(item.prompt, lang) || label };
  const answer = item.reply.type === 'text' ? pickText(item.reply.text, lang) : '';
  return answer ? { kind: 'answer', question: label, answer } : { kind: 'ask', question: label };
}

/** Marks the saved assistant message as an owner's automatic answer (shown as such in the admin inbox) and ties it to the demo message. */
export const demoMeta = (item: DemoMessage, lang: Lang): ReplyMeta => ({
  status: 'automation', provider: 'automation', label: 'Demo', model: '', language: lang,
  automationId: `${DEMO_PREFIX}${item.id}`.slice(0, 40), automationName: pickText(item.label, lang).slice(0, 80),
});

/** The demo message an assistant message answered, if any. */
export const demoIdOf = (m?: ChatMessage): string | undefined => {
  const id = m && m.role === 'assistant' ? m.meta?.automationId : undefined;
  return id && id.startsWith(DEMO_PREFIX) ? id.slice(DEMO_PREFIX.length) : undefined;
};
export const usedDemoIds = (messages: ChatMessage[]): Set<string> => new Set(messages.map(demoIdOf).filter((id): id is string => !!id));

/**
 * What to offer under the last answer. `activeId` = the demo message that was just answered (kept in memory for answers that came
 * from the AI); a saved conversation falls back to the marker on its last message.
 * Follow-ups chosen by the owner come first; otherwise the suggestions not used yet in this chat (at most MAX_NEXT).
 */
export function nextOptions(config: DemoConfig, lang: Lang, messages: ChatMessage[], activeId?: string): { item?: DemoMessage; options: DemoMessage[] } {
  const last = messages[messages.length - 1];
  if (!last || last.role === 'user') return { options: [] };
  const id = activeId ?? demoIdOf(last);
  const all = demoItems(config, lang);
  const item = id ? config.items.find((x) => x.id === id) : undefined;
  if (!item) return { options: [] };
  const used = usedDemoIds(messages);
  used.add(item.id);
  const chosen = item.followUps.map((fid) => all.find((x) => x.id === fid)).filter((x): x is DemoMessage => !!x);
  const options = chosen.length ? chosen : all.filter((x) => !used.has(x.id)).slice(0, MAX_NEXT);
  return { item, options };
}

export const ctaHref = (cta: DemoCta | undefined): '/' | '/explore' | '/pro' | null => (cta === 'tools' ? '/' : cta === 'explore' ? '/explore' : cta === 'pro' ? '/pro' : null);
export const CTA_ICON: Record<DemoCta, string> = { none: 'close-circle-outline', tools: 'toolbox-outline', explore: 'compass-outline', pro: 'crown-outline' };

/* ------------------------------------------------------------------ editing (Admin > Assistant > Demo messages) */

export const DEMO_ICONS = [
  'cash-multiple', 'rocket-launch-outline', 'camera-outline', 'palette-outline', 'image-off-outline', 'face-agent', 'sofa-outline', 'lightbulb-on-outline',
  'help-circle-outline', 'star-circle-outline', 'whatsapp', 'home-heart', 'ruler-square', 'brush-variant', 'sale-outline', 'truck-delivery-outline',
  'clock-outline', 'gift-outline', 'translate', 'shield-check-outline',
];

/** A unique id built from a base (`price`, `price-2`, …), accepted by the server (letters, digits, `_`, `-`, 64 max). */
export function uniqueDemoId(items: Pick<DemoMessage, 'id'>[], base = 'demo'): string {
  const root = (base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'demo').slice(0, 40);
  const taken = new Set(items.map((x) => x.id));
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n++) { const id = `${root}-${n}`; if (!taken.has(id)) return id; }
  return `${root}-${Date.now().toString(36)}`;
}

export const newDemoItem = (items: Pick<DemoMessage, 'id'>[]): DemoMessage => ({
  id: uniqueDemoId(items, 'demo'), enabled: true, icon: 'help-circle-outline', label: emptyL(), mode: 'click', prompt: emptyL(),
  reply: { type: 'text', text: emptyL() }, followUps: [], cta: 'none',
});

/** A customer question (from "most asked") turned into a demo message: the question is the label, the answer is left to the owner (AI answers until then). */
export function demoFromQuestion(items: Pick<DemoMessage, 'id'>[], text: string, lang: Lang): DemoMessage {
  const base = newDemoItem(items);
  return { ...base, label: { ...emptyL(), [lang]: text.trim().slice(0, 80) }, reply: { type: 'ai', text: emptyL() } };
}

export function duplicateDemoItem(items: DemoMessage[], id: string): DemoMessage | undefined {
  const src = items.find((x) => x.id === id);
  if (!src) return undefined;
  return { ...JSON.parse(JSON.stringify(src)) as DemoMessage, id: uniqueDemoId(items, src.id), followUps: [] };
}

/** Removes a demo message and every follow-up that pointed at it. */
export function removeDemoItem(items: DemoMessage[], id: string): DemoMessage[] {
  return items.filter((x) => x.id !== id).map((x) => (x.followUps.includes(id) ? { ...x, followUps: x.followUps.filter((f) => f !== id) } : x));
}

/** Follow-ups may only point at OTHER existing demo messages, once each, at most MAX_FOLLOW_UPS (same rules as the server). */
export function toggleFollowUp(item: DemoMessage, id: string): DemoMessage {
  if (id === item.id) return item;
  if (item.followUps.includes(id)) return { ...item, followUps: item.followUps.filter((f) => f !== id) };
  if (item.followUps.length >= MAX_FOLLOW_UPS) return item;
  return { ...item, followUps: [...item.followUps, id] };
}

/** Languages in which a text is missing (for the "translate" hint on the editor). */
export const missingLangs = (v?: LText): Lang[] => LANGS.filter((l) => !(v?.[l] || '').trim());

export type DemoIssue = 'noLabel' | 'noAnswer' | 'noPrompt';
/** Why a demo message may not work as the owner expects (shown as a small warning on the card). */
export function demoIssues(item: DemoMessage): DemoIssue[] {
  const issues: DemoIssue[] = [];
  if (!filled(item.label)) issues.push('noLabel');
  if (item.mode === 'click' && item.reply.type === 'text' && !filled(item.reply.text)) issues.push('noAnswer');
  if (item.mode === 'write' && !filled(item.prompt)) issues.push('noPrompt');
  return issues;
}

/** The suggestion count a person would see in each language (so the owner notices a language with an empty list). */
export const visibleCount = (config: DemoConfig, lang: Lang) => demoItems(config, lang).length;

/** Total taps and the best one, from the server counters `{ [id]: { used, last } }`. */
export function demoUsage(stats: Record<string, { used: number; last: number }> | undefined, items: Pick<DemoMessage, 'id'>[]) {
  const ids = new Set(items.map((x) => x.id));
  let total = 0, top = '', best = 0;
  for (const [id, s] of Object.entries(stats ?? {})) {
    if (!ids.has(id)) continue;
    total += s.used;
    if (s.used > best) { best = s.used; top = id; }
  }
  return { total, top, best };
}
