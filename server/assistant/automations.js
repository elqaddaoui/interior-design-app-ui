/**
 * The owner's automations: fixed / template / AI-written replies that are answered BEFORE the AI.
 * Pure functions (no database, no network): matching, schedule windows, template variables, validation.
 *
 *   trigger  keyword (words the user writes) | intent (built-in meanings) | first_visit | schedule | button
 *   reply    fixed text | template with {variables} | ai (the owner's instructions, answered by the provider chain)
 *   language darija | arabic | french | auto
 *              fixed / template: runs only when the user writes in that language (auto = any)
 *              ai: the language of the reply (auto = the user's language)
 */
const crypto = require('node:crypto');

const fail = (status, code) => Object.assign(new Error(code), { status });
const LANGUAGES = ['auto', 'darija', 'arabic', 'french'];
const TRIGGERS = ['keyword', 'intent', 'first_visit', 'schedule', 'button'];
const REPLIES = ['fixed', 'template', 'ai'];
const VARS = ['name', 'app', 'credits', 'date', 'time', 'greeting'];
const MAX_AUTOMATIONS = 100;
const DEFAULT_TZ = 'Africa/Casablanca';

/* ------------------------------------------------------------------ text */
const ARABIC_MARKS = /[\u064B-\u065F\u0670\u0640]/g;
/** Same normal form for what the user writes and for what the owner typed: case, accents, Arabic letter variants, punctuation. */
function normalize(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase()
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** Latin terms match whole words (so "ach" never fires inside "achat"); Arabic terms match inside a word (prefixes like و / ال / ب are glued to words). */
function hasTerm(norm, term) {
  if (!term) return false;
  return /^[a-z0-9 ]+$/.test(term) ? ` ${norm} `.includes(` ${term} `) : norm.includes(term);
}
const anyTerm = (norm, terms) => terms.some(term => hasTerm(norm, normalize(term)));

/* ------------------------------------------------------------------ built-in intents */
const INTENTS = {
  greeting: { max: 5, terms: ['salam', 'slm', 'salut', 'bonjour', 'bonsoir', 'hello', 'hi', 'hey', 'labas', 'cc', 'coucou', 'سلام', 'السلام عليكم', 'مرحبا', 'اهلا', 'أهلا', 'صباح الخير', 'مساء الخير', 'لاباس', 'لباس'] },
  thanks: { terms: ['merci', 'chokran', 'choukran', 'shukran', 'mrc', 'thanks', 'thank you', 'thx', 'شكرا', 'بارك الله فيك', 'الله يعطيك الصحة', 'يعطيك الصحة'] },
  goodbye: { max: 6, terms: ['au revoir', 'bye', 'a bientot', 'bslama', 'beslama', 'ma3a salama', 'بسلامة', 'مع السلامة', 'الى اللقاء'] },
  pricing: { terms: ['prix', 'tarif', 'combien', 'price', 'cost', 'how much', 'abonnement', 'subscription', 'credit', 'credits', 'crédit', 'pro', 'payer', 'paiement', 'chhal', 'ch7al', 'chhal taman', 'taman', 'thaman', 'kredi', 'شحال', 'ثمن', 'الثمن', 'سعر', 'الاسعار', 'كم', 'اشتراك', 'كريدي', 'رصيد', 'ندفع', 'نخلص'] },
  human: { terms: ['humain', 'agent', 'conseiller', 'equipe', 'team', 'support', 'service client', 'contact', 'parler a quelqu', 'human', 'real person', 'ndwi m3a', 'nhdar m3a', 'wahed', 'بشر', 'موظف', 'الفريق', 'تواصل', 'نهدر مع', 'نتكلم مع', 'شي واحد', 'خدمة الزبناء'] },
  howto: { terms: ['comment', 'how to', 'how do', 'how can', 'kifach', 'kifash', 'kif', 'etapes', 'commencer', 'start', 'bghit nsayb', 'bghit ndir', 'nbda', 'كيفاش', 'كيف', 'خطوات', 'نبدا', 'بغيت نصاوب', 'بغيت ندير', 'كيفية'] },
  problem: { terms: ['erreur', 'probleme', 'bug', 'marche pas', 'fonctionne pas', 'echec', 'error', 'not working', 'failed', 'problem', 'mochkil', 'machakil', 'ma khdamch', 'makaykhdamch', 'ma kaytftahch', 'مشكل', 'مشكلة', 'خطا', 'ما خدامش', 'ماكيخدمش', 'ما كيتفتحش', 'فشل'] },
};
for (const intent of Object.values(INTENTS)) intent.norm = intent.terms.map(normalize);
const INTENT_IDS = Object.keys(INTENTS);
function intentMatch(id, norm) {
  const intent = INTENTS[id];
  if (!intent) return false;
  if (intent.max && norm.split(' ').length > intent.max) return false;
  return intent.norm.some(term => hasTerm(norm, term));
}

/* ------------------------------------------------------------------ schedule */
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
/** { day: 0-6 (Sunday = 0), minutes: minutes since midnight } in the given time zone. */
function zoned(now, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: validTz(tz) ? tz : DEFAULT_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return { day: WEEKDAY[parts.weekday] ?? 0, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}
const toMinutes = value => { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** Days empty = every day. from > to is an overnight window (the days belong to the day it starts). from == to = the whole day. */
function inWindow(schedule, now) {
  const from = toMinutes(schedule?.from) ?? 0, to = toMinutes(schedule?.to) ?? 0;
  const days = Array.isArray(schedule?.days) && schedule.days.length ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
  const { day, minutes } = zoned(now, schedule?.tz || DEFAULT_TZ);
  if (from === to) return days.includes(day);
  if (from < to) return days.includes(day) && minutes >= from && minutes < to;
  return (minutes >= from && days.includes(day)) || (minutes < to && days.includes((day + 6) % 7));
}

/* ------------------------------------------------------------------ language */
const LANG_OF = { darija: 'darija', darija_latin: 'darija', arabic: 'arabic', french: 'french' };
/** The user's language (from detectLanguage) against an automation's language. Unknown text ("ok", "?") never blocks. */
const languageOk = (wanted, detected) => wanted === 'auto' || !LANG_OF[detected] || LANG_OF[detected] === wanted;

/* ------------------------------------------------------------------ templates */
const GREETING = {
  darija: ['صباح الخير', 'مرحبا', 'مساء الخير'], darija_latin: ['Sbah lkhir', 'Salam', 'Msa lkhir'],
  arabic: ['صباح الخير', 'مرحبًا', 'مساء الخير'], french: ['Bonjour', 'Bonjour', 'Bonsoir'],
};
const LOCALE = { darija: 'ar-MA-u-nu-latn', darija_latin: 'fr-FR', arabic: 'ar-MA-u-nu-latn', french: 'fr-FR' };
/** Values for {name} {app} {credits} {date} {time} {greeting}. `language` is darija | darija_latin | arabic | french. */
function variables({ client, appName, language, now, tz }) {
  const lang = GREETING[language] ? language : 'darija';
  const zone = validTz(tz) ? tz : DEFAULT_TZ;
  const { minutes } = zoned(now, zone);
  const greeting = GREETING[lang][minutes < 720 ? 0 : minutes < 1080 ? 1 : 2];
  const fmt = options => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: zone, ...options }).format(new Date(now));
  return {
    name: client?.name ? String(client.name).trim().split(/\s+/)[0] : '', app: appName || 'Dwira', credits: client ? String(client.credits ?? '') : '',
    date: fmt({ day: 'numeric', month: 'long', year: 'numeric' }), time: fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), greeting,
  };
}
/** {name} or {name|friend}: the part after | is used when the value is empty (a visitor has no name). Unknown {words} stay as typed. */
function render(text, vars) {
  // The space before an empty variable goes with it ("Salut {name} !" -> "Salut !", "Hi {name}, ok" -> "Hi, ok"); French spacing before ! ? : is kept.
  return String(text ?? '').replace(/( ?)\{([A-Za-z_]+)(?:\|([^{}]*))?\}/g, (whole, lead, name, fallback) => {
    const key = name.toLowerCase();
    if (!(key in vars)) return whole;
    const value = vars[key] !== '' && vars[key] != null ? String(vars[key]) : fallback ?? '';
    return value ? lead + value : '';
  }).replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '').trim();
}
const unknownVars = text => [...new Set([...String(text || '').matchAll(/\{([A-Za-z_]+)(?:\|[^{}]*)?\}/g)].map(m => m[1].toLowerCase()).filter(n => !VARS.includes(n)))];

