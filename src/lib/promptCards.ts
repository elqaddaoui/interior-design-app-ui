/**
 * Pure model of Admin > Prompt cards (no React, no network). Everything the screen decides lives here so it can be unit-checked
 * (`npm run check:promptcards`) and so the screen itself stays a thin layer of controls.
 *
 * Vocabulary
 *  - scope : EXPLORE (everything about the Explorer page), 'all' (the shared settings) or a tool id.
 *  - A tool card only ever holds its own STEPS (the prompt blocks): it either follows "All tools" (nothing stored) or overrides them.
 *    Rules, pictures, output and vocabulary are shared; the Explorer picture block follows the shared settings too.
 *  - step : one block of the prompt (task, structure, style, ...), shown to the admin as a "step".
 */
import type { PromptRules, PromptSet } from '../data/types';
import { moveTo } from './reorder';

export const EXPLORE = '@explore';
export type Scope = 'all' | typeof EXPLORE | string;
export const RULES_MAX = 2000;
export const BLOCK_MAX = 1500;
export const VOCAB_MAX = 400;
/** Steps that follow the shared picture settings: a tool never edits them on its own. */
export const PICTURE_BLOCKS = ['reference', 'styleImage', 'roomImage'];
/** Automatic steps: they exist only when their picture is sent (Image / Both). */
export const AUTO_ROLE: Record<string, 'style' | 'room'> = { styleImage: 'style', roomImage: 'room' };

export interface Catalog { order: string[]; blocks: Record<string, Record<string, string>>; off?: string[]; placeholders: string[]; vocab?: { styles: Record<string, string>; rooms: Record<string, string> } }

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** JSON with sorted keys: two objects with the same content are equal whatever order their keys were added in. */
export const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
export const same = (a: unknown, b: unknown) => canon(a) === canon(b);

/** Same rule as the server (`blockOn` in server/imagegen/blocks.js): an explicit switch wins, otherwise automatic steps follow their picture setting. */
export const blockOn = (id: string, item: { on?: boolean } | undefined, images: PromptSet['images']) =>
  typeof item?.on === 'boolean' ? item.on : AUTO_ROLE[id] ? images[AUTO_ROLE[id]] !== 'text' : true;

/* ---------------------------------------------------------------- reading */
export const isTool = (scope: Scope) => scope !== 'all' && scope !== EXPLORE;
/** The steps the screen shows: the tool's own when it overrides them, otherwise the shared ones. */
export const stepsOf = (rules: PromptRules, scope: Scope): PromptSet['blocks'] => (isTool(scope) ? rules.tools[scope]?.blocks ?? rules.global.blocks : rules.global.blocks);
export const hasOwnSteps = (rules: PromptRules, toolId: string) => !!rules.tools[toolId]?.blocks;

/**
 * Which steps a scope lists. Explorer: only the Explorer picture step. A tool: everything but the picture steps. All tools: everything but the
 * Explorer step; the style words step is hidden when the style travels as a picture only, the picture steps only exist when sent.
 */
export function visibleSteps(order: string[], scope: Scope, images: PromptSet['images']): string[] {
  return order.filter((id) => {
    if (scope === EXPLORE) return id === 'reference';
    if (id === 'reference') return false;
    if (isTool(scope) && PICTURE_BLOCKS.includes(id)) return false;
    if (id === 'style' && images.style === 'image') return false;
    return !AUTO_ROLE[id] || images[AUTO_ROLE[id]] !== 'text';
  });
}
/** The text fields of a step: the picture steps only have the field of the chosen type (Image or Both). */
export const variantsOf = (id: string, defaults: Catalog['blocks'], images: PromptSet['images']) => Object.keys(defaults[id] ?? {}).filter((v) => !AUTO_ROLE[id] || v === images[AUTO_ROLE[id]]);

