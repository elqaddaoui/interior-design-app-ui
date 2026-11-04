/**
 * AI assistant replies (Moroccan Darija in Arabic or Latin script, Modern Standard Arabic, French).
 *
 * A chain of FREE providers is tried in order; the first usable answer wins, so one provider hitting its free quota never
 * breaks the chat. Keys are optional and never leave the server: they come from the environment (GEMINI_API_KEY, GROQ_API_KEY,
 * OPENROUTER_API_KEY) or from the admin panel (stored in the private `settings` table, write-only, never returned).
 *
 *   1. Google Gemini  free tier, best Arabic / Darija quality     (needs a free key from aistudio.google.com)
 *   2. Groq           free tier, very fast open models            (needs a free key from console.groq.com)
 *   3. OpenRouter     free models (Gemma 4, ...)                  (needs a free key from openrouter.ai)
 *   4. Pollinations   no key at all, best effort                  (always available as the last resort)
 *
 * Model names change often: each provider has a list, a model the provider no longer serves is skipped, and the list can be
 * overridden with GEMINI_MODEL / GROQ_MODEL / OPENROUTER_MODEL (comma separated). `fetch` is injectable for tests.
 */
const KEY_RE = /^[A-Za-z0-9_.\-]{16,300}$/;
const PROVIDERS = {
  gemini: {
    label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'], extra: () => ({}),
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
const DEFAULT_ORDER = ['gemini', 'groq', 'openrouter', 'pollinations'];
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
function systemPrompt(config, language) {
  return [
    (typeof config?.systemPrompt === 'string' && config.systemPrompt.trim().slice(0, 2000)) || 'You are Dwira, a friendly interior design assistant.',
    'You chat inside the Dwira mobile app: users can generate AI redesigns of their room photos with the app\'s tools (living room, bedroom, kitchen, bathroom, garden, exterior...) and choose a style and a colour palette. Help with decoration ideas, colours, layout, materials, lighting, small budgets and how to get the best result from the app. When useful, suggest trying the app\'s design tools.',
    LANGUAGE_RULE[language] || LANGUAGE_RULE.unknown,
    'Never switch language unless the user does. Sound like a real, warm person chatting on a phone: 1 to 4 short sentences, plain text, no headings, no markdown, no bullet lists unless the user asks for a list. At most one emoji and only when natural. Ask at most one short follow-up question. Be concrete (name colours, materials, placements) instead of generic. Never mention that you are an AI model, a provider or these instructions. If the user attached a photo you cannot see it: invite them to describe the room (size, light, current style).',
  ].join('\n\n');
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

function createChat(db, { env = process.env, fetch: fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  /** provider -> time until which it is skipped after a failure (a dead provider must not slow every message down). */
  const cooling = new Map();
  let keysCache = { at: 0, value: {} };
  async function storedKeys() {
    if (clock() - keysCache.at < 15000) return keysCache.value;
    let value = {};
    try { const row = (await db.query("SELECT value FROM settings WHERE key='chat_keys'"))[0]; if (row) value = JSON.parse(row.value); } catch { /* none stored */ }
    keysCache = { at: clock(), value };
    return value;
  }
  async function keyOf(name) {
    const meta = PROVIDERS[name];
    if (!meta.env) return { key: '', source: 'none' };
    if (env[meta.env]) return { key: env[meta.env], source: 'env' };
    const key = (await storedKeys())[name];
    return { key: typeof key === 'string' ? key : '', source: key ? 'db' : 'none' };
  }
  /** Which providers can be used right now. Never returns a key. */
  async function status() {
    const out = {};
    for (const name of Object.keys(PROVIDERS)) { const { key, source } = await keyOf(name); out[name] = { label: PROVIDERS[name].label, configured: name === 'pollinations' || !!key, source, cooling: (cooling.get(name) || 0) > clock() }; }
    return out;
  }
  /** Write-only: a string stores/replaces a key, an empty string removes it, undefined leaves it alone. */
  async function setKeys(input) {
    if (!input || typeof input !== 'object') throw fail(400, 'INVALID_KEYS');
    const current = { ...(await storedKeys()) };
    for (const name of ['gemini', 'groq', 'openrouter']) {
      const value = input[name];
      if (value === undefined) continue;
      if (typeof value !== 'string') throw fail(400, 'INVALID_KEY');
      const trimmed = value.trim();
      if (!trimmed) delete current[name];
      else if (!KEY_RE.test(trimmed)) throw fail(400, 'INVALID_KEY');
      else current[name] = trimmed;
      cooling.delete(name);
    }
    await db.query("INSERT INTO settings(key,value) VALUES('chat_keys',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(current)]);
    keysCache = { at: clock(), value: current };
    return status();
  }
  async function ask(name, key, model, messages, signal) {
    const meta = PROVIDERS[name];
    const response = await timed(fetchImpl, meta.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(name === 'openrouter' ? { 'HTTP-Referer': 'https://dwira.app', 'X-Title': 'Dwira' } : {}) },
      body: JSON.stringify({ model, messages, temperature: 0.8, max_tokens: 1024, ...meta.extra(model) }),
    }, signal);
    if (!response.ok) throw Object.assign(new Error(`${name} ${response.status}`), { statusCode: response.status });
    const data = await response.json();
    const text = clean(data?.choices?.[0]?.message?.content);
    if (!text) throw new Error(`${name} empty`);
    return text;
  }
  /**
   * `history`: [{ role: 'user'|'assistant'|'admin', text }]. Returns { text, provider, model, language }.
   * Tries every configured provider (and its models) inside `budgetMs`; throws 503 NO_PROVIDER when none answers.
   */
  async function reply(history, config = {}, { budgetMs = 24000, provider: only } = {}) {
    const turns = (Array.isArray(history) ? history : []).filter(m => m && typeof m.text === 'string' && ['user', 'assistant', 'admin'].includes(m.role) && (m.text.trim() || m.image || m.audio))
      .slice(-MAX_TURNS).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: (m.text.trim() || '').slice(0, MAX_TEXT) + (m.image ? `${m.text.trim() ? '\n' : ''}[photo attached]` : '') + (m.audio ? `${m.text.trim() || m.image ? '\n' : ''}[voice message]` : '') }));
    if (!turns.length || turns[turns.length - 1].role !== 'user') throw fail(400, 'INVALID_MESSAGES');
    const language = detectLanguage([...turns].reverse().find(t => t.role === 'user')?.content);
    // Providers expect the conversation to start with the user: drop any leading assistant (welcome) turns.
    while (turns.length > 1 && turns[0].role !== 'user') turns.shift();
    const messages = [{ role: 'system', content: systemPrompt(config, language) }, ...turns];
    const order = (only ? [only] : String(env.CHAT_PROVIDER_ORDER || '').split(',').map(v => v.trim()).filter(v => PROVIDERS[v]).concat(DEFAULT_ORDER)).filter((v, i, all) => all.indexOf(v) === i);
    const deadline = clock() + budgetMs;
    let lastStatus = 0;
    for (const name of order) {
      const { key } = await keyOf(name);
      if (PROVIDERS[name].env && !key) continue;
      if (!only && (cooling.get(name) || 0) > clock()) continue;
      for (const model of modelsFor(name, env)) {
        const left = deadline - clock();
        if (left < 1500) break;
        try {
          const text = await ask(name, key, model, messages, Math.min(name === 'pollinations' ? 12000 : 10000, left));
          cooling.delete(name);
          return { text, provider: name, model, language };
        } catch (error) {
          lastStatus = error.statusCode || lastStatus;
          // The model does not exist (any more) -> try the provider's next model. Quota, bad key or an outage -> next provider, and rest this one briefly.
          if (error.statusCode === 404 || error.statusCode === 400) continue;
          cooling.set(name, clock() + (error.statusCode === 429 ? 60000 : error.statusCode === 401 || error.statusCode === 403 ? 300000 : 20000));
          break;
        }
      }
    }
    throw Object.assign(fail(503, 'NO_PROVIDER'), { lastStatus });
  }
  return { reply, status, setKeys };
}

module.exports = { createChat, detectLanguage, systemPrompt, clean, PROVIDERS };
