export type NavItem = { key: string; icon: string; href: string };
type NavGroup = { key: 'overview' | 'content' | 'creation' | 'ai' | 'appearance'; items: NavItem[] };

/** Menu items grouped by topic so related screens sit together. */
export const ADMIN_GROUPS: NavGroup[] = [
  { key: 'overview', items: [
    { key: 'dashboard', icon: 'view-dashboard-outline', href: '/admin' },
    { key: 'settingsMap', icon: 'tune-variant', href: '/admin/settings' },
    { key: 'requests', icon: 'inbox-full-outline', href: '/admin/requests' },
    { key: 'users', icon: 'account-group-outline', href: '/admin/users' },
    { key: 'chats', icon: 'message-text-outline', href: '/admin/chats' },
    { key: 'notifications', icon: 'bell-ring-outline', href: '/admin/notifications' },
    { key: 'credits', icon: 'star-circle-outline', href: '/admin/credits' },
    { key: 'plans', icon: 'crown-outline', href: '/admin/plans' },
    { key: 'support', icon: 'lifebuoy', href: '/admin/support' },
  ] },
  { key: 'content', items: [
    { key: 'tabs', icon: 'tab', href: '/admin/tabs' },
    { key: 'tools', icon: 'toolbox-outline', href: '/admin/tools' },
    { key: 'sections', icon: 'view-carousel-outline', href: '/admin/sections' },
    { key: 'categories', icon: 'view-grid-outline', href: '/admin/categories' },
    { key: 'inspirations', icon: 'image-multiple-outline', href: '/admin/inspirations' },
  ] },
  { key: 'creation', items: [
    { key: 'styles', icon: 'palette-swatch-outline', href: '/admin/styles' },
    { key: 'roomTypes', icon: 'door-open', href: '/admin/roomTypes' },
    { key: 'palettes', icon: 'invert-colors', href: '/admin/palettes' },
  ] },
  { key: 'ai', items: [
    { key: 'models', icon: 'robot-outline', href: '/admin/models' },
    { key: 'promptCards', icon: 'text-box-outline', href: '/admin/prompt-cards' },
    { key: 'assistant', icon: 'message-text-outline', href: '/admin/assistant' },
  ] },
  { key: 'appearance', items: [
    { key: 'branding', icon: 'flag-outline', href: '/admin/branding' },
    { key: 'theme', icon: 'palette-outline', href: '/admin/theme' },
    { key: 'interface', icon: 'page-layout-footer', href: '/admin/interface' },
    { key: 'layouts', icon: 'view-dashboard-variant-outline', href: '/admin/layouts' },
    { key: 'studio', icon: 'motion-play-outline', href: '/admin/studio' },
    { key: 'performance', icon: 'speedometer', href: '/admin/performance' },
  ] },
];
export const ADMIN_NAV = ADMIN_GROUPS.flatMap((g) => g.items);