/* ------------------------------------------------------------------ matching */
/**
 * ctx: { norm (normalized last message), language, first, buttonId, now, used (Set of automation ids already answered in this chat) }.
 * Returns { ok, why }: `why` explains a refusal (language | once | no_match | not_first | closed | other_button).
 */
function triggerMatch(automation, ctx) {
  const { trigger, reply } = automation;
  if (ctx.buttonId && trigger.type !== 'button') return { ok: false, why: 'other_button' };
  if (reply.type !== 'ai' && !languageOk(automation.language, ctx.language)) return { ok: false, why: 'language' };
  if (automation.oncePerChat && ctx.used?.has(automation.id)) return { ok: false, why: 'once' };
  switch (trigger.type) {
    case 'keyword': return anyTerm(ctx.norm, trigger.keywords) ? { ok: true } : { ok: false, why: 'no_match' };
    case 'intent': return trigger.intents.some(id => intentMatch(id, ctx.norm)) ? { ok: true } : { ok: false, why: 'no_match' };
    case 'first_visit': return ctx.first ? { ok: true } : { ok: false, why: 'not_first' };
    case 'schedule': return inWindow(trigger.schedule, ctx.now) ? { ok: true } : { ok: false, why: 'closed' };
    case 'button': return ctx.buttonId === automation.id ? { ok: true } : { ok: false, why: 'other_button' };
    default: return { ok: false, why: 'no_match' };
  }
}
/** The first enabled automation (list order = priority) that matches. */
function pick(list, ctx) {
  for (const automation of list) { if (automation.enabled && triggerMatch(automation, ctx).ok) return automation; }
  return null;
}

