/**
 * Access model of the administrators (roles, permissions, UI access) - the single source of truth for the server.
 *
 * Permissions are per AREA with two levels: `view` (read) and `manage` (read + write). The level a request needs comes from its HTTP
 * method (GET / HEAD = view, anything else = manage) and its path (see requiredAccess). `src/lib/access.ts` mirrors AREAS and PAGES for the
 * UI; scripts/check-superadmin-server.js fails when the two (or the admin menu in src/lib/adminNav.ts) drift apart.
 *
 * UI access is the list of admin menu pages an administrator can open. It hides what they cannot use; the server still enforces the permissions.
 * An administrator with no role and no override (the built-in `admin`, the ADMIN_EMAIL account) has full access, exactly as before this model existed.
 */
const fail = (status, message) => Object.assign(new Error(message), { status });

const AREAS = ['requests', 'clients', 'chats', 'notifications', 'content', 'ai', 'appearance', 'settings'];
const LEVELS = ['view', 'manage'];
/** Admin menu page -> the area it belongs to (null = every administrator, the dashboard). */
const PAGES = {
  dashboard: null,
  settingsMap: 'settings',
  requests: 'requests',
  users: 'clients', credits: 'clients',
  chats: 'chats',
  notifications: 'notifications',
  plans: 'content', tabs: 'content', tools: 'content', sections: 'content', categories: 'content', inspirations: 'content',
  styles: 'content', roomTypes: 'content', palettes: 'content',
  models: 'ai', promptCards: 'ai', assistant: 'ai',
  branding: 'appearance', theme: 'appearance', interface: 'appearance', layouts: 'appearance', studio: 'appearance', performance: 'appearance',
};
const UI_KEYS = Object.keys(PAGES);
const FULL_ROLE = 'owner';

const allPermissions = level => Object.fromEntries(AREAS.map(area => [area, level]));

/** Roles created on first use. `owner` is locked (always everything); the others can be edited or deleted like any custom role. */
const SEED_ROLES = [
  { id: 'owner', name: 'Owner', description: 'Full access to every area and page.', permissions: allPermissions('manage'), ui: UI_KEYS, system: true },
  {
    id: 'content_manager', name: 'Content manager', description: 'Edits the catalogue, the look of the app and the AI models.',
    permissions: { content: 'manage', appearance: 'manage', ai: 'manage', requests: 'view' },
    ui: UI_KEYS.filter(key => ['dashboard', 'requests'].includes(key) || ['content', 'appearance', 'ai'].includes(PAGES[key])),
  },
  {
    id: 'support', name: 'Support agent', description: 'Handles render requests, clients, conversations and notifications.',
    permissions: { requests: 'manage', clients: 'manage', chats: 'manage', notifications: 'manage' },
    ui: UI_KEYS.filter(key => key === 'dashboard' || ['requests', 'clients', 'chats', 'notifications'].includes(PAGES[key])),
  },
  {
    id: 'analyst', name: 'Analyst (read only)', description: 'Can look at everything, change nothing.',
    permissions: allPermissions('view'), ui: UI_KEYS,
  },
];

const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

/** { area: 'view' | 'manage' } from user input. Unknown areas / levels are an error, never silently dropped. */
function cleanPermissions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'INVALID_PERMISSIONS');
  const out = {};
  for (const [area, level] of Object.entries(input)) {
    if (!AREAS.includes(area) || (level !== null && level !== 'none' && !LEVELS.includes(level))) throw fail(400, 'INVALID_PERMISSIONS');
    if (LEVELS.includes(level)) out[area] = level;
  }
  return out;
}
/** Unique, known page keys; the dashboard is always there. */
function cleanUi(input) {
  if (!Array.isArray(input) || input.length > 200) throw fail(400, 'INVALID_UI_ACCESS');
  const out = new Set(['dashboard']);
  for (const key of input) {
    if (typeof key !== 'string' || !UI_KEYS.includes(key)) throw fail(400, 'INVALID_UI_ACCESS');
    out.add(key);
  }
  return UI_KEYS.filter(key => out.has(key));
}

