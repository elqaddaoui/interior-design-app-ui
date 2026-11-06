/**
 * What the assistant knows about the app: sections from server/knowledge/kb.json (built by scripts/build-knowledge.js from
 * docs/APP_KNOWLEDGE.md + the app data) plus the owner's own notes. Retrieval is keyword based (no embeddings, no extra
 * service) and multilingual: Latin words match as whole words, Arabic words match inside a word.
 */
const { normalize, hasTerm } = require('./automations');

let cached = null;
function load() {
  if (cached) return cached;
  let raw = { sections: [], screens: [] };
  try { raw = require('../knowledge/kb.json'); } catch { /* not built: the assistant then says it does not know */ }
  const sections = (raw.sections || []).map(section => ({
    ...section,
    kw: [...new Set((section.keywords || []).map(normalize).filter(Boolean))],
    titleWords: normalize(section.title).split(' ').filter(word => word.length > 3),
  }));
  cached = { sections, screens: raw.screens || [] };
  return cached;
}

const MAX_FACTS = 3500;
const ALWAYS = ['about'];

/** Sections that answer `text`, best first: [{ id, title, score }]. Words typed by the user are matched against each section's keywords. */
function search(text, { max = 3 } = {}) {
  const norm = normalize(text);
  if (!norm) return [];
  const words = new Set(norm.split(' '));
  const hits = [];
  for (const section of load().sections) {
    let score = 0;
    for (const term of section.kw) if (hasTerm(norm, term)) score += term.includes(' ') ? 4 : 3;
    for (const word of section.titleWords) if (words.has(word)) score += 2;
    if (score >= 3) hits.push({ id: section.id, title: section.title, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, max);
}

/**
 * The facts block added to the system prompt. `texts`: the last user messages (the previous one helps short follow-ups such
 * as "and the price?"). `notes`: the owner's own notes. Returns { prompt, ids }.
 */
function facts(texts, notes = '') {
  const list = (Array.isArray(texts) ? texts : [texts]).filter(Boolean);
  const last = list[list.length - 1] || '';
  const found = search(last);
  if (!found.length && normalize(last).split(' ').length < 5 && list.length > 1) found.push(...search(list[list.length - 2]));
  const ids = [...new Set([...ALWAYS, ...found.map(hit => hit.id)])];
  const byId = new Map(load().sections.map(section => [section.id, section]));
  let body = '';
  for (const id of ids) {
    const section = byId.get(id);
    if (!section) continue;
    const next = `[${section.title}]\n${section.text}\n\n`;
    if (body.length + next.length > MAX_FACTS) break;
    body += next;
  }
  const owner = String(notes || '').trim().slice(0, 1500);
  const prompt = [
    'APP FACTS (the only source for statements about the Dwira app: its screens, tools, steps, settings, credits, account and problems):',
    body.trim() || '(nothing available)',
    owner ? `Owner notes (also facts):\n${owner}` : '',
    'FACT RULES: answer questions about the app only with what is written in the APP FACTS. Never invent prices, offers, features, delivery times, policies or buttons. If the answer is not in the facts, say plainly (in the user\'s language) that you do not know that one and that the team will confirm it; do not guess, and do not tell the user to contact anyone when the facts already answer. General decoration advice does not need the facts.',
  ].filter(Boolean).join('\n\n');
  return { prompt, ids };
}

/** For the admin "Knowledge" tab: what the assistant knows. */
function overview() {
  const { sections, screens } = load();
  return { sections: sections.map(({ id, title, keywords, text }) => ({ id, title, keywords: keywords.length, chars: text.length, text })), screens };
}

module.exports = { search, facts, overview, load };
