/**
 * Access model of the platform (pure functions, no I/O: unit tested without a database).
 *
 * A FEATURE is one admin page of the tenant panel (dashboard, requests, users, tools, branding ...).
 * Every feature has a LEVEL: 'none' (hidden, API refuses), 'view' (read only) or 'edit' (read + write).
 *
 *   effective level = min( what the tenant's PLAN (+ the super admin's per-tenant overrides) allows,
 *                          what the account's ROLE (+ the account's own overrides) allows )
 *
 * The same table drives the UI (menu, route guard, read-only banner) and the API (`requirement()` maps every admin
 * endpoint to the features that can authorise it), so hiding a page in the browser is never the only protection.
 */
const LEVELS = ['none', 'view', 'edit'];
const rank = level => Math.max(0, LEVELS.indexOf(level));
const minLevel = (a, b) => (rank(a) <= rank(b) ? a : b);
const isLevel = value => LEVELS.includes(value);

/**
 * `shared: true` = the page edits the platform catalog / look / AI engine, which every tenant reads (content, branding, models are one
 * shared document set). Plans keep these away from ordinary tenants; the Super Admin UI labels them so enabling one is a conscious choice.
 */
const FEATURES = [
  { key: 'dashboard', group: 'overview', icon: 'view-dashboard-outline', href: '/admin', shared: false },
  { key: 'settingsMap', group: 'overview', icon: 'tune-variant', href: '/admin/settings', shared: false },
  { key: 'requests', group: 'overview', icon: 'inbox-full-outline', href: '/admin/requests', shared: false },
  { key: 'users', group: 'overview', icon: 'account-group-outline', href: '/admin/users', shared: false },
  { key: 'chats', group: 'overview', icon: 'message-text-outline', href: '/admin/chats', shared: false },
  { key: 'notifications', group: 'overview', icon: 'bell-ring-outline', href: '/admin/notifications', shared: false },
  { key: 'credits', group: 'overview', icon: 'star-circle-outline', href: '/admin/credits', shared: false },
  { key: 'plans', group: 'overview', icon: 'crown-outline', href: '/admin/plans', shared: true },
  { key: 'tabs', group: 'content', icon: 'tab', href: '/admin/tabs', shared: true },
  { key: 'tools', group: 'content', icon: 'toolbox-outline', href: '/admin/tools', shared: true },
  { key: 'sections', group: 'content', icon: 'view-carousel-outline', href: '/admin/sections', shared: true },
  { key: 'categories', group: 'content', icon: 'view-grid-outline', href: '/admin/categories', shared: true },
  { key: 'inspirations', group: 'content', icon: 'image-multiple-outline', href: '/admin/inspirations', shared: true },
  { key: 'styles', group: 'creation', icon: 'palette-swatch-outline', href: '/admin/styles', shared: true },
  { key: 'roomTypes', group: 'creation', icon: 'door-open', href: '/admin/roomTypes', shared: true },
  { key: 'palettes', group: 'creation', icon: 'invert-colors', href: '/admin/palettes', shared: true },
  { key: 'models', group: 'ai', icon: 'robot-outline', href: '/admin/models', shared: true },
  { key: 'promptCards', group: 'ai', icon: 'text-box-outline', href: '/admin/prompt-cards', shared: true },
  { key: 'assistant', group: 'ai', icon: 'message-text-outline', href: '/admin/assistant', shared: true },
  { key: 'branding', group: 'appearance', icon: 'flag-outline', href: '/admin/branding', shared: true },
  { key: 'theme', group: 'appearance', icon: 'palette-outline', href: '/admin/theme', shared: true },
  { key: 'interface', group: 'appearance', icon: 'page-layout-footer', href: '/admin/interface', shared: true },
  { key: 'layouts', group: 'appearance', icon: 'view-dashboard-variant-outline', href: '/admin/layouts', shared: true },
  { key: 'studio', group: 'appearance', icon: 'motion-play-outline', href: '/admin/studio', shared: true },
  { key: 'performance', group: 'appearance', icon: 'speedometer', href: '/admin/performance', shared: true },
];
const GROUPS = ['overview', 'content', 'creation', 'ai', 'appearance'];
const FEATURE_KEYS = FEATURES.map(feature => feature.key);
const isFeature = key => FEATURE_KEYS.includes(key);

