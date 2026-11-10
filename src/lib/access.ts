/**
 * Access model of the administrators, mirrored from server/access.js (scripts/check-superadmin-server.js fails when they drift).
 * Permissions are per AREA (`view` reads, `manage` reads and writes); UI access is the list of admin menu pages one can open.
 */
export const AREAS = ['requests', 'clients', 'chats', 'notifications', 'content', 'ai', 'appearance', 'settings'] as const;
export type Area = (typeof AREAS)[number];
export type Level = 'view' | 'manage';
export type Permissions = Partial<Record<Area, Level>>;

/** Admin menu page -> the area it belongs to (null = every administrator). */
export const PAGES: Record<string, Area | null> = {
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
export const UI_KEYS = Object.keys(PAGES);

/** What the server says one administrator may do (GET /api/admin/session -> access). */
export type AdminAccess = {
  full: boolean;
  role: { id: string; name: string } | null;
  custom: boolean;
  permissions: Permissions;
  ui: string[];
};

/** Full access: what an administrator without a role has. */
export const FULL_ACCESS: AdminAccess = { full: true, role: null, custom: false, permissions: Object.fromEntries(AREAS.map(a => [a, 'manage'])) as Permissions, ui: UI_KEYS };

export const canOpen = (access: AdminAccess | null | undefined, key: string): boolean => !access || access.full || access.ui.includes(key);
