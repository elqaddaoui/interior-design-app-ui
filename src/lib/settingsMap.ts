/**
 * THE map of every setting: who it affects and where it is edited. One source of truth for
 *  - Admin > Settings map (searchable list, with the live ON/OFF state),
 *  - the audience badges shown on the admin pages,
 *  - the admin search (typing "chat" finds the setting and opens its page),
 *  - `npm run check:settings` (a new AppSettings key that is not listed here fails the check).
 *
 * Audience = who feels the change:
 *   clients  every client of the app (the admin decides, the clients just see the result)
 *   admins   only the people working in the admin panel
 *   both     the whole product, clients and admin panel (brand, theme, fonts)
 *   personal each person decides for themself, in the user Settings page (/settings)
 * Pure (no React) so it runs in the Node checks. Texts: src/i18n/locales/settingsmap.ts (`sm.<id>` title, `sm.<id>_d` description).
 */
export type Audience = 'clients' | 'admins' | 'both' | 'personal';
export interface SettingEntry {
  id: string;
  audience: Audience;
  /** Screen where it is edited. Personal settings live in the user Settings page. */
  href: string;
  icon: string;
  /** AppSettings keys it owns (dotted = inside an object, `doc:` = another document such as branding). Used by the coverage check. */
  keys: string[];
}

export const AUDIENCES: Audience[] = ['clients', 'admins', 'both', 'personal'];
export const AUDIENCE_ICON: Record<Audience, string> = { clients: 'account-group-outline', admins: 'shield-account-outline', both: 'earth', personal: 'account-circle-outline' };

const I = '/admin/interface';
export const SETTINGS_MAP: SettingEntry[] = [
  // What the clients live (the admin decides)
  { id: 'appSearch', audience: 'clients', href: I, icon: 'magnify', keys: ['appSearchEnabled'] },
  { id: 'exitConfirm', audience: 'clients', href: I, icon: 'exit-to-app', keys: ['exitConfirmationEnabled', 'exitTitle', 'exitMessage'] },
  { id: 'waChat', audience: 'clients', href: I, icon: 'message-text-outline', keys: ['waChat'] },
  { id: 'modeChoice', audience: 'clients', href: I, icon: 'swap-horizontal', keys: ['modeChoice'] },
  { id: 'loader', audience: 'clients', href: I, icon: 'loading', keys: ['loaderEnabled', 'loaderStyle', 'loaderColor', 'loaderCustomUri', 'loaderCustomAnim', 'loaderDelayMs'] },
  { id: 'userNav', audience: 'clients', href: I, icon: 'page-layout-footer', keys: ['userNavStyle'] },
  { id: 'gallery', audience: 'clients', href: I, icon: 'view-grid-outline', keys: ['galleryLayout'] },
  { id: 'layouts', audience: 'clients', href: '/admin/layouts', icon: 'view-dashboard-variant-outline', keys: ['layouts'] },
  { id: 'homeTabs', audience: 'clients', href: '/admin/tabs', icon: 'tab', keys: ['homeTabsVisible'] },
  { id: 'cardLook', audience: 'clients', href: '/admin/studio', icon: 'motion-play-outline', keys: ['toolCards'] },
  { id: 'video', audience: 'clients', href: '/admin/performance', icon: 'speedometer', keys: ['toolCards.video'] },
  { id: 'freeCredits', audience: 'clients', href: '/admin/credits', icon: 'star-circle-outline', keys: ['defaultFreeCredits'] },
  { id: 'modelPicker', audience: 'clients', href: '/admin/models', icon: 'robot-outline', keys: ['aiModelPicker'] },
  { id: 'modelRotation', audience: 'clients', href: '/admin/models', icon: 'autorenew', keys: ['aiRotation'] },
  { id: 'autoWhatsApp', audience: 'clients', href: '/admin/requests', icon: 'send-outline', keys: ['autoSendWhatsApp'] },
  { id: 'notifyUsers', audience: 'clients', href: '/admin/notifications', icon: 'bell-ring-outline', keys: ['notifyUsers'] },
  { id: 'notifyCap', audience: 'clients', href: '/admin/notifications', icon: 'timer-sand', keys: ['campaignCapHours'] },
  { id: 'assistant', audience: 'clients', href: '/admin/assistant', icon: 'message-text-outline', keys: ['doc:assistant'] },
  // Clients and admin panel
  { id: 'brand', audience: 'both', href: '/admin/branding', icon: 'flag-outline', keys: ['doc:branding'] },
  { id: 'theme', audience: 'both', href: '/admin/theme', icon: 'palette-outline', keys: ['doc:theme'] },
  { id: 'fonts', audience: 'both', href: I, icon: 'format-font', keys: ['arabicFont', 'frenchFont'] },
  // Admin panel only
  { id: 'adminSearch', audience: 'admins', href: I, icon: 'magnify', keys: ['adminSearchEnabled'] },
  { id: 'menuDesign', audience: 'admins', href: I, icon: 'menu-open', keys: ['adminMenuDesign'] },
  { id: 'menuAnim', audience: 'admins', href: I, icon: 'motion-play-outline', keys: ['adminMenuAnim'] },
  { id: 'bulk', audience: 'admins', href: I, icon: 'checkbox-multiple-marked-outline', keys: ['bulkPanels'] },
  { id: 'autoTranslate', audience: 'admins', href: I, icon: 'translate', keys: ['autoTranslate'] },
  { id: 'notifyAdmins', audience: 'admins', href: '/admin/notifications', icon: 'bell-outline', keys: ['notifyAdmins'] },
  // Personal: each person, in the user Settings page
  { id: 'language', audience: 'personal', href: '/settings', icon: 'translate', keys: ['pref:lang'] },
  { id: 'notifyMe', audience: 'personal', href: '/settings', icon: 'bell-outline', keys: ['pref:notifications'] },
  { id: 'myCredits', audience: 'personal', href: '/settings', icon: 'star-four-points-outline', keys: ['user:credits'] },
  { id: 'account', audience: 'personal', href: '/settings', icon: 'account-circle-outline', keys: ['user:session'] },
];

