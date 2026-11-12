/**
 * Pure model of Admin > Assistant: provider status/config drafts and the owner's automations.
 * No React, no network: the screen is a thin layer over these functions (checked by scripts/check-assistant.ts).
 */
import { moveTo } from './reorder';

export type Lang = 'auto' | 'darija' | 'arabic' | 'french';
export type TriggerType = 'keyword' | 'intent' | 'first_visit' | 'schedule' | 'button';
export type ReplyType = 'fixed' | 'template' | 'ai';
export const LANGS: Lang[] = ['auto', 'darija', 'arabic', 'french'];
export const TRIGGER_TYPES: TriggerType[] = ['keyword', 'intent', 'first_visit', 'schedule', 'button'];
export const REPLY_TYPES: ReplyType[] = ['fixed', 'template', 'ai'];
export const VARS = ['name', 'app', 'credits', 'date', 'time', 'greeting'] as const;
export const MAX_AUTOMATIONS = 100;
export const MAX_PAID = 6;

export interface Schedule { days: number[]; from: string; to: string; tz: string }
export interface Automation {
  id: string; name: string; enabled: boolean;
  trigger: { type: TriggerType; keywords: string[]; intents: string[]; schedule: Schedule; buttonLabel: string };
  reply: { type: ReplyType; text: string; instructions: string };
  language: Lang; oncePerChat: boolean; createdAt?: number; updatedAt?: number;
  /** Read-only counters sent by the server. */
  used?: number; lastUsedAt?: number;
}
export interface AutomationsInfo {
  items: Automation[];
  totals: { ai: number; automations: number; failed: number; providers: Record<string, number> };
  intents: string[]; vars: string[]; max: number;
}

export type ProvState = 'off' | 'cooling' | 'ready' | 'active' | 'failed';
export interface Last { ok: boolean; at: number; reason: string; model: string }
export interface FreeProvider { id: string; label: string; rank: number; configured: boolean; source: 'env' | 'db' | 'none'; enabled: boolean; needsKey: boolean; models: string[]; state: ProvState; last: Last | null; resting: string }
export interface PaidProvider { id: string; label: string; preset: string; baseUrl: string; model: string; enabled: boolean; hasKey: boolean; state: ProvState; last: Last | null; resting: string; url: string }
export interface ChatStatus { managed?: boolean; free: FreeProvider[]; paid: { position: 'before' | 'after'; providers: PaidProvider[] }; presets: Record<string, { label: string; model: string }>; maxPaid: number }

/** What the owner edits. `key` on a paid provider is write-only: undefined = keep, '' = remove, text = replace. */
export interface PaidDraft { id: string; label: string; preset: string; baseUrl: string; model: string; enabled: boolean; hasKey: boolean; key?: string }
export interface ProvConfig { position: 'before' | 'after'; freeOff: string[]; paid: PaidDraft[] }

/* ------------------------------------------------------------------ providers */
export const configOf = (status: ChatStatus): ProvConfig => ({
  position: status.paid.position,
  freeOff: status.free.filter((p) => !p.enabled).map((p) => p.id),
  paid: status.paid.providers.map((p) => ({ id: p.id, label: p.label, preset: p.preset, baseUrl: p.baseUrl, model: p.model, enabled: p.enabled, hasKey: p.hasKey })),
});
const norm = (c: ProvConfig) => JSON.stringify({ position: c.position, freeOff: [...c.freeOff].sort(), paid: c.paid.map((p) => ({ id: p.id, label: p.label, preset: p.preset, baseUrl: p.baseUrl, model: p.model, enabled: p.enabled, key: p.key })) });
export const configDirty = (a: ProvConfig, b: ProvConfig) => norm(a) !== norm(b);
/** A paid provider can only run with a key (saved or just typed) and its switch on: the switch is locked until there is a key. */
export const paidUsable = (p: PaidDraft) => p.enabled && (p.hasKey ? p.key !== '' : !!p.key);
export const canEnable = (p: PaidDraft) => (p.hasKey ? p.key !== '' : !!p.key);
export const newPaid = (preset: string, presets: ChatStatus['presets']): PaidDraft => ({ id: `new_${Math.random().toString(16).slice(2, 10)}`, label: presets[preset]?.label ?? '', preset, baseUrl: '', model: presets[preset]?.model ?? '', enabled: false, hasKey: false });
/** Body of PUT /admin/chat/config. Keys are only sent when typed (or '' to remove). */
export function configBody(c: ProvConfig) {
  return { position: c.position, freeOff: c.freeOff, paid: c.paid.map((p) => ({ ...(p.id.startsWith('new_') ? {} : { id: p.id }), label: p.label, preset: p.preset, baseUrl: p.baseUrl, model: p.model, enabled: p.enabled && canEnable(p), ...(p.key !== undefined ? { key: p.key } : {}) })) };
}
/** Error codes of a paid provider the screen can show before the server refuses it. */
export function paidErrors(p: PaidDraft): ('url' | 'model' | 'key')[] {
  const out: ('url' | 'model' | 'key')[] = [];
  if (p.preset === 'custom' && !/^https:\/\/[^\s/@]+(\/\S*)?$/i.test(p.baseUrl.trim())) out.push('url');
  if (!p.model.trim()) out.push('model');
  if (p.key && !/^[A-Za-z0-9_.\-]{16,300}$/.test(p.key)) out.push('key');
  return out;
}
export const orderedChain = (status: ChatStatus, c: ProvConfig) => {
  const free = status.free.filter((p) => !c.freeOff.includes(p.id) && (p.configured || !p.needsKey)).map((p) => ({ id: p.id, label: p.label, paid: false }));
  const paid = c.paid.filter((p) => paidUsable(p)).map((p) => ({ id: p.id, label: p.label, paid: true }));
  return c.position === 'before' ? [...paid, ...free] : [...free, ...paid];
};