/* ---------------------------------------------------------------- writing (always returns a new object) */
export function setSteps(rules: PromptRules, scope: Scope, value: PromptSet['blocks']): PromptRules {
  const next = clone(rules);
  if (isTool(scope)) next.tools[scope] = { ...next.tools[scope], blocks: value }; else next.global.blocks = value;
  return next;
}
/** "Customise for this tool": starts from a copy of the shared steps, or from what the admin had before (`stash`). */
export function customize(rules: PromptRules, toolId: string, stash?: PromptSet['blocks']): PromptRules {
  const next = clone(rules);
  next.tools[toolId] = { ...next.tools[toolId], blocks: clone(stash ?? rules.global.blocks) };
  return next;
}
/** Back to "same as All tools". `removed` is what the tool had, so the screen can bring it back if the admin changes their mind. */
export function inherit(rules: PromptRules, toolId: string): { rules: PromptRules; removed?: PromptSet['blocks'] } {
  if (!rules.tools[toolId]?.blocks) return { rules };
  const next = clone(rules); const removed = next.tools[toolId].blocks;
  delete next.tools[toolId];
  return { rules: next, removed };
}
/** Reuse: gives `to` a copy of the steps of `from` (a copy, not a link). From "All tools" or a tool without its own steps it simply resets `to`. */
export function copySteps(rules: PromptRules, from: Scope, to: string): PromptRules {
  if (from === to) return rules;
  const source = isTool(from) ? rules.tools[from]?.blocks : undefined;
  return source ? customize(rules, to, clone(source)) : inherit(rules, to).rules;
}
/** Is the step one of those the admin may drag / reorder in this scope. */
export const canReorder = (scope: Scope, visible: string[]) => scope !== EXPLORE && visible.length > 1;

/* ---------------------------------------------------------------- "is there anything to save?" */
/** Same tidying as the server (`text()` in server/imagegen/rules.js): spaces, line breaks, length. */
export function tidy(value: unknown, max: number, keepLines = true): string {
  const t = String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  return keepLines ? t : t.replace(/\n+/g, ' ');
}
/**
 * What the server would store for these rules (mirror of `cleanRules`, checked against it in scripts/check-promptcards.ts), so "unsaved
 * changes" only appears for a REAL change: a trailing space, or re-typing the original wording of a step, stores nothing.
 */
export function normalize(rules: PromptRules, catalog: Pick<Catalog, 'blocks' | 'off'>): PromptRules {
  const next = clone(rules);
  const cleanBlocks = (b: PromptSet['blocks']): PromptSet['blocks'] => {
    const items: PromptSet['blocks']['items'] = {};
    for (const [id, item] of Object.entries(b.items || {})) {
      const out: { on?: boolean; texts?: Record<string, string> } = {};
      // Most steps are on by default, so only `false` is stored; an automatic step keeps an explicit true / false.
      if (item.on === false || (item.on === true && catalog.off?.includes(id))) out.on = item.on;
      const texts: Record<string, string> = {};
      for (const [k, v] of Object.entries(item.texts || {})) { const t = tidy(v, BLOCK_MAX); if (t && t !== (catalog.blocks[id]?.[k] ?? '').trim()) texts[k] = t; }
      if (Object.keys(texts).length) out.texts = texts;
      if (Object.keys(out).length) items[id] = out;
    }
    return { order: b.order, items };
  };
  next.global.rules = { text: tidy(next.global.rules.text, RULES_MAX), exploreText: tidy(next.global.rules.exploreText, RULES_MAX) };
  next.global.blocks = cleanBlocks(next.global.blocks);
  for (const set of Object.values(next.tools)) if (set.blocks) set.blocks = cleanBlocks(set.blocks);
  for (const kind of ['styles', 'rooms'] as const) {
    const out: Record<string, string> = {};
    for (const [id, v] of Object.entries(next.vocab[kind] || {})) { const t = tidy(v, VOCAB_MAX, false); if (t) out[id] = t; }
    next.vocab[kind] = out;
  }
  return next;
}
export const isDirty = (draft: PromptRules, saved: PromptRules, catalog: Pick<Catalog, 'blocks' | 'off'>) => !same(normalize(draft, catalog), normalize(saved, catalog));

