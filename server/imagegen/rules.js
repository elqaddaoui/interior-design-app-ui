/**
 * Prompt rules: what the admin decides about the prompt and the pictures that reach the image model.
 *
 *   { v: 1, appliesTo: 'all' | 'explore', global: PromptSet, tools: { [toolId]: Partial<PromptSet> }, vocab: { styles: {id: text}, rooms: {id: text} } }
 *   PromptSet = { rules, images, blocks, output }
 *
 * `global` applies to every tool card. A tool entry holds only the sections that tool overrides (a missing section = "same as all
 * tools"). Everything is stored server-side (settings.prompt_rules), never in the public content, and always passes through
 * `cleanRules`, so nothing reaches the prompt builder unvalidated.
 */
const { DEFAULT_ORDER, BLOCKS } = require('./blocks');

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const SECTIONS = ['rules', 'images', 'blocks', 'output'];
const SRC = ['text', 'image', 'both'];
const BRIEF = ['both', 'english', 'original'];
const MAX_SIDES = [0, 768, 1024, 1280, 1536];
const LIMITS = { rules: 2000, block: 1500, vocab: 400, tools: 200, vocabItems: 300 };

/** Multi-line free text: control characters out, spaces tidied, line breaks kept (rules are often a list). */
function text(value, max) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

const defaultSet = () => ({
  rules: { text: '', exploreText: '' },
  images: { room: 'text', style: 'text', inspiration: 'image' },
  blocks: { order: [...DEFAULT_ORDER], items: {} },
  output: { brief: 'both', maxSide: 0 },
});

function cleanRulesSection(input, isTool) {
  const section = isObject(input) ? input : {};
  const out = { text: text(section.text, LIMITS.rules), exploreText: text(section.exploreText, LIMITS.rules) };
  if (isTool) out.withGlobal = section.withGlobal !== false;
  return out;
}
function cleanImages(input) {
  const section = isObject(input) ? input : {};
  return { room: oneOf(section.room, SRC, 'text'), style: oneOf(section.style, SRC, 'text'), inspiration: oneOf(section.inspiration, ['image', 'off'], 'image') };
}
function cleanBlocks(input) {
  const section = isObject(input) ? input : {};
  const order = [];
  for (const id of Array.isArray(section.order) ? section.order : []) if (typeof id === 'string' && BLOCKS[id] && !order.includes(id)) order.push(id);
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
  const items = {};
  for (const id of Object.keys(BLOCKS)) {
    const raw = isObject(section.items) && isObject(section.items[id]) ? section.items[id] : null;
    if (!raw) continue;
    const item = {};
    if (raw.on === false) item.on = false;
    const texts = {};
    for (const key of Object.keys(BLOCKS[id].variants)) {
      const value = isObject(raw.texts) ? text(raw.texts[key], LIMITS.block) : '';
      // Only real customisations are stored: the default wording is never copied, so a later improvement of the default still reaches the block.
      if (value && value !== BLOCKS[id].variants[key].trim()) texts[key] = value;
    }
    if (Object.keys(texts).length) item.texts = texts;
    if (Object.keys(item).length) items[id] = item;
  }
  return { order, items };
}
function cleanOutput(input) {
  const section = isObject(input) ? input : {};
  const side = Number(section.maxSide);
  return { brief: oneOf(section.brief, BRIEF, 'both'), maxSide: MAX_SIDES.includes(side) ? side : 0 };
}
const CLEANERS = { rules: cleanRulesSection, images: cleanImages, blocks: cleanBlocks, output: cleanOutput };

function cleanVocab(input) {
  const out = { styles: {}, rooms: {} };
  for (const kind of ['styles', 'rooms']) {
    const map = isObject(input?.[kind]) ? input[kind] : {};
    let count = 0;
    for (const [id, value] of Object.entries(map)) {
      if (!ID.test(id) || count >= LIMITS.vocabItems) continue;
      const clean = text(value, LIMITS.vocab).replace(/\n+/g, ' ');
      if (clean) { out[kind][id] = clean; count++; }
    }
  }
  return out;
}

/** Validates and normalises anything (stored JSON, an admin request body). Never throws on bad fields: they fall back to the defaults. */
function cleanRules(input) {
  const source = isObject(input) ? input : {};
  const global = {};
  for (const name of SECTIONS) global[name] = CLEANERS[name](isObject(source.global) ? source.global[name] : undefined, false);
  const tools = {};
  let count = 0;
  for (const [id, entry] of Object.entries(isObject(source.tools) ? source.tools : {})) {
    if (!ID.test(id) || !isObject(entry) || count >= LIMITS.tools) continue;
    const set = {};
    for (const name of SECTIONS) if (isObject(entry[name])) set[name] = CLEANERS[name](entry[name], true);
    if (Object.keys(set).length) { tools[id] = set; count++; }
  }
  return { v: 1, appliesTo: oneOf(source.appliesTo, ['all', 'explore'], 'all'), global, tools, vocab: cleanVocab(source.vocab) };
}

/** The settings that really apply to one tool, plus where each section comes from. `explore`: the generation started from an Explore picture. */
function resolveRules(rules, toolId, explore = false) {
  const stored = rules && rules.v === 1 ? rules : cleanRules(rules);
  const own = stored.tools[toolId] || {};
  const g = stored.global;
  const scope = {};
  for (const name of SECTIONS) scope[name] = own[name] ? 'tool' : 'global';
  const join = (...parts) => parts.filter(Boolean).join('\n');
  let ruleText = g.rules.text, exploreText = g.rules.exploreText;
  if (own.rules) {
    ruleText = own.rules.withGlobal === false ? own.rules.text : join(g.rules.text, own.rules.text);
    exploreText = own.rules.withGlobal === false ? own.rules.exploreText : join(g.rules.exploreText, own.rules.exploreText);
  }
  return {
    images: own.images || g.images, blocks: own.blocks || g.blocks, output: own.output || g.output,
    rulesText: join(ruleText, explore ? exploreText : ''), scope, vocab: stored.vocab,
  };
}

module.exports = { cleanRules, resolveRules, defaultSet, defaultRules: () => cleanRules({}), SECTIONS, LIMITS };
