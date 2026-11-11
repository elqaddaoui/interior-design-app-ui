/**
 * AI assistant replies (Moroccan Darija in Arabic or Latin script, Modern Standard Arabic, French).
 *
 * Two zones, one fallback chain:
 *   FREE  (default, ranked): the first usable answer wins, so one provider hitting its free quota never breaks the chat.
 *     1. Google Gemini  best Arabic / Darija quality               (free key: aistudio.google.com)
 *     2. Mistral        very good French and Arabic                (free "Experiment" key: console.mistral.ai)
 *     3. Groq           very fast open models                      (free key: console.groq.com)
 *     4. OpenRouter     free models (Gemma 4, ...)                 (free key: openrouter.ai)
 *     5. Pollinations   no key at all, best effort                 (always available as the last resort)
 *   PAID  (optional, owner's own accounts): any OpenAI-compatible API with its own key and model. A paid provider is OFF
 *     until a key is added and switched on; the owner decides whether the paid zone runs before or after the free one.
 *
 * Any error, rate limit (429), bad key, empty answer or timeout moves on to the next provider. Every answer carries the
 * trace: which provider/model answered, its status (active | fallback | paid) and which ones failed first and why.
 * Keys are write-only: they come from the environment or from the admin panel (private `settings` table), never returned.
 * Model names change often: each provider has a list, a model the provider no longer serves is skipped, and the list can be
 * overridden with GEMINI_MODEL / MISTRAL_MODEL / GROQ_MODEL / OPENROUTER_MODEL (comma separated). `fetch` is injectable for tests.
 */
const crypto = require('node:crypto');