/* ------------------------------------------------------------------ validation */
const tidy = (value, max, lines = true) => {
  const t = String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  return lines ? t : t.replace(/\n+/g, ' ');
};
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const newId = () => `auto_${crypto.randomBytes(6).toString('hex')}`;

/** One automation, sanitised. Throws 400 INVALID_AUTOMATION when it cannot be used. `keepId` false assigns a new id when it is missing. */
function cleanAutomation(input, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'INVALID_AUTOMATION');
  const name = tidy(input.name, 80, false);
  if (!name) throw fail(400, 'INVALID_AUTOMATION');
  const t = input.trigger && typeof input.trigger === 'object' ? input.trigger : {};
  const r = input.reply && typeof input.reply === 'object' ? input.reply : {};
  if (!TRIGGERS.includes(t.type) || !REPLIES.includes(r.type)) throw fail(400, 'INVALID_AUTOMATION');
  const keywords = [...new Set((Array.isArray(t.keywords) ? t.keywords : []).map(k => tidy(k, 60, false)).filter(Boolean))].slice(0, 40);
  const intents = [...new Set((Array.isArray(t.intents) ? t.intents : []).filter(id => INTENT_IDS.includes(id)))];
  const s = t.schedule && typeof t.schedule === 'object' ? t.schedule : {};
  const schedule = {
    days: [...new Set((Array.isArray(s.days) ? s.days : []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
    from: toMinutes(s.from) === null ? '18:00' : String(s.from).padStart(5, '0'), to: toMinutes(s.to) === null ? '09:00' : String(s.to).padStart(5, '0'),
    tz: typeof s.tz === 'string' && validTz(s.tz) ? s.tz : DEFAULT_TZ,
  };
  if (t.type === 'keyword' && !keywords.length) throw fail(400, 'INVALID_AUTOMATION');
  if (t.type === 'intent' && !intents.length) throw fail(400, 'INVALID_AUTOMATION');
  const text = tidy(r.text, 2000), instructions = tidy(r.instructions, 2000);
  if (r.type !== 'ai' && !text) throw fail(400, 'INVALID_AUTOMATION');
  if (r.type === 'ai' && !instructions) throw fail(400, 'INVALID_AUTOMATION');
  const buttonLabel = tidy(t.buttonLabel, 40, false);
  if (t.type === 'button' && !buttonLabel) throw fail(400, 'INVALID_AUTOMATION');
  return {
    id: typeof input.id === 'string' && ID_RE.test(input.id) ? input.id : newId(),
    name, enabled: input.enabled !== false,
    trigger: { type: t.type, keywords, intents, schedule, buttonLabel },
    reply: { type: r.type, text, instructions },
    language: LANGUAGES.includes(input.language) ? input.language : 'auto',
    oncePerChat: typeof input.oncePerChat === 'boolean' ? input.oncePerChat : t.type === 'first_visit' || t.type === 'schedule',
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now, updatedAt: now,
  };
}
function cleanList(input) {
  if (!Array.isArray(input) || input.length > MAX_AUTOMATIONS) throw fail(400, 'INVALID_AUTOMATIONS');
  const seen = new Set();
  return input.map(item => {
    const clean = cleanAutomation(item);
    if (seen.has(clean.id)) throw fail(400, 'INVALID_AUTOMATIONS');
    seen.add(clean.id);
    return clean;
  });
}

module.exports = { normalize, hasTerm, intentMatch, INTENT_IDS, LANGUAGES, TRIGGERS, REPLIES, VARS, DEFAULT_TZ, inWindow, zoned, languageOk, variables, render, unknownVars, triggerMatch, pick, cleanAutomation, cleanList, MAX_AUTOMATIONS };
