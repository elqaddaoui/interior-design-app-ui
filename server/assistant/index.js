/**
 * The assistant pipeline behind POST /api/chat/reply:
 *
 *   1. the owner's automations (in list order, first match wins)  -> fixed / template / AI-written-from-instructions reply
 *   2. otherwise the AI, grounded on the app knowledge base       -> free providers, then paid ones (or paid first), with fallback
 *
 * Automations and counters live in the private `settings` table (never in the public content docs: AI instructions are not for visitors).
 * Counters are single-row atomic increments, so concurrent chats never lose a count.
 */
const { detectLanguage } = require('../chat');
const A = require('./automations');
const knowledge = require('./knowledge');
const { createDemo } = require('./demo');

const LIST_KEY = 'assistant_automations';
const fail = (status, code) => Object.assign(new Error(code), { status });
const TURN_ROLES = ['user', 'assistant', 'admin'];
/** Names of the language an automation forces, as `detectLanguage` spells them. */
const forcedLanguage = (wanted, detected) => (wanted === 'darija' ? (detected === 'darija_latin' ? 'darija_latin' : 'darija') : wanted === 'arabic' || wanted === 'french' ? wanted : detected);

function createAssistant(db, { chat, content, clock = Date.now } = {}) {
  let listCache = { at: 0, value: null };
  async function getList() {
    if (listCache.value && clock() - listCache.at < 5000) return listCache.value;
    let value = [];
    try { const row = (await db.query('SELECT value FROM settings WHERE key=$1', [LIST_KEY]))[0]; if (row) value = JSON.parse(row.value); } catch { /* none yet */ }
    listCache = { at: clock(), value };
    return value;
  }
  const bump = async name => {
    try {
      await db.query("INSERT INTO settings(key,value) VALUES($1,'1') ON CONFLICT (key) DO UPDATE SET value=((settings.value)::bigint+1)::text", [`asst_n:${name}`]);
      if (name.startsWith('auto:')) await db.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [`asst_t:${name.slice(5)}`, String(clock())]);
    } catch { /* a counter must never break a reply */ }
  };
  async function counts() {
    const rows = await db.query("SELECT key, value FROM settings WHERE key LIKE 'asst_n:%' OR key LIKE 'asst_t:%'");
    const n = {}, t = {};
    for (const row of rows) { if (row.key.startsWith('asst_n:')) n[row.key.slice(7)] = Number(row.value) || 0; else t[row.key.slice(7)] = Number(row.value) || 0; }
    return { n, t };
  }

  /** Admin: the list with a usage counter per automation, and the totals. */
  async function overview() {
    const list = await getList(), { n, t } = await counts();
    const providers = {};
    for (const key of Object.keys(n)) if (key.startsWith('prov:')) providers[key.slice(5)] = n[key];
    return {
      items: list.map(item => ({ ...item, used: n[`auto:${item.id}`] || 0, lastUsedAt: t[item.id] || 0 })),
      totals: { ai: n.ai || 0, automations: list.reduce((sum, item) => sum + (n[`auto:${item.id}`] || 0), 0), failed: n.fail || 0, providers },
      intents: A.INTENT_IDS, vars: A.VARS, max: A.MAX_AUTOMATIONS,
    };
  }
  /** Admin: replaces the whole list (order = priority). Counters of deleted automations are dropped; the others are kept. */
  async function saveList(input) {
    const items = A.cleanList(Array.isArray(input) ? input : input?.items);
    const old = await getList();
    const byId = new Map(old.map(item => [item.id, item]));
    const now = clock();
    const next = items.map(item => {
      const before = byId.get(item.id);
      // Unchanged automations keep their updatedAt: the date means "last edited".
      const same = before && JSON.stringify({ ...before, updatedAt: 0 }) === JSON.stringify({ ...item, createdAt: before.createdAt, updatedAt: 0 });
      return before ? { ...item, createdAt: before.createdAt, updatedAt: same ? before.updatedAt : now } : { ...item, createdAt: now, updatedAt: now };
    });
    await db.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [LIST_KEY, JSON.stringify(next)]);
    listCache = { at: clock(), value: next };
    for (const item of old) if (!next.some(n => n.id === item.id)) await db.query('DELETE FROM settings WHERE key=$1 OR key=$2', [`asst_n:auto:${item.id}`, `asst_t:${item.id}`]);
    return overview();
  }
  /** Public: the quick-reply buttons of the chat (labels only, never the replies). */
  async function buttons() {
    return (await getList()).filter(item => item.enabled && item.trigger.type === 'button').map(item => ({ id: item.id, label: item.trigger.buttonLabel, language: item.language }));
  }

  const turnsOf = messages => (Array.isArray(messages) ? messages : []).filter(m => m && typeof m.text === 'string' && TURN_ROLES.includes(m.role) && (m.text.trim() || m.image || m.audio));
  const brand = async () => { try { return (await content.getDoc('branding'))?.appName || 'Dwira'; } catch { return 'Dwira'; } };

  async function automationReply(automation, { turns, config, language, client, appName, now, notes }) {
    const lang = forcedLanguage(automation.language, language);
    if (automation.reply.type === 'ai') {
      const lastUsers = turns.filter(t => t.role === 'user').slice(-2).map(t => t.text);
      const result = await chat.reply(turns, config, { language: automation.language === 'auto' ? undefined : automation.language, instructions: automation.reply.instructions, facts: knowledge.facts(lastUsers, notes).prompt });
      return { ...result, automationId: automation.id, automationName: automation.name };
    }
    const tz = automation.trigger.type === 'schedule' ? automation.trigger.schedule.tz : A.DEFAULT_TZ;
    const text = A.render(automation.reply.text, A.variables({ client, appName, language: lang, now, tz }));
    return { text, provider: 'automation', model: '', label: automation.name, language, paid: false, status: 'automation', tried: [], automationId: automation.id, automationName: automation.name };
  }

  /**
   * body: { messages: [{ role, text }], buttonId?, used?: [automation ids already answered in this chat] }.
   * `client`: { name, credits } or null (visitor). `count: false` for the admin preview.
   * Returns { text, provider, model, label, language, status, paid, tried, automationId?, automationName? }
   * (status: automation | active | fallback | paid). Throws 503 NO_PROVIDER (with `.tried`) when the AI chain fails.
   */
  async function answer(body, { config = {}, client = null, count = true } = {}) {
    const turns = turnsOf(body?.messages);
    const lastUser = [...turns].reverse().find(t => t.role === 'user');
    if (!turns.length || turns[turns.length - 1].role !== 'user') throw fail(400, 'INVALID_MESSAGES');
    const language = detectLanguage(lastUser.text);
    const now = clock(), appName = await brand();
    const used = new Set((Array.isArray(body?.used) ? body.used : []).filter(id => typeof id === 'string').slice(0, 200));
    const first = turns.filter(t => t.role === 'user').length <= 1;
    const buttonId = typeof body?.buttonId === 'string' ? body.buttonId : '';
    const notes = config.knowledgeNotes || '';
    const hit = A.pick(await getList(), { norm: A.normalize(lastUser.text), language, first, buttonId, now, used });
    if (buttonId && !hit) throw fail(404, 'BUTTON_NOT_FOUND');
    let result;
    try {
      if (hit) {
        result = await automationReply(hit, { turns, config, language, client, appName, now, notes });
        // An AI automation whose providers are all down must not leave the user hanging: the knowledge-grounded chain below was already tried inside it.
      } else {
        const lastUsers = turns.filter(t => t.role === 'user').slice(-2).map(t => t.text);
        result = await chat.reply(turns, config, { facts: knowledge.facts(lastUsers, notes).prompt });
      }
    } catch (error) {
      if (count && error.message === 'NO_PROVIDER') await bump('fail');
      throw error;
    }
    if (count) {
      if (result.automationId && result.provider === 'automation') await bump(`auto:${result.automationId}`);
      else { await bump(result.automationId ? `auto:${result.automationId}` : 'ai'); await bump(`prov:${result.provider}`); }
    }
    return result;
  }

  /**
   * Admin preview, nothing is counted. body: { text, automation?, first?, buttonId? }
   *   with `automation` (a draft, possibly unsaved): says whether it would trigger for `text`, and always writes its reply.
   *   without: runs the real pipeline with the saved automations (what a visitor would get).
   * Replies as a sample customer ("Amine", 3 credits).
   */
  async function test(body, { config = {} } = {}) {
    const text = String(body?.text ?? '').trim().slice(0, 500);
    if (!text) throw fail(400, 'INVALID_MESSAGES');
    const client = { name: 'Amine', credits: 3 };
    const messages = body.first === false ? [{ role: 'user', text: '…' }, { role: 'assistant', text: '…' }, { role: 'user', text }] : [{ role: 'user', text }];
    if (!body.automation) {
      const result = await answer({ messages, used: [] }, { config, client, count: false }).catch(error => {
        if (error.message === 'NO_PROVIDER') return { failed: true, tried: error.tried || [] };
        throw error;
      });
      return result.failed ? { ok: false, tried: result.tried } : { ok: true, result };
    }
    const draft = A.cleanAutomation({ ...body.automation, enabled: true });
    const language = detectLanguage(text), turns = turnsOf(messages), now = clock();
    const check = A.triggerMatch(draft, { norm: A.normalize(text), language, first: messages.length === 1, buttonId: draft.trigger.type === 'button' ? draft.id : '', now, used: new Set() });
    try {
      const result = await automationReply(draft, { turns, config, language, client, appName: await brand(), now, notes: config.knowledgeNotes || '' });
      return { ok: true, matches: check.ok, why: check.ok ? '' : check.why, unknownVars: A.unknownVars(draft.reply.text), result };
    } catch (error) {
      if (error.message === 'NO_PROVIDER') return { ok: false, matches: check.ok, why: check.ok ? '' : check.why, tried: error.tried || [] };
      throw error;
    }
  }

  const demo = createDemo(db, { clock });
  return { answer, test, overview, saveList, buttons, getList, demo };
}

module.exports = { createAssistant };