/* ------------------------------------------------------------------ automations */
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
export const newAutomationId = () => `auto_${hex(12)}`;
export const blankAutomation = (type: TriggerType = 'keyword'): Automation => ({
  id: newAutomationId(), name: '', enabled: true,
  trigger: { type, keywords: [], intents: [], schedule: { days: [], from: '18:00', to: '09:00', tz: 'Africa/Casablanca' }, buttonLabel: '' },
  reply: { type: 'fixed', text: '', instructions: '' },
  language: 'auto', oncePerChat: type === 'first_visit' || type === 'schedule',
});
export const duplicateOf = (a: Automation, suffix: string): Automation => ({ ...JSON.parse(JSON.stringify(a)), id: newAutomationId(), name: `${a.name} ${suffix}`.slice(0, 80), used: undefined, lastUsedAt: undefined, createdAt: undefined, updatedAt: undefined });
export const moveAutomation = (list: Automation[], id: string, direction: -1 | 1): Automation[] => {
  const i = list.findIndex((a) => a.id === id), j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; return next;
};
export const dropAutomation = (list: Automation[], ids: string[], targetId: string) => moveTo(list, ids, targetId);
const strip = (a: Automation) => JSON.stringify({ ...a, used: 0, lastUsedAt: 0, createdAt: 0, updatedAt: 0 });
export const listDirty = (a: Automation[], b: Automation[]) => a.length !== b.length || a.some((x, i) => strip(x) !== strip(b[i]));
/** Missing pieces of an automation, as codes the screen translates. Empty = can be saved. */
export function automationErrors(a: Automation): string[] {
  const out: string[] = [];
  if (!a.name.trim()) out.push('name');
  if (a.trigger.type === 'keyword' && !a.trigger.keywords.length) out.push('keywords');
  if (a.trigger.type === 'intent' && !a.trigger.intents.length) out.push('intents');
  if (a.trigger.type === 'button' && !a.trigger.buttonLabel.trim()) out.push('buttonLabel');
  if (a.reply.type === 'ai' ? !a.reply.instructions.trim() : !a.reply.text.trim()) out.push(a.reply.type === 'ai' ? 'instructions' : 'text');
  return out;
}
export const unknownVars = (text: string) => [...new Set([...text.matchAll(/\{([A-Za-z_]+)(?:\|[^{}]*)?\}/g)].map((m) => m[1].toLowerCase()).filter((n) => !(VARS as readonly string[]).includes(n)))];
/** Adds {name} at the end of a text, on its own space (the screen has no cursor position on every platform). */
export const insertVar = (text: string, name: string) => `${text}${text && !/\s$/.test(text) ? ' ' : ''}{${name}}`;
/** "salam, slm ; hello" -> ['salam','slm','hello'] (comma, semicolon, new line or Arabic comma). */
export const parseKeywords = (raw: string) => [...new Set(raw.split(/[,;\n،؛]+/).map((k) => k.trim().slice(0, 60)).filter(Boolean))].slice(0, 40);
export const timeOk = (v: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim());
export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** A few ready-made automations for an empty list (the owner edits them before saving). */
export type StarterId = 'welcome' | 'hours' | 'prices';
export function starter(id: StarterId, texts: { name: string; text: string }): Automation {
  const base = blankAutomation(id === 'welcome' ? 'first_visit' : id === 'hours' ? 'schedule' : 'intent');
  if (id === 'prices') base.trigger.intents = ['pricing'];
  base.name = texts.name; base.reply = { type: 'template', text: texts.text, instructions: '' };
  return base;
}
/** Total tokens the owner sees on the list: short trigger summary, no translation here (the screen adds words). */
export const triggerSummary = (a: Automation) => a.trigger.type === 'keyword' ? a.trigger.keywords.slice(0, 3).join(' · ') + (a.trigger.keywords.length > 3 ? ' …' : '')
  : a.trigger.type === 'intent' ? a.trigger.intents.join(' · ')
  : a.trigger.type === 'button' ? a.trigger.buttonLabel
  : a.trigger.type === 'schedule' ? `${a.trigger.schedule.from}–${a.trigger.schedule.to}` : '';