/** { key: level } for every feature. */
const allLevels = level => Object.fromEntries(FEATURE_KEYS.map(key => [key, level]));
const groupLevels = (groups, level, base = {}) => ({ ...base, ...Object.fromEntries(FEATURES.filter(f => groups.includes(f.group)).map(f => [f.key, level])) });
const pickLevels = (keys, level, base = {}) => ({ ...base, ...Object.fromEntries(keys.map(key => [key, level])) });

/** Keeps only known features with valid levels. `strict` throws on anything unknown (API input); otherwise unknown entries are dropped (stored data). */
function cleanLevels(input, { strict = false, fail = message => new Error(message) } = {}) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw fail('INVALID_PERMISSIONS');
  const out = {};
  for (const [key, level] of Object.entries(input)) {
    if (!isFeature(key) || !isLevel(level)) { if (strict) throw fail('INVALID_PERMISSIONS'); continue; }
    out[key] = level;
  }
  return out;
}

/** Plans: what a tenant may use (levels) and how big it may grow (limits, null = unlimited). Editable by the super admin; these are the defaults. */
const DEFAULT_PLANS = [
  {
    id: 'starter', name: 'Starter', price: 0,
    limits: { maxClients: 200, maxAdmins: 2, monthlyDesigns: 300 },
    features: pickLevels(['dashboard', 'requests', 'users', 'chats', 'credits'], 'edit', pickLevels(['settingsMap', 'notifications'], 'view', allLevels('none'))),
  },
  {
    id: 'pro', name: 'Pro', price: 49,
    limits: { maxClients: 2000, maxAdmins: 10, monthlyDesigns: 3000 },
    features: pickLevels(['dashboard', 'settingsMap', 'requests', 'users', 'chats', 'notifications', 'credits'], 'edit', allLevels('none')),
  },
  {
    id: 'enterprise', name: 'Enterprise', price: 199,
    limits: { maxClients: null, maxAdmins: null, monthlyDesigns: null },
    features: allLevels('edit'),
  },
];

/** Built-in roles every tenant can use (tenant_id NULL in the database, read only; copy one to customise it). */
const SYSTEM_ROLES = [
  { id: 'role_owner', name: 'Owner', description: 'Full access to everything the tenant plan includes.', permissions: allLevels('edit') },
  { id: 'role_manager', name: 'Manager', description: 'Runs clients, requests and content; sees AI and appearance settings without changing them.', permissions: groupLevels(['ai', 'appearance'], 'view', groupLevels(['overview', 'content', 'creation'], 'edit')) },
  { id: 'role_editor', name: 'Content editor', description: 'Edits the catalog and the look of the app. No access to clients or requests.', permissions: groupLevels(['content', 'creation', 'appearance'], 'edit', pickLevels(['dashboard', 'settingsMap'], 'view', allLevels('none'))) },
  { id: 'role_support', name: 'Support agent', description: 'Answers clients: requests, chats and credits. Read only on notifications.', permissions: pickLevels(['requests', 'users', 'chats', 'credits'], 'edit', pickLevels(['dashboard', 'notifications'], 'view', allLevels('none'))) },
  { id: 'role_analyst', name: 'Analyst (read only)', description: 'Sees the dashboard, requests, clients and chats. Cannot change anything.', permissions: pickLevels(['dashboard', 'requests', 'users', 'chats', 'credits'], 'view', allLevels('none')) },
];

