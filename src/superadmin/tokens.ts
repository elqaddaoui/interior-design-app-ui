/**
 * Design system of the Super Admin console (docs/MULTI_TENANT_PLAN.md section 5).
 *
 * HARD-CODED ON PURPOSE. These constants are the only source of colour, spacing, radius and type for everything under
 * `src/superadmin/` and `src/app/super-admin/`. They are never read from the database, the tenant theme, branding, settings or
 * translations, and no tenant API can write them, so no tenant administrator can see or change this style.
 * `scripts/check-superadmin-isolation.js` (part of `npm run test:server`) fails when a file in those folders imports tenant theming.
 *
 * Look: calm surfaces, one accent colour, thin borders, generous spacing (in the spirit of Linear / Vercel dashboards).
 *
 * Themes: twelve palettes (six light, six dark; four of the dark ones are eye-friendly: warm or green-grey, no pure white on pure black).
 * The platform owner picks one in Settings. The choice is kept in this browser only (localStorage key `sa-theme`): it is never sent to
 * the server. `SA.color` always holds the active palette; `applySaTheme()` swaps it and the console remounts (see Shell.tsx).
 * Every palette is checked by `npm run check:themes` (WCAG AA text, 7:1 for body text).
 */
export type SaPalette = {
  bg: string; panel: string; panel2: string; line: string; text: string; muted: string; accent: string; onAccent: string;
  ok: string; warn: string; danger: string; overlay: string; accentSoft: string; okSoft: string; warnSoft: string; dangerSoft: string;
};
export type SaTheme = { id: string; label: string; dark: boolean; eyeFriendly: boolean; color: SaPalette };

