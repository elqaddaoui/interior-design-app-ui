/**
 * Language of the Super Admin console. Its OWN small translator on purpose (the console never imports the tenant's i18n, store or
 * theme: see scripts/check-superadmin-isolation.js). English is the source text; Français, العربية and الدارجة are looked up in texts.ts.
 * The choice is kept in this browser only (localStorage key `sa-lang`), exactly like the console theme.
 * Like `SA.color`, the active language is module state: changing it remounts the console (see Shell.tsx), so every `tr()` call reads the new one.
 */
import { TEXTS } from './texts';

export type SaLang = 'en' | 'fr' | 'ar' | 'dar';
/** Each language is named in its own language. */
export const SA_LANGS: { id: SaLang; label: string }[] = [
  { id: 'en', label: 'English' }, { id: 'fr', label: 'Français' }, { id: 'ar', label: 'العربية' }, { id: 'dar', label: 'الدارجة' },
];
const KEY = 'sa-lang';
const COLUMN = { fr: 0, ar: 1, dar: 2 } as const;
const valid = (id: string | null | undefined): id is SaLang => SA_LANGS.some(l => l.id === id);
const stored = (): string | null => { try { return (globalThis as any).localStorage?.getItem(KEY) ?? null; } catch { return null; } };

let current: SaLang = (valid(stored()) ? stored() : 'en') as SaLang;

export const saLang = () => current;
export const isSaRtl = (lang: SaLang = current) => lang === 'ar' || lang === 'dar';

/** Translates a console text. `{name}` placeholders are filled from `vars`. Unknown text (store names, e-mails...) is returned as it is. */
export function tr(text: string, vars?: Record<string, string | number>): string {
  let out = text;
  if (current !== 'en') {
    const row = TEXTS[text.trim()];
    if (row) out = row[COLUMN[current]];
  }
  return vars ? out.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole)) : out;
}

/** Page direction and language for the browser (modals live outside the app's root view, so the document carries it). */
export function applyDocumentLang(lang: SaLang = current) {
  const doc = (globalThis as any).document;
  if (!doc?.documentElement) return;
  doc.documentElement.lang = lang === 'dar' ? 'ar-MA' : lang;
  doc.documentElement.dir = isSaRtl(lang) ? 'rtl' : 'ltr';
}

/** Switches the active language in place and remembers it in this browser. Returns false for an unknown id. */
export function applySaLang(id: string, remember = true): boolean {
  if (!valid(id)) return false;
  current = id;
  applyDocumentLang(id);
  if (remember) { try { (globalThis as any).localStorage?.setItem(KEY, id); } catch { /* private mode: keep it for this visit only */ } }
  return true;
}
