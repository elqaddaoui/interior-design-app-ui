/**
 * Demo messages (the suggestions shown in an empty assistant chat): the definition lives in the public `assistant` document
 * (the owner edits it like any other setting); this module only adds what must not be public or client-side:
 *   - click counters (which demo message people actually pick),
 *   - the "most asked" list: real customer questions grouped by meaning, so the owner can promote them to demo messages.
 * Pure functions + two thin database helpers. No network.
 */
const A = require('./automations');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Intents that are not questions worth a demo message. */
const SKIP_INTENTS = new Set(['greeting', 'thanks', 'goodbye']);

/**
 * conversations: [{ messages: [{ role, text, createdAt }] }]. Only what customers typed is read (never admin / assistant text).
 * Returns the `limit` most asked questions: { text (the most common wording), count, intent ('' when none), chats (distinct conversations), last }.
 * Questions are grouped by built-in intent first (so "chhal taman" and "combien ça coûte" count together), then by identical wording.
 */
function popular(conversations, { limit = 8, minLength = 4, maxLength = 140 } = {}) {
  const groups = new Map();
  for (const conversation of Array.isArray(conversations) ? conversations : []) {
    const seen = new Set();
    for (const message of Array.isArray(conversation?.messages) ? conversation.messages : []) {
      if (!message || message.role !== 'user' || typeof message.text !== 'string') continue;
      const text = message.text.replace(/\s+/g, ' ').trim();
      if (text.length < minLength || text.length > maxLength) continue;
      const norm = A.normalize(text);
      if (!norm) continue;
      const intent = A.INTENT_IDS.find(id => A.intentMatch(id, norm)) || '';
      if (SKIP_INTENTS.has(intent)) continue;
      const key = intent ? `i:${intent}` : `t:${norm}`;
      const group = groups.get(key) || { intent, count: 0, chats: 0, last: 0, wordings: new Map() };
      group.count++;
      if (!seen.has(key)) { group.chats++; seen.add(key); }
      group.last = Math.max(group.last, Number(message.createdAt) || 0);
      group.wordings.set(text, (group.wordings.get(text) || 0) + 1);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map(group => ({
      text: [...group.wordings.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0],
      count: group.count, intent: group.intent, chats: group.chats, last: group.last,
    }))
    .sort((a, b) => b.chats - a.chats || b.count - a.count || b.last - a.last)
    .slice(0, Math.max(1, Math.min(30, limit)));
}

/* ------------------------------------------------------------------ validation */
const MAX_ITEMS = 30, MAX_FOLLOW = 4;
const CTAS = ['none', 'tools', 'explore', 'pro'];
const ICON_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const text = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const ltext = (value, max) => { const v = value && typeof value === 'object' ? value : {}; return { dar: text(v.dar, max), ar: text(v.ar, max), fr: text(v.fr, max) }; };
const filled = value => !!(value.dar || value.ar || value.fr);

/**
 * The `demo` part of the assistant document, sanitised: bounded sizes, unknown fields dropped, follow-ups only point at other existing
 * demo messages (never itself, no duplicates, at most 4). Throws 400 INVALID_DEMO for a shape that cannot be used.
 */
function cleanDemo(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.items) || input.items.length > MAX_ITEMS) throw Object.assign(new Error('INVALID_DEMO'), { status: 400 });
  const seen = new Set();
  const items = input.items.map(raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !ID_RE.test(raw.id) || seen.has(raw.id)) throw Object.assign(new Error('INVALID_DEMO'), { status: 400 });
    seen.add(raw.id);
    const label = ltext(raw.label, 80);
    if (!filled(label)) throw Object.assign(new Error('INVALID_DEMO'), { status: 400 });
    const reply = raw.reply && typeof raw.reply === 'object' ? raw.reply : {};
    const type = reply.type === 'ai' ? 'ai' : 'text';
    return {
      id: raw.id, enabled: raw.enabled !== false, icon: typeof raw.icon === 'string' && ICON_RE.test(raw.icon) && raw.icon.length <= 60 ? raw.icon : 'message-text-outline',
      label, mode: raw.mode === 'write' ? 'write' : 'click', prompt: ltext(raw.prompt, 200),
      reply: { type, text: ltext(reply.text, 1500) },
      followUps: Array.isArray(raw.followUps) ? raw.followUps.filter(x => typeof x === 'string') : [],
      cta: CTAS.includes(raw.cta) ? raw.cta : 'none',
    };
  });
  for (const item of items) item.followUps = [...new Set(item.followUps)].filter(id => id !== item.id && seen.has(id)).slice(0, MAX_FOLLOW);
  return {
    enabled: input.enabled !== false, title: ltext(input.title, 120), subtitle: ltext(input.subtitle, 200),
    layout: input.layout === 'chips' ? 'chips' : 'cards', items,
  };
}

function createDemo(db, { clock = Date.now } = {}) {
  const key = id => `asst_n:demo:${id}`;
  /** Public: one tap on a demo message. Atomic increment; a counter must never break the chat, so errors are swallowed. */
  async function click(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw Object.assign(new Error('INVALID_DEMO'), { status: 400 });
    try {
      await db.query("INSERT INTO settings(key,value) VALUES($1,'1') ON CONFLICT (key) DO UPDATE SET value=((settings.value)::bigint+1)::text", [key(id)]);
      await db.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [`asst_t:demo:${id}`, String(clock())]);
    } catch { /* counter only */ }
  }
  /** Admin: { [id]: { used, last } } for every demo message that was ever picked. */
  async function stats() {
    const rows = await db.query("SELECT key, value FROM settings WHERE key LIKE 'asst_n:demo:%' OR key LIKE 'asst_t:demo:%'");
    const out = {};
    for (const row of rows) {
      const n = row.key.startsWith('asst_n:demo:');
      const id = row.key.slice(n ? 12 : 12);
      out[id] ||= { used: 0, last: 0 };
      if (n) out[id].used = Number(row.value) || 0; else out[id].last = Number(row.value) || 0;
    }
    return out;
  }
  return { click, stats, popular };
}

module.exports = { createDemo, popular, cleanDemo };