/** AppSettings keys that are deliberately NOT editable (kept so old saved data still loads). */
export const LEGACY_KEYS = ['homeShowAll'];

/** Which section of the page an entry is listed in (`both` is listed with the clients: it is part of what they see). */
export const sectionOf = (a: Audience): 'clients' | 'admins' | 'personal' => (a === 'both' ? 'clients' : a);

/** The audience filter of the page: `clients` also shows `both`, `admins` also shows `both`. */
export function matchesAudience(entry: SettingEntry, filter: Audience | 'all'): boolean {
  if (filter === 'all') return true;
  if (filter === 'clients' || filter === 'admins') return entry.audience === filter || entry.audience === 'both';
  return entry.audience === filter;
}

/** Live ON/OFF of the settings that are a plain switch (undefined = not a switch, nothing to show). Defaults mirror the screens that read them. */
export function stateOf(id: string, s: Record<string, unknown>): 'on' | 'off' | undefined {
  const on = (v: unknown, def = true) => ((v === undefined ? def : v !== false && v !== 0) ? 'on' : 'off') as 'on' | 'off';
  switch (id) {
    case 'appSearch': return on(s.appSearchEnabled);
    case 'adminSearch': return on(s.adminSearchEnabled);
    case 'exitConfirm': return on(s.exitConfirmationEnabled);
    case 'waChat': return on(s.waChat);
    case 'modeChoice': return on(s.modeChoice);
    case 'loader': return on(s.loaderEnabled);
    case 'homeTabs': return on(s.homeTabsVisible);
    case 'modelPicker': return s.aiModelPicker === true ? 'on' : 'off';
    case 'modelRotation': return (s.aiRotation as { on?: boolean } | undefined)?.on ? 'on' : 'off';
    case 'autoWhatsApp': return s.autoSendWhatsApp ? 'on' : 'off';
    case 'notifyUsers': return on(s.notifyUsers);
    case 'notifyAdmins': return on(s.notifyAdmins);
    case 'menuAnim': return on(s.adminMenuAnim);
    case 'autoTranslate': return on(s.autoTranslate);
    default: return undefined;
  }
}

/** Entries after a text filter (`text(id)` returns the searchable title + description in the current language). */
export function filterSettings(filter: Audience | 'all', query: string, text: (e: SettingEntry) => string): SettingEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return SETTINGS_MAP.filter((e) => matchesAudience(e, filter) && (!needle || text(e).toLocaleLowerCase().includes(needle)));
}