/* ---------------------------------------------------------------- steps */
export const moveStep = (order: string[], id: string, dir: -1 | 1): string[] => {
  const i = order.indexOf(id); const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order]; [next[i], next[j]] = [next[j], next[i]]; return next;
};
/** Moves a step up / down among the steps that are SHOWN: the hidden ones keep their place in the full order. */
export function moveVisible(order: string[], visible: string[], id: string, dir: -1 | 1): string[] {
  const i = visible.indexOf(id); const j = i + dir;
  if (i < 0 || j < 0 || j >= visible.length) return order;
  const next = [...order]; const x = next.indexOf(visible[i]); const y = next.indexOf(visible[j]);
  [next[x], next[y]] = [next[y], next[x]]; return next;
}
/** Drag and drop among the shown steps (same rule as every other admin list); hidden steps stay where they were. */
export function reorderVisible(order: string[], visible: string[], ids: string[], targetId: string): string[] {
  const moved = moveTo(visible.map((id) => ({ id })), ids, targetId).map((x) => x.id);
  const shown = new Set(visible); let k = 0;
  return order.map((id) => (shown.has(id) ? moved[k++] : id));
}
/** The {name}s of a text that the app does not know (they would be sent as typed). */
export const unknownVars = (text: string, known: string[]): string[] => [...new Set([...String(text).matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]).filter((n) => !known.includes(n)))];
/** Appends {name} at the end of a text (one space before it unless the text is empty / already ends with a space). */
export const insertVar = (current: string, name: string) => `${current}${current && !/\s$/.test(current) ? ' ' : ''}{${name}}`;
export const stepIsCustom = (b: PromptSet['blocks'], id: string, defaults: Catalog['blocks']) =>
  Object.entries(b.items[id]?.texts || {}).some(([k, v]) => !!v && v.trim() !== (defaults[id]?.[k] ?? '').trim());

/* ---------------------------------------------------------------- rules text */
/** One-tap ideas for the rules box (they are prompt text, so they stay in English whatever the admin's language). */
export const RULE_IDEAS = [
  'Keep the floor material unchanged',
  'Never add curtains',
  'Keep the same furniture layout',
  'Use natural, warm lighting',
  'Prefer local Moroccan materials and crafts',
];
const strip = (l: string) => l.replace(/^([-*\u2022]|\d+[.)])\s*/, '').trim().toLowerCase();
export const ruleLines = (text: string) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
export const hasRuleLine = (text: string, line: string) => ruleLines(text).some((l) => strip(l) === line.toLowerCase());
export const removeRuleLine = (text: string, line: string) => ruleLines(text).filter((l) => strip(l) !== line.toLowerCase()).join('\n');
/** Adds one rule on its own line; a rule already there is kept once, and the length limit is never exceeded. */
export function addRuleLine(text: string, line: string, max = RULES_MAX): string {
  if (hasRuleLine(text, line)) return text;
  const base = String(text || '').replace(/\s+$/, '');
  const next = base ? `${base}\n${line}` : line;
  return next.length > max ? text : next;
}

/* ---------------------------------------------------------------- tools */
/** A picture for the tool's tile: the poster of a video, the first slide of a slideshow, or the image itself. */
export function toolThumb(tool: { media?: { type?: string; uri?: string; poster?: string; images?: string[] } } | undefined): string {
  const m = tool?.media; if (!m) return '';
  if (m.type === 'video') return m.poster || '';
  if (m.type === 'slideshow') return m.images?.find(Boolean) || m.poster || '';
  return m.uri || m.poster || '';
}

