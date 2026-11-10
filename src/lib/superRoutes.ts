/** The Super Admin lives at /superadmin: that address is the sign-in page, and the dashboard once signed in. */
export const SUPER_HOME = '/superadmin';
export const SUPER_DASH = '/superadmin/dashboard';
export const inSuperArea = (path: string) => path === SUPER_HOME || path.startsWith(`${SUPER_HOME}/`);

export type SuperNavItem = { key: string; icon: string; href: string };
export const SUPER_GROUPS: { key: 'overview' | 'people' | 'system'; items: SuperNavItem[] }[] = [
  { key: 'overview', items: [{ key: 'dashboard', icon: 'view-dashboard-outline', href: '/superadmin/dashboard' }] },
  { key: 'people', items: [
    { key: 'admins', icon: 'account-tie-outline', href: '/superadmin/admins' },
    { key: 'roles', icon: 'shield-key-outline', href: '/superadmin/roles' },
    { key: 'tenants', icon: 'domain', href: '/superadmin/tenants' },
    { key: 'clients', icon: 'account-group-outline', href: '/superadmin/clients' },
  ] },
  { key: 'system', items: [
    { key: 'platform', icon: 'tune-variant', href: '/superadmin/platform' },
    { key: 'audit', icon: 'clipboard-text-clock-outline', href: '/superadmin/audit' },
    { key: 'security', icon: 'shield-lock-outline', href: '/superadmin/security' },
  ] },
];