/**
 * Effective access of one administrator from the joined row ({ role_id, perm_override, role_perms, role_ui }).
 * An override (customised for this person) wins over the role. A role id that no longer exists grants nothing.
 */
function resolveAccess(row) {
  const override = row?.perm_override ? parse(row.perm_override, null) : null;
  const roleId = row?.role_id || null;
  if (!roleId && !override) return { full: true, roleId: null, roleName: '', permissions: allPermissions('manage'), ui: UI_KEYS, custom: false };
  if (roleId === FULL_ROLE && !override) return { full: true, roleId, roleName: row.role_name || 'Owner', permissions: allPermissions('manage'), ui: UI_KEYS, custom: false };
  const rolePerms = row?.role_perms ? parse(row.role_perms, {}) : {};
  const roleUi = row?.role_ui ? parse(row.role_ui, []) : [];
  let permissions = {}, ui = ['dashboard'];
  try { permissions = cleanPermissions(override?.permissions ?? rolePerms); } catch { permissions = {}; }
  try { ui = cleanUi(override?.ui ?? roleUi); } catch { ui = ['dashboard']; }
  return { full: false, roleId, roleName: row?.role_name || '', permissions, ui, custom: !!override };
}
const publicAccess = access => ({ full: access.full, role: access.roleId ? { id: access.roleId, name: access.roleName } : null, custom: !!access.custom, permissions: access.permissions, ui: access.ui });

/** Is `level` of `area` granted? `manage` includes `view`. `areas` may be one area or a list (any of them). */
function allows(access, areas, level = 'view') {
  if (access.full) return true;
  return [].concat(areas).some(area => {
    const have = access.permissions[area];
    return have === 'manage' || (have === 'view' && level === 'view');
  });
}

/**
 * What an API request needs: `{ areas, level }` (any of `areas`), or null when every signed-in administrator may call it (own account,
 * preferences, own notification devices, session). Anything under /api/admin that is not listed here needs `manage` somewhere
 * (the safe default for a route added later).
 */
function requiredAccess(pathname, method) {
  const level = method === 'GET' || method === 'HEAD' ? 'view' : 'manage';
  const need = (areas, lv = level) => ({ areas: [].concat(areas), level: lv });
  if (pathname === '/api/requests') return method === 'POST' ? null : need('requests');   // POST = a client's own request
  // /api/requests/:id is shared with the owning client (who may hold an admin cookie too): server/index.js checks it per request.
  if (pathname.startsWith('/api/requests/')) return null;
  if (pathname === '/api/push/test') return need('notifications', 'manage');
  if (!pathname.startsWith('/api/admin/')) return null;
  const rest = pathname.slice('/api/admin/'.length);
  if (rest === 'login' || rest === 'logout' || rest === 'session' || rest === 'account' || rest.startsWith('account/')) return null;
  if (rest === 'clients' || rest.startsWith('clients/')) return need('clients');
  if (rest === 'conversations' || rest.startsWith('conversations/')) return need('chats');
  if (rest === 'campaigns' || rest.startsWith('campaigns/') || rest === 'notification-subscribers') return need('notifications');
  const item = /^content\/([A-Za-z]+)/.exec(rest);
  if (item) return need(item[1] === 'models' ? 'ai' : 'content');
  const doc = /^doc\/([A-Za-z]+)$/.exec(rest);
  if (doc) {
    if (doc[1] === 'branding' || doc[1] === 'theme') return need('appearance');
    if (doc[1] === 'assistant') return need('ai');
    return need(AREAS, 'manage'); // the shared settings document: edited from many pages
  }
  if (/^(ai|chat|assistant|prompt-rules)(\/|$)/.test(rest)) return need('ai');
  if (rest === 'translate' || rest === 'media' || rest.startsWith('media/')) return need(AREAS, 'manage'); // helpers of every editor
  return need(AREAS, 'manage');
}

module.exports = { AREAS, LEVELS, PAGES, UI_KEYS, FULL_ROLE, SEED_ROLES, cleanPermissions, cleanUi, resolveAccess, publicAccess, allows, requiredAccess, allPermissions };
