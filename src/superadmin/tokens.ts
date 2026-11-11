/**
 * Design system of the Super Admin console (docs/MULTI_TENANT_PLAN.md section 5).
 *
 * HARD-CODED ON PURPOSE. These constants are the only source of colour, spacing, radius and type for everything under
 * `src/superadmin/` and `src/app/super-admin/`. They are never read from the database, the tenant theme, branding, settings or
 * translations, and no tenant API can write them, so no tenant administrator can see or change this style.
 * `scripts/check-superadmin-isolation.js` (part of `npm run test:server`) fails when a file in those folders imports tenant theming.
 */
export const SA = {
  color: {
    bg: '#0B1020', panel: '#121A30', panel2: '#18223D', line: '#26324F', text: '#E8ECF8', muted: '#8F9BBA',
    accent: '#6C8CFF', onAccent: '#0B1020', ok: '#3DD68C', warn: '#F5B94A', danger: '#FF6B7A', overlay: 'rgba(5,8,18,0.72)',
  },
  radius: { sm: 6, md: 10, lg: 14 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  font: { size: { xs: 11, sm: 13, md: 15, lg: 18, xl: 24 }, weight: { regular: '400', medium: '600', bold: '800' } as const },
  /** System font stack: the console never loads a tenant font. */
  family: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  maxWidth: 1180,
} as const;