const KEY_RE = /^[A-Za-z0-9_.\-]{16,300}$/;
const PROVIDERS = {
  gemini: {
    label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'], extra: () => ({}),
  },
  mistral: {
    label: 'Mistral', url: 'https://api.mistral.ai/v1/chat/completions', env: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL',
    models: ['mistral-small-latest', 'open-mistral-nemo'], extra: () => ({}),
  },
  groq: {
    label: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', env: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'], extra: model => (model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
  },
  openrouter: {
    label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', env: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL',
    models: ['google/gemma-4-31b-it:free', 'openrouter/free'], extra: () => ({}),
  },
  pollinations: {
    label: 'Pollinations', url: 'https://text.pollinations.ai/openai', env: null, modelEnv: 'POLLINATIONS_MODEL',
    models: ['openai-fast'], extra: () => ({}),
  },
};
const DEFAULT_ORDER = ['gemini', 'mistral', 'groq', 'openrouter', 'pollinations'];
const KEYED = DEFAULT_ORDER.filter(id => PROVIDERS[id].env);
/** Paid zone presets (all speak the OpenAI chat format). `custom` takes any https base URL. The model is always the owner's choice. */
const PAID_PRESETS = {
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  anthropic: { label: 'Claude (Anthropic)', url: 'https://api.anthropic.com/v1/chat/completions', model: 'claude-haiku-4-5' },
  deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
  mistral: { label: 'Mistral (paid)', url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-medium-latest' },
  openrouter: { label: 'OpenRouter (paid)', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini' },
  custom: { label: 'Custom', url: '', model: '' },
};
const MAX_PAID = 6;
const MAX_TURNS = 14;
const MAX_TEXT = 2000;
const fail = (status, code) => Object.assign(new Error(code), { status });

/* ------------------------------------------------------------------ language */
const DARIJA_AR = /(كيفاش|بغيت|بغينا|ديال|ديالي|ديالك|فين|شنو|واش|مزيان|بزاف|عفاك|لاش|دابا|ماشي|كاين|علاش|غادي|فهاد|هاد|زوين|نقدر|خاصني|خاصك|حيطان|ساليت|وقتاش|بحال|ولا|غير|دير|ديرو|كنحب|كنبغي|بغيتي|عندي|عندك|راه|هاكا|كيدير)/;
const DARIJA_LATIN = /\b(dyali|dyalk|dyalo|nbdel|nbghi|nsayb|khdem|bghit|bghina|bghiti|kifach|kifash|chno|ach|wach|dyal|dial|mzyan|mzn|bzaf|bzzaf|3afak|afak|daba|dabaa|machi|makayn|kayn|khasni|khassni|wakha|zwin|3andi|3ndi|fin|lach|3lach|safi|ghadi|hadchi|had|rah|hna|nta|nti|ana)\b/gi;
const FRENCH = /\b(bonjour|salut|bonsoir|comment|couleur|salon|chambre|je|j'ai|pour|quel|quelle|déco|cuisine|salle|peindre|voudrais|aimerais|merci|svp|avec|dans|une|des|les|est|pas|vous|mon|ma)\b/gi;
/** Cheap script/lexicon check, only used to tell the model which language to answer in. */
function detectLanguage(text) {
  const t = String(text || '');
  const arabic = (t.match(/[\u0600-\u06FF]/g) || []).length, latin = (t.match(/[A-Za-z\u00C0-\u00FF]/g) || []).length;
  if (arabic > latin) return DARIJA_AR.test(t) ? 'darija' : 'arabic';
  if (latin >= 2) { const darija = (t.match(DARIJA_LATIN) || []).length, french = (t.match(FRENCH) || []).length; if (darija && darija >= french) return 'darija_latin'; if (french) return 'french'; }
  return 'unknown';
}
const LANGUAGE_RULE = {
  darija: 'The user writes Moroccan Darija in Arabic script. Reply in natural spoken Moroccan Darija written in Arabic script (e.g. "كاين بزاف ديال الأفكار", "غادي نعاونك", "دابا"), the way a friendly Moroccan person texts. NOT formal Modern Standard Arabic.',
  arabic: 'The user writes Modern Standard Arabic. Reply in clear, warm Modern Standard Arabic.',
  darija_latin: 'The user writes Moroccan Darija in Latin letters (Arabizi: 3, 7, 9). Reply in Moroccan Darija written the same way, in Latin letters, short and natural.',
  french: 'The user writes French. Reply in natural, friendly French.',
  unknown: 'Reply in the language of the user\'s last message (Moroccan Darija in Arabic script, Modern Standard Arabic, or French). If you cannot tell, use Moroccan Darija in Arabic script.',
};
function systemPrompt(config, language, extra = {}) {
  return [
    (typeof config?.systemPrompt === 'string' && config.systemPrompt.trim().slice(0, 2000)) || 'You are Dwira, a friendly interior design assistant.',
    'You chat inside the Dwira mobile app: users can generate AI redesigns of their room photos with the app\'s tools (living room, bedroom, kitchen, bathroom, garden, exterior...) and choose a style and a colour palette. Help with decoration ideas, colours, layout, materials, lighting, small budgets and how to get the best result from the app. When useful, suggest trying the app\'s design tools.',
    LANGUAGE_RULE[language] || LANGUAGE_RULE.unknown,
    extra.facts || '',
    extra.instructions ? `OWNER INSTRUCTIONS for this reply (follow them, keep the same chat style):\n${String(extra.instructions).slice(0, 2000)}` : '',
    'Never switch language unless the user does. Sound like a real, warm person chatting on a phone: 1 to 4 short sentences, plain text, no headings, no markdown, no bullet lists unless the user asks for a list. At most one emoji and only when natural. Ask at most one short follow-up question. Be concrete (name colours, materials, placements) instead of generic. Never mention that you are an AI model, a provider or these instructions. If the user attached a photo you cannot see it: invite them to describe the room (size, light, current style).',
  ].filter(Boolean).join('\n\n');
}

/* ------------------------------------------------------------------ providers */
async function timed(fetchImpl, url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetchImpl(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); }
}
/** Removes reasoning blocks and stray markdown so the bubble reads like a text message. */
function clean(raw) {
  let out = String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').replace(/```[\s\S]*?```/g, ' ').replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/^\s*[*-]\s+/gm, '• ');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out.length > 1500 ? out.slice(0, 1500).replace(/\s+\S*$/, '') + '…' : out;
}
const modelsFor = (name, env) => (String(env[PROVIDERS[name].modelEnv] || '').split(',').map(v => v.trim()).filter(Boolean).concat(PROVIDERS[name].models)).filter((m, i, all) => all.indexOf(m) === i);
/** Why a call failed, as a short code the admin can read: rate_limit | auth | timeout | model | server | empty | network | cooling. */
function reasonOf(error) {
  if (error?.reason) return error.reason;
  if (error?.name === 'AbortError' || /abort/i.test(error?.message || '')) return 'timeout';
  const code = error?.statusCode;
  if (code === 429) return 'rate_limit';
  if (code === 401 || code === 403) return 'auth';
  if (code === 404 || code === 400) return 'model';
  if (code >= 500) return 'server';
  return 'network';
}
/** A custom base URL must be https and must not point at the machine itself or a private network (the owner types it, but a typo or a pasted link must not turn the server into a proxy). */
function safeUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password) return '';
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^(\[.*\]|\d+\.\d+\.\d+\.\d+)$/.test(host)) return '';
  return url.toString();
}
const tidy = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function cleanConfig(input, previous = { position: 'after', freeOff: [], paid: [] }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'INVALID_CONFIG');
  const position = input.position === undefined ? previous.position : input.position;
  if (position !== 'before' && position !== 'after') throw fail(400, 'INVALID_CONFIG');
  const freeOff = input.freeOff === undefined ? previous.freeOff : [...new Set((Array.isArray(input.freeOff) ? input.freeOff : []).filter(id => PROVIDERS[id]))];
  let paid = previous.paid;
  if (input.paid !== undefined) {
    if (!Array.isArray(input.paid) || input.paid.length > MAX_PAID) throw fail(400, 'INVALID_CONFIG');
    const seen = new Set();
    paid = input.paid.map(item => {
      if (!item || typeof item !== 'object') throw fail(400, 'INVALID_CONFIG');
      const preset = PAID_PRESETS[item.preset] ? item.preset : 'custom';
      const id = typeof item.id === 'string' && /^paid_[a-f0-9]{8}$/.test(item.id) && !seen.has(item.id) ? item.id : `paid_${crypto.randomBytes(4).toString('hex')}`;
      seen.add(id);
      const model = tidy(item.model, 120) || PAID_PRESETS[preset].model;
      const baseUrl = preset === 'custom' ? safeUrl(item.baseUrl) : '';
      if (preset === 'custom' && !baseUrl) throw fail(400, 'INVALID_PAID_URL');
      if (!model) throw fail(400, 'INVALID_PAID_MODEL');
      return { id, label: tidy(item.label, 40) || PAID_PRESETS[preset].label, preset, baseUrl, model, enabled: item.enabled === true };
    });
  }
  return { position, freeOff, paid };
}

