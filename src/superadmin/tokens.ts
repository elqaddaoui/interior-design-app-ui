/**
 * Design system of the Super Admin console (docs/MULTI_TENANT_PLAN.md section 5).
 *
 * HARD-CODED ON PURPOSE. These constants are the only source of colour, spacing, radius and type for everything under
 * `src/superadmin/` and `src/app/super-admin/`. They are never read from the database, the tenant theme, branding, settings or
 * translations, and no tenant API can write them, so no tenant administrator can see or change this style.
 * `scripts/check-superadmin-isolation.js` (part of `npm run test:server`) fails when a file in those folders imports tenant theming.
 *
 * Look: calm light surfaces, one accent colour, thin borders, generous spacing (in the spirit of Linear / Vercel dashboards).
 */
export const SA = {
  color: {
    bg: '#F5F6FA', panel: '#FFFFFF', panel2: '#F0F2F8', line: '#E2E6F0', text: '#11162A', muted: '#667089', accent: '#4F46E5', onAccent: '#FFFFFF',
    ok: '#0E9F6E', warn: '#B76E00', danger: '#D12B42', overlay: 'rgba(14,18,36,0.46)',
    // Soft tints for badges, notices and selected rows.
    accentSoft: '#ECEBFF', okSoft: '#E4F6EE', warnSoft: '#FFF3DC', dangerSoft: '#FDEBEE',
  },
  radius: { sm: 6, md: 10, lg: 14 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  font: { size: { xs: 11, sm: 13, md: 15, lg: 18, xl: 24 }, weight: { regular: '400', medium: '600', bold: '800' } as const },
  /** System font stack: the console never loads a tenant font. */
  family: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  maxWidth: 1120,
  /** Width from which the navigation becomes a side bar and sheets become centred dialogs. */
  wide: 900,
} as const;
