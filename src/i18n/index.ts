import { default as i18n } from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { create } from 'zustand';
import * as Localization from 'expo-localization';
import { storage } from '@/data/mock/storage';
import type { Lang, LText } from '@/data/types';
import { pushTexts } from './locales/push';
import { improvements } from './locales/improvements';
import { inboxTexts } from './locales/inbox';
import { campaignTexts } from './locales/campaigns';
import { toolCardTexts } from './locales/toolcards';
import { adminxTexts } from './locales/adminx';
import fr from './locales/fr';
import ar from './locales/ar';
import dar from './locales/dar';

export const LANGS: Lang[] = ['dar', 'ar', 'fr'];
export const isRtl = (l: Lang) => l === 'dar' || l === 'ar';

i18n.use(initReactI18next).init({
  resources: { fr: { translation: { ...fr, admin: fr.admin, improve: improvements.fr, push: pushTexts.fr, inbox: inboxTexts.fr, camp: campaignTexts.fr, tc: toolCardTexts.fr, ax: adminxTexts.fr } }, ar: { translation: { ...ar, admin: ar.admin, improve: improvements.ar, push: pushTexts.ar, inbox: inboxTexts.ar, camp: campaignTexts.ar, tc: toolCardTexts.ar, ax: adminxTexts.ar } }, dar: { translation: { ...dar, admin: dar.admin, improve: improvements.dar, push: pushTexts.dar, inbox: inboxTexts.dar, camp: campaignTexts.dar, tc: toolCardTexts.dar, ax: adminxTexts.dar } } },
  lng: 'dar',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
  returnObjects: true,
  compatibilityJSON: 'v4',
});

const langListeners = new Set<(l: Lang) => void>();
/** Lets the preference layer persist user-chosen languages without a circular import. */
export const onLangChosen = (fn: (l: Lang) => void) => { langListeners.add(fn); return () => { langListeners.delete(fn); }; };

/** `persist` is false when the language came from the database (no write-back). */
interface LangState { lang: Lang; set(l: Lang, persist?: boolean): void }
export const useLang = create<LangState>((set) => ({
  lang: 'dar',
  set(l, persist = true) {
    i18n.changeLanguage(l);
    applyDocDir(l);
    // Device fallback for visitors who are not signed in; signed-in people also get it saved in the database.
    storage.write('lang', l);
    set({ lang: l });
    if (persist) langListeners.forEach(fn => fn(l));
  },
}));

function applyDocDir(l: Lang) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.dir = isRtl(l) ? 'rtl' : 'ltr';
    document.documentElement.lang = l === 'dar' ? 'ar-MA' : l;
  }
}

/** Load the saved language (default: Darija). */
export async function initLang() {
  const saved = await storage.read<Lang>('lang');
  const l = saved ?? 'dar';
  i18n.changeLanguage(l);
  applyDocDir(l);
  useLang.setState({ lang: l });
  void Localization;
}

/** Translate UI strings: t('common.save'). */
export function useT() {
  const { t } = useTranslation();
  const lang = useLang((s) => s.lang);
  return { t: t as (k: string, o?: Record<string, unknown>) => string, lang, rtl: isRtl(lang) };
}
export const tArr = (t: ReturnType<typeof useT>['t'], key: string): string[] => {
  const v = t(key, { returnObjects: true }) as unknown;
  return Array.isArray(v) ? (v as string[]) : [];
};

/** Pick the current-language value of an admin-edited multilingual field. */
export function useL() {
  const lang = useLang((s) => s.lang);
  return (v?: LText) => (v ? v[lang] || v.fr || v.ar || v.dar || '' : '');
}
export default i18n;