function createChat(db, { env = process.env, fetch: fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  /** provider -> { until, reason }: skipped for a while after a failure (a dead provider must not slow every message down). */
  const cooling = new Map();
  /** provider -> { ok, at, reason, model }: what happened on its last real call (this server instance only). */
  const health = new Map();
  const cache = { keys: { at: 0, value: {} }, paidKeys: { at: 0, value: {} }, config: { at: 0, value: null } };
  async function stored(slot, key, fallback) {
    if (clock() - cache[slot].at < 15000 && cache[slot].value) return cache[slot].value;
    let value = fallback;
    try { const row = (await db.query('SELECT value FROM settings WHERE tenant_id=:tenant AND key=$1', [key]))[0]; if (row) value = JSON.parse(row.value); } catch { /* none stored */ }
    cache[slot] = { at: clock(), value };
    return value;
  }
  const save = async (slot, key, value) => {
    await db.query('INSERT INTO settings(tenant_id,key,value) VALUES(:tenant,$1,$2) ON CONFLICT (tenant_id,key) DO UPDATE SET value=EXCLUDED.value', [key, JSON.stringify(value)]);
    cache[slot] = { at: clock(), value };
  };
  const storedKeys = () => stored('keys', 'chat_keys', {});
  const paidKeys = () => stored('paidKeys', 'chat_paid_keys', {});
  const getConfig = async () => ({ position: 'after', freeOff: [], paid: [], ...(await stored('config', 'chat_config', { position: 'after', freeOff: [], paid: [] })) });

  async function keyOf(name) {
    const meta = PROVIDERS[name];
    if (!meta.env) return { key: '', source: 'none' };
    if (env[meta.env]) return { key: env[meta.env], source: 'env' };
    const key = (await storedKeys())[name];
    return { key: typeof key === 'string' ? key : '', source: key ? 'db' : 'none' };
  }
  const restingOf = id => { const entry = cooling.get(id); return entry && entry.until > clock() ? entry : null; };
  const stateOf = (id, usable) => {
    if (!usable) return 'off';
    if (restingOf(id)) return 'cooling';
    const h = health.get(id);
    return !h ? 'ready' : h.ok ? 'active' : 'failed';
  };
  const healthOf = id => { const h = health.get(id); return h ? { ok: h.ok, at: h.at, reason: h.reason || '', model: h.model || '' } : null; };

  /** What the admin page shows. Never returns a key. */
  async function status() {
    const config = await getConfig(), keys = await paidKeys();
    const free = [];
    for (const [rank, id] of DEFAULT_ORDER.entries()) {
      const { key, source } = await keyOf(id);
      const configured = id === 'pollinations' || !!key, on = !config.freeOff.includes(id);
      free.push({ id, label: PROVIDERS[id].label, rank: rank + 1, configured, source, enabled: on, needsKey: !!PROVIDERS[id].env, models: modelsFor(id, env), state: stateOf(id, configured && on), last: healthOf(id), resting: restingOf(id)?.reason || '' });
    }
    const paid = config.paid.map(p => {
      const hasKey = !!keys[p.id], usable = hasKey && p.enabled;
      return { ...p, hasKey, state: stateOf(p.id, usable), last: healthOf(p.id), resting: restingOf(p.id)?.reason || '', url: p.preset === 'custom' ? p.baseUrl : PAID_PRESETS[p.preset].url };
    });
    return { free, paid: { position: config.position, providers: paid }, presets: Object.fromEntries(Object.entries(PAID_PRESETS).map(([id, v]) => [id, { label: v.label, model: v.model }])), maxPaid: MAX_PAID };
  }
  /** Write-only free keys: a string stores/replaces a key, an empty string removes it, undefined leaves it alone. */
  async function setKeys(input) {
    if (!input || typeof input !== 'object') throw fail(400, 'INVALID_KEYS');
    const current = { ...(await storedKeys()) };
    for (const name of KEYED) {
      const value = input[name];
      if (value === undefined) continue;
      if (typeof value !== 'string') throw fail(400, 'INVALID_KEY');
      const trimmed = value.trim();
      if (!trimmed) delete current[name];
      else if (!KEY_RE.test(trimmed)) throw fail(400, 'INVALID_KEY');
      else current[name] = trimmed;
      cooling.delete(name);
    }
    await save('keys', 'chat_keys', current);
    return status();
  }
  /**
   * Free switches, the paid zone position and the paid providers. `paid[].key` is write-only like the free keys:
   * a string stores/replaces, '' removes, undefined keeps. A provider without a key can never run, whatever its toggle says.
   */
  async function setConfig(input) {
    const previous = await getConfig();
    const next = cleanConfig(input, previous);
    const keys = { ...(await paidKeys()) };
    if (input.paid !== undefined) {
      // cleanConfig keeps the order of input.paid, so the same index gives the key sent for that provider.
      input.paid.forEach((item, index) => {
        const id = next.paid[index].id, value = item.key;
        if (value === undefined) return;
        if (typeof value !== 'string') throw fail(400, 'INVALID_KEY');
        const trimmed = value.trim();
        if (!trimmed) delete keys[id];
        else if (!KEY_RE.test(trimmed)) throw fail(400, 'INVALID_KEY');
        else keys[id] = trimmed;
        cooling.delete(id);
      });
      for (const id of Object.keys(keys)) if (!next.paid.some(p => p.id === id)) { delete keys[id]; health.delete(id); cooling.delete(id); }
    }
    await save('paidKeys', 'chat_paid_keys', keys);
    await save('config', 'chat_config', next);
    return status();
  }

  async function ask(entry, model, messages, ms) {
    const response = await timed(fetchImpl, entry.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(entry.key ? { Authorization: `Bearer ${entry.key}` } : {}), ...(entry.id === 'openrouter' ? { 'HTTP-Referer': 'https://dwira.app', 'X-Title': 'Dwira' } : {}) },
      body: JSON.stringify({ model, messages, temperature: 0.8, max_tokens: 1024, ...entry.extra(model) }),
    }, ms);
    if (!response.ok) throw Object.assign(new Error(`${entry.id} ${response.status}`), { statusCode: response.status });
    const data = await response.json();
    const text = clean(data?.choices?.[0]?.message?.content);
    if (!text) throw Object.assign(new Error(`${entry.id} empty`), { reason: 'empty' });
    return text;
  }
  /** The providers that may run, in order, with the paid zone before or after the free one. */
  async function chainOf(only) {
    const config = await getConfig(), keys = await paidKeys();
    const freeIds = String(env.CHAT_PROVIDER_ORDER || '').split(',').map(v => v.trim()).filter(v => PROVIDERS[v]).concat(DEFAULT_ORDER).filter((v, i, all) => all.indexOf(v) === i);
    const free = [];
    for (const id of freeIds) {
      if (!only && config.freeOff.includes(id)) continue;
      const { key } = await keyOf(id);
      if (PROVIDERS[id].env && !key) continue;
      free.push({ id, label: PROVIDERS[id].label, paid: false, url: PROVIDERS[id].url, key, models: modelsFor(id, env), extra: PROVIDERS[id].extra, ms: id === 'pollinations' ? 12000 : 10000 });
    }
    const paid = config.paid.filter(p => keys[p.id] && (only || p.enabled)).map(p => ({
      id: p.id, label: p.label, paid: true, url: p.preset === 'custom' ? p.baseUrl : PAID_PRESETS[p.preset].url, key: keys[p.id], models: [p.model], extra: () => ({}), ms: 15000,
    }));
    const all = config.position === 'before' ? [...paid, ...free] : [...free, ...paid];
    return only ? all.filter(entry => entry.id === only) : all;
  }
  /**
   * `history`: [{ role: 'user'|'assistant'|'admin', text }].
   * options: { budgetMs, provider (try only this one: the admin "test" button), language (force the reply language: darija | arabic | french),
   *            facts (knowledge block for the system prompt), instructions (the owner's instructions of an AI automation) }.
   * Returns { text, provider, model, label, language, status: 'active' | 'fallback' | 'paid', paid, tried: [{ provider, label, model, paid, status: 'failed', reason }] }.
   * Throws 503 NO_PROVIDER (with `.tried`) when none answers.
   */
  async function reply(history, config = {}, { budgetMs = 24000, provider: only, language: forced, facts, instructions } = {}) {
    const turns = (Array.isArray(history) ? history : []).filter(m => m && typeof m.text === 'string' && ['user', 'assistant', 'admin'].includes(m.role) && (m.text.trim() || m.image || m.audio))
      .slice(-MAX_TURNS).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: (m.text.trim() || '').slice(0, MAX_TEXT) + (m.image ? `${m.text.trim() ? '\n' : ''}[photo attached]` : '') + (m.audio ? `${m.text.trim() || m.image ? '\n' : ''}[voice message]` : '') }));
    if (!turns.length || turns[turns.length - 1].role !== 'user') throw fail(400, 'INVALID_MESSAGES');
    const detected = detectLanguage([...turns].reverse().find(t => t.role === 'user')?.content);
    // A forced language (AI automation) keeps the user's script: Darija written in Latin letters stays Latin.
    const language = forced === 'darija' ? (detected === 'darija_latin' ? 'darija_latin' : 'darija') : forced === 'arabic' || forced === 'french' ? forced : detected;
    // Providers expect the conversation to start with the user: drop any leading assistant (welcome) turns.
    while (turns.length > 1 && turns[0].role !== 'user') turns.shift();
    const messages = [{ role: 'system', content: systemPrompt(config, language, { facts, instructions }) }, ...turns];
    const chain = await chainOf(only);
    const deadline = clock() + budgetMs;
    const tried = [];
    for (const entry of chain) {
      const rest = !only && restingOf(entry.id);
      if (rest) { tried.push({ provider: entry.id, label: entry.label, model: '', paid: entry.paid, status: 'failed', reason: rest.reason }); continue; }
      let reason = 'network', lastModel = entry.models[0] || '';
      for (const model of entry.models) {
        const left = deadline - clock();
        if (left < 1500) { reason = 'timeout'; break; }
        lastModel = model;
        try {
          const text = await ask(entry, model, messages, Math.min(entry.ms, left));
          cooling.delete(entry.id);
          health.set(entry.id, { ok: true, at: clock(), model });
          return { text, provider: entry.id, model, label: entry.label, language, paid: entry.paid, status: entry.paid ? 'paid' : tried.length ? 'fallback' : 'active', tried };
        } catch (error) {
          reason = reasonOf(error);
          // The model does not exist (any more) -> try the provider's next model. Quota, bad key or an outage -> next provider, and rest this one briefly.
          if (reason === 'model') continue;
          cooling.set(entry.id, { until: clock() + (reason === 'rate_limit' ? 60000 : reason === 'auth' ? 300000 : 20000), reason });
          break;
        }
      }
      health.set(entry.id, { ok: false, at: clock(), reason, model: lastModel });
      tried.push({ provider: entry.id, label: entry.label, model: lastModel, paid: entry.paid, status: 'failed', reason });
    }
    throw Object.assign(fail(503, 'NO_PROVIDER'), { tried });
  }
  return { reply, status, setKeys, setConfig, getConfig };
}

module.exports = { createChat, detectLanguage, systemPrompt, clean, PROVIDERS, PAID_PRESETS, DEFAULT_ORDER };