export const SA_THEMES: SaTheme[] = [
  { id: 'daylight', label: 'Daylight', dark: false, eyeFriendly: false, color: {
    bg: '#F5F6FA', panel: '#FFFFFF', panel2: '#EBECF1', line: '#D4D5D9', text: '#11162A', muted: '#566079', accent: '#4F46E5',
    onAccent: '#FFFFFF', ok: '#0B7A55', warn: '#8A5200', danger: '#C0243A', overlay: 'rgba(14,18,36,0.46)', accentSoft: '#EDEDFC',
    okSoft: '#E7F2EE', warnSoft: '#F3EEE6', dangerSoft: '#F9E9EB',
  } },
  { id: 'paper', label: 'Paper', dark: false, eyeFriendly: false, color: {
    bg: '#F6F1E7', panel: '#FFFCF5', panel2: '#EDE8DE', line: '#D9D5CD', text: '#2A2118', muted: '#665846', accent: '#9A4A12',
    onAccent: '#FFFFFF', ok: '#18703F', warn: '#8A5200', danger: '#B3261E', overlay: 'rgba(14,18,36,0.46)', accentSoft: '#F5EADE',
    okSoft: '#E8EEE3', warnSoft: '#F3EBDD', dangerSoft: '#F7E7E0',
  } },
  { id: 'mint', label: 'Mint', dark: false, eyeFriendly: false, color: {
    bg: '#EEF6F2', panel: '#FFFFFF', panel2: '#E4EDE9', line: '#D4D9D7', text: '#0F2A22', muted: '#476258', accent: '#0B7A63',
    onAccent: '#FFFFFF', ok: '#14703F', warn: '#855000', danger: '#BE2A3C', overlay: 'rgba(14,18,36,0.46)', accentSoft: '#E7F2EF',
    okSoft: '#E8F1EC', warnSoft: '#F3EEE6', dangerSoft: '#F9EAEC',
  } },
  { id: 'sky', label: 'Sky', dark: false, eyeFriendly: false, color: {
    bg: '#EDF4FB', panel: '#FFFFFF', panel2: '#E3EBF2', line: '#D3D7DB', text: '#0C2238', muted: '#4A6078', accent: '#0B5FC4',
    onAccent: '#FFFFFF', ok: '#0F7650', warn: '#855000', danger: '#C0243A', overlay: 'rgba(14,18,36,0.46)', accentSoft: '#E7EFF9',
    okSoft: '#E7F1EE', warnSoft: '#F3EEE6', dangerSoft: '#F9E9EB',
  } },
  { id: 'rose', label: 'Rose', dark: false, eyeFriendly: false, color: {
    bg: '#FBF1F4', panel: '#FFFFFF', panel2: '#F2E7EA', line: '#D9D4D6', text: '#2B1219', muted: '#6A4A55', accent: '#B0185A',
    onAccent: '#FFFFFF', ok: '#14703F', warn: '#855000', danger: '#B3261E', overlay: 'rgba(14,18,36,0.46)', accentSoft: '#F7E8EF',
    okSoft: '#E8F1EC', warnSoft: '#F3EEE6', dangerSoft: '#F7E9E9',
  } },
  { id: 'contrast-light', label: 'High contrast light', dark: false, eyeFriendly: false, color: {
    bg: '#FFFFFF', panel: '#FFFFFF', panel2: '#F4F4F4', line: '#D1D1D1', text: '#000000', muted: '#3A3A3A', accent: '#0033CC',
    onAccent: '#FFFFFF', ok: '#006B2E', warn: '#7A4800', danger: '#B00020', overlay: 'rgba(14,18,36,0.46)', accentSoft: '#E6EBFA',
    okSoft: '#E6F0EA', warnSoft: '#F2EDE6', dangerSoft: '#F7E6E9',
  } },
  { id: 'midnight', label: 'Midnight', dark: true, eyeFriendly: false, color: {
    bg: '#0E1224', panel: '#161B33', panel2: '#202436', line: '#54586C', text: '#F2F4FF', muted: '#B3BAD6', accent: '#9AA5FF',
    onAccent: '#0B0F26', ok: '#4ADE9A', warn: '#FBBF55', danger: '#FF8A98', overlay: 'rgba(0,0,0,0.66)', accentSoft: '#30375C',
    okSoft: '#204248', warnSoft: '#443C3A', dangerSoft: '#453147',
  } },
  { id: 'graphite', label: 'Graphite', dark: true, eyeFriendly: true, color: {
    bg: '#1C1D1F', panel: '#262729', panel2: '#2D2E2F', line: '#5D5E5F', text: '#ECECEA', muted: '#B4B4B0', accent: '#8FB8FF',
    onAccent: '#0E1A2E', ok: '#7BD9A4', warn: '#E8C070', danger: '#F59A9A', overlay: 'rgba(0,0,0,0.66)', accentSoft: '#3B4454',
    okSoft: '#374B42', warnSoft: '#4D4637', dangerSoft: '#4F3E40',
  } },
  { id: 'forest', label: 'Forest', dark: true, eyeFriendly: true, color: {
    bg: '#14201B', panel: '#1C2B25', panel2: '#25312B', line: '#55625C', text: '#E6EFE8', muted: '#A9BDB0', accent: '#7FD6A4',
    onAccent: '#0C2016', ok: '#8BE0A8', warn: '#E6C170', danger: '#F0A3A3', overlay: 'rgba(0,0,0,0.66)', accentSoft: '#304D3E',
    okSoft: '#324F3F', warnSoft: '#444934', dangerSoft: '#46433E',
  } },
  { id: 'ember', label: 'Ember', dark: true, eyeFriendly: true, color: {
    bg: '#211A14', panel: '#2C231B', panel2: '#322A24', line: '#635A50', text: '#F1E8DA', muted: '#C2B39E', accent: '#F0B35C',
    onAccent: '#2A1700', ok: '#8FD9A0', warn: '#F0C26A', danger: '#F2A0A0', overlay: 'rgba(0,0,0,0.66)', accentSoft: '#534028',
    okSoft: '#404736', warnSoft: '#53432B', dangerSoft: '#543C36',
  } },
  { id: 'ocean', label: 'Ocean', dark: true, eyeFriendly: true, color: {
    bg: '#0F1E26', panel: '#162B36', panel2: '#202F37', line: '#50626B', text: '#E4F1F5', muted: '#A7C0C9', accent: '#6CCBE0',
    onAccent: '#04202A', ok: '#7FDDB0', warn: '#EBC46E', danger: '#F4A2A8', overlay: 'rgba(0,0,0,0.66)', accentSoft: '#274B58',
    okSoft: '#2B4F4E', warnSoft: '#414A41', dangerSoft: '#42434D',
  } },
  { id: 'contrast-dark', label: 'High contrast dark', dark: true, eyeFriendly: false, color: {
    bg: '#000000', panel: '#0A0A0A', panel2: '#141414', line: '#4F4F4F', text: '#FFFFFF', muted: '#D0D0D0', accent: '#FFD60A',
    onAccent: '#000000', ok: '#5CF29A', warn: '#FFC247', danger: '#FF8A8A', overlay: 'rgba(0,0,0,0.66)', accentSoft: '#3B330A',
    okSoft: '#1A3827', warnSoft: '#3B2F16', dangerSoft: '#3B2424',
  } },
];

const KEY = 'sa-theme';
const find = (id: string | null | undefined) => SA_THEMES.find(t => t.id === id);
const stored = (): string | null => { try { return (globalThis as any).localStorage?.getItem(KEY) ?? null; } catch { return null; } };

export const SA = {
  /** Live palette of the active theme (mutated by applySaTheme). Starts as the saved choice, else Daylight. */
  color: { ...(find(stored()) || SA_THEMES[0]).color } as SaPalette,
  /** Id of the active theme. */
  theme: (find(stored()) || SA_THEMES[0]).id,
  radius: { sm: 6, md: 10, lg: 14 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  font: { size: { xs: 11, sm: 13, md: 15, lg: 18, xl: 24 }, weight: { regular: '400', medium: '600', bold: '800' } as const },
  /** System font stack: the console never loads a tenant font. */
  family: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  maxWidth: 1120,
  /** Width from which the navigation becomes a side bar and sheets become centred dialogs. */
  wide: 900,
};

/** Switches the active palette in place and remembers the choice in this browser. Returns false for an unknown id. */
export function applySaTheme(id: string, remember = true): boolean {
  const theme = find(id);
  if (!theme) return false;
  Object.assign(SA.color, theme.color);
  SA.theme = theme.id;
  if (remember) { try { (globalThis as any).localStorage?.setItem(KEY, theme.id); } catch { /* private mode: keep it for this visit only */ } }
  return true;
}