/** Plan + the tenant's own overrides -> the levels the tenant may use. */
function tenantLevels(plan, overrides) {
  return { ...allLevels('none'), ...cleanLevels(plan?.features), ...cleanLevels(overrides) };
}
/** Tenant levels capped by the account's role (and by the account's own overrides, which can only lower or raise within the tenant's ceiling). */
function effectiveLevels(tenant, role, overrides) {
  const roleLevels = { ...cleanLevels(role), ...cleanLevels(overrides) };
  return Object.fromEntries(FEATURE_KEYS.map(key => [key, minLevel(tenant[key] || 'none', roleLevels[key] || 'none')]));
}
/** Limits: the plan's, with the tenant's own values on top (an explicit null = unlimited). */
function effectiveLimits(plan, own) {
  const merged = { ...(plan?.limits || {}) };
  for (const key of ['maxClients', 'maxAdmins', 'monthlyDesigns', 'startCredits']) if (own && Object.hasOwn(own, key)) merged[key] = own[key];
  return { maxClients: merged.maxClients ?? null, maxAdmins: merged.maxAdmins ?? null, monthlyDesigns: merged.monthlyDesigns ?? null, startCredits: merged.startCredits ?? null };
}

const can = (levels, key, need) => rank(levels?.[key]) >= rank(need);
const canAny = (levels, keys, need) => keys.some(key => can(levels, key, need));
const hasAnyEdit = levels => FEATURE_KEYS.some(key => can(levels, key, 'edit'));

/**
 * The shared settings document (`settings`) is written by many pages. Each key says which pages may change it; a key that is not
 * listed belongs to the Interface page.
 */
const SETTINGS_KEY_FEATURES = {
  toolCards: ['studio', 'performance', 'tools'], layouts: ['layouts'], homeTabsVisible: ['tabs'],
  defaultFreeCredits: ['credits'], notifyAdmins: ['notifications'], notifyUsers: ['notifications'], campaignCapHours: ['notifications'],
  aiModelPicker: ['models'], aiRotation: ['models'], autoSendWhatsApp: ['requests'],
};
const settingsKeyFeatures = key => SETTINGS_KEY_FEATURES[key] || ['interface'];
function settingsPatchAllowed(levels, patch) {
  return !!patch && typeof patch === 'object' && Object.keys(patch).every(key => canAny(levels, settingsKeyFeatures(key), 'edit'));
}

/** Content collections and documents -> the feature that owns them. */
const COLL_FEATURE = { tabs: 'tabs', tools: 'tools', roomTypes: 'roomTypes', styles: 'styles', palettes: 'palettes', sections: 'sections', categories: 'categories', inspirations: 'inspirations', models: 'models', plans: 'plans' };
const DOC_FEATURE = { branding: 'branding', theme: 'theme', assistant: 'assistant' };

const READ = method => method === 'GET' || method === 'HEAD';
const need = method => (READ(method) ? 'view' : 'edit');

/**
 * Which features can authorise an admin API call?
 *   null                          -> any signed-in admin account (session, prefs, push devices ...)
 *   { any: [features], need }     -> at least one of the features must reach `need`
 *   { anyEdit: true }             -> shared helpers (uploads, translation): the account must be able to edit something
 *   { doc: 'settings' }           -> decided from the keys of the request body (see settingsPatchAllowed)
 *   { superOnly: true }           -> not available to tenant admins at all
 */