/* ---------------------------------------------------------------- tab dots */
export type TabKey = 'rules' | 'images' | 'blocks' | 'words' | 'output';
/** Tabs of the All tools page. A tool card has no tabs (its steps only), Explorer has no tabs either. */
export const ALL_TABS: TabKey[] = ['rules', 'images', 'blocks', 'words', 'output'];
/**
 * Small dot on a tab / tile: "something is set here", i.e. it differs from what the app sends by default (a fresh install shows no dot at all).
 */
export function touched(rules: PromptRules, what: TabKey | 'explore', catalog: Pick<Catalog, 'order' | 'blocks' | 'off'>): boolean {
  const n = normalize(rules, catalog); const g = n.global;
  switch (what) {
    case 'rules': return !!g.rules.text;
    case 'images': return g.images.room !== 'text' || g.images.style !== 'text';
    case 'output': return g.output.brief !== 'both' || g.output.maxSide !== 0;
    case 'words': return Object.keys(n.vocab.styles).length + Object.keys(n.vocab.rooms).length > 0;
    case 'blocks': return g.blocks.order.some((id, i) => id !== catalog.order[i]) || Object.keys(g.blocks.items).length > 0;
    case 'explore': return n.appliesTo !== 'all' || !!g.rules.exploreText || !!g.blocks.items.reference;
  }
}

/* ---------------------------------------------------------------- touching a passage of the preview */
export type StepTarget = { scope: Scope; tab?: TabKey; focus?: string };
/**
 * Where a passage of the live preview is edited. The Explorer passage lives on the Explorer page, the rules text in the Rules tab, the picture
 * steps and the shared steps on All tools. A tool card shows its own passage in place (read-only until it is customised).
 */
export function stepTarget(scope: Scope, id: string): StepTarget {
  if (id === 'reference') return { scope: EXPLORE, focus: id };
  if (id === 'rules') return { scope: 'all', tab: 'rules' };
  if (PICTURE_BLOCKS.includes(id)) return { scope: 'all', tab: 'blocks', focus: id };
  if (isTool(scope)) return { scope, focus: id };
  return { scope: 'all', tab: 'blocks', focus: id };
}
/** The steps that light up in the preview while a tab / page is open. */
export const HIGHLIGHT: Record<string, string[]> = { rules: ['rules'], images: ['reference', 'styleImage', 'roomImage'], blocks: [], words: ['style', 'task'], output: ['brief'], explore: ['reference', 'rules'] };

/* ---------------------------------------------------------------- the test case of the live preview */
export interface TestCase { toolId: string; styleId: string; roomId: string; insId: string; paletteId: string; mode: 'restyle' | 'renovation'; brief: string }
interface Row { id: string; group?: string; roomGroup?: string }
/**
 * The case the preview really runs: a tool card previews its own tool, and the room type always matches the tool's group (a garden tool is
 * never previewed with a bedroom). '' means "None" and is kept. On the Explorer page the case starts from an Explorer picture.
 */
export function effectiveCase(tc: TestCase, scope: Scope, tools: Row[], rooms: Row[], inspirations: { id: string }[] = []): TestCase {
  const toolId = isTool(scope) ? scope : tools.some((t) => t.id === tc.toolId) ? tc.toolId : tools[0]?.id || '';
  const group = tools.find((t) => t.id === toolId)?.roomGroup;
  const fits = (r: Row) => !group || !r.group || r.group === group;
  const roomId = tc.roomId === '' ? '' : rooms.some((r) => r.id === tc.roomId && fits(r)) ? tc.roomId : rooms.find(fits)?.id || '';
  const insId = scope === EXPLORE && !tc.insId ? inspirations[0]?.id || '' : tc.insId;
  return { ...tc, toolId, roomId, insId };
}
export function startCase(tools: Row[], styles: Row[], rooms: Row[], explore = false): TestCase {
  return { toolId: tools[0]?.id || '', styleId: explore ? '' : styles[0]?.id || '', roomId: explore ? '' : rooms[0]?.id || '', insId: '', paletteId: '', mode: 'restyle', brief: '' };
}