function requirement(method, pathname) {
  const m = method.toUpperCase();
  let match;
  if (pathname === '/api/admin/clients/bulk') return { any: ['users', 'credits'], need: 'edit' };
  if (pathname === '/api/admin/clients') return { any: ['users', 'dashboard', 'credits', 'requests', 'notifications', 'chats'], need: 'view' };
  if (/^\/api\/admin\/clients\/[^/]+$/.test(pathname)) return { any: ['users', 'credits'], need: need(m) };
  if (pathname.startsWith('/api/admin/conversations')) return { any: ['chats'], need: need(m) };
  if (pathname === '/api/admin/notification-subscribers') return { any: ['notifications'], need: 'view' };
  if ((match = pathname.match(/^\/api\/admin\/campaigns(?:\/([^/]+))?(?:\/([^/]+))?$/))) {
    const sub = match[1] === 'segments' || match[1] === 'preview' || match[1] === 'people';
    return { any: ['notifications'], need: sub ? 'view' : need(m) };
  }
  if (pathname === '/api/admin/ai/status') return { any: ['models', 'promptCards'], need: 'view' };
  if (pathname === '/api/admin/ai/keys') return { any: ['models'], need: 'edit' };
  if (pathname === '/api/admin/prompt-rules/preview') return { any: ['promptCards'], need: 'view' };
  if (pathname === '/api/admin/prompt-rules') return { any: ['promptCards'], need: need(m) };
  if (pathname === '/api/admin/chat/status') return { any: ['assistant', 'models'], need: 'view' };
  if (pathname === '/api/admin/chat/keys' || pathname === '/api/admin/chat/config') return { any: ['assistant'], need: 'edit' };
  if (pathname === '/api/admin/assistant/test' || pathname === '/api/admin/assistant/knowledge') return { any: ['assistant'], need: 'view' };
  if (pathname.startsWith('/api/admin/assistant/')) return { any: ['assistant'], need: need(m) };
  if ((match = pathname.match(/^\/api\/admin\/content\/([A-Za-z]+)(?:\/[^/]+)?$/))) return COLL_FEATURE[match[1]] ? { any: [COLL_FEATURE[match[1]]], need: need(m) } : { anyEdit: true };
  if ((match = pathname.match(/^\/api\/admin\/doc\/([A-Za-z]+)$/))) return DOC_FEATURE[match[1]] ? { any: [DOC_FEATURE[match[1]]], need: 'edit' } : match[1] === 'settings' ? { doc: 'settings' } : { anyEdit: true };
  if (pathname === '/api/admin/translate' || pathname.startsWith('/api/admin/media')) return { anyEdit: true };
  if (pathname === '/api/requests' && m === 'GET') return { any: ['requests', 'dashboard', 'users'], need: 'view' };
  if (/^\/api\/requests\/[A-Za-z0-9_-]+$/.test(pathname)) return { any: ['requests'], need: need(m) };
  return null;
}

/** `{ ok, status, code }` for one call, given the account's levels. */
function check(levels, rule, body) {
  if (!rule) return { ok: true };
  if (rule.anyEdit) return hasAnyEdit(levels) ? { ok: true } : { ok: false, code: 'FEATURE_READONLY' };
  if (rule.doc) return rule.doc === 'settings' && settingsPatchAllowed(levels, body) ? { ok: true } : { ok: false, code: 'FEATURE_READONLY' };
  if (canAny(levels, rule.any, rule.need)) return { ok: true };
  // Distinguish "may look but not change" from "may not even look" so the UI can say the right thing.
  return { ok: false, code: rule.need === 'edit' && canAny(levels, rule.any, 'view') ? 'FEATURE_READONLY' : 'FEATURE_FORBIDDEN' };
}

/** Which admin page does a path belong to (UI route guard). `/admin` is the dashboard, `/admin/prompt-cards` is promptCards, `/admin/settings` is settingsMap. */
function featureForPath(pathname) {
  const clean = String(pathname || '').replace(/\/+$/, '') || '/';
  if (clean === '/admin') return 'dashboard';
  const name = clean.split('/')[2];
  if (name === 'prompt-cards') return 'promptCards';
  if (name === 'settings') return 'settingsMap';
  return isFeature(name) ? name : null;
}

module.exports = {
  LEVELS, rank, minLevel, isLevel, FEATURES, GROUPS, FEATURE_KEYS, isFeature, allLevels, cleanLevels, DEFAULT_PLANS, SYSTEM_ROLES,
  tenantLevels, effectiveLevels, effectiveLimits, can, canAny, hasAnyEdit, settingsKeyFeatures, settingsPatchAllowed, requirement, check, featureForPath,
};
