/* eslint-disable @typescript-eslint/no-require-imports -- Static Metro font assets. */
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Font from 'expo-font';

/** Assets stay bundled for offline/native use, but only requested families are loaded. */
const sources: Record<string, number> = {
  Inter: Platform.OS === 'web' ? require('../../assets/fonts/web/Inter.woff2') : require('../../assets/fonts/Inter.ttf'), Tajawal: Platform.OS === 'web' ? require('../../assets/fonts/web/Tajawal.woff2') : require('../../assets/fonts/Tajawal.ttf'),
  // Tajawal ships one file per weight (the 400 file alone makes browsers fake bold, which looks thin and wide): Txt picks the real weight.
  TajawalMedium: Platform.OS === 'web' ? require('../../assets/fonts/web/TajawalMedium.woff2') : require('../../assets/fonts/TajawalMedium.ttf'),
  TajawalBold: Platform.OS === 'web' ? require('../../assets/fonts/web/TajawalBold.woff2') : require('../../assets/fonts/TajawalBold.ttf'),
  TajawalExtraBold: Platform.OS === 'web' ? require('../../assets/fonts/web/TajawalExtraBold.woff2') : require('../../assets/fonts/TajawalExtraBold.ttf'),
  Roboto: Platform.OS === 'web' ? require('../../assets/fonts/web/Roboto.woff2') : require('../../assets/fonts/Roboto.ttf'), Poppins: Platform.OS === 'web' ? require('../../assets/fonts/web/Poppins.woff2') : require('../../assets/fonts/Poppins.ttf'),
  Montserrat: Platform.OS === 'web' ? require('../../assets/fonts/web/Montserrat.woff2') : require('../../assets/fonts/Montserrat.ttf'), Lato: Platform.OS === 'web' ? require('../../assets/fonts/web/Lato.woff2') : require('../../assets/fonts/Lato.ttf'),
  Cairo: Platform.OS === 'web' ? require('../../assets/fonts/web/Cairo.woff2') : require('../../assets/fonts/Cairo.ttf'), 'IBM Plex Sans Arabic': Platform.OS === 'web' ? require('../../assets/fonts/web/IBMPlexSansArabic.woff2') : require('../../assets/fonts/IBMPlexSansArabic.ttf'),
  'Noto Sans Arabic': Platform.OS === 'web' ? require('../../assets/fonts/web/NotoSansArabic.woff2') : require('../../assets/fonts/NotoSansArabic.ttf'), Alexandria: Platform.OS === 'web' ? require('../../assets/fonts/web/Alexandria.woff2') : require('../../assets/fonts/Alexandria.ttf'),
  Lora: Platform.OS === 'web' ? require('../../assets/fonts/web/Lora.woff2') : require('../../assets/fonts/Lora.ttf'), NotoNaskhArabic: Platform.OS === 'web' ? require('../../assets/fonts/web/NotoNaskhArabic.woff2') : require('../../assets/fonts/NotoNaskhArabic.ttf'),
};
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let revision = 0;
const notify = () => { revision++; listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function ensureFont(family: string): Promise<void> {
  if (!sources[family] || Font.isLoaded(family)) return Promise.resolve();
  const current = pending.get(family);
  if (current) return current;
  const promise = Font.loadAsync(family, { uri: sources[family], display: Font.FontDisplay.SWAP })
    .then(notify).finally(() => { pending.delete(family); });
  pending.set(family, promise);
  return promise;
}
/** Never renders an unloaded font; fixed line heights in specimens keep the fallback stable. */
export function useFontFamily(family?: string, fallback = 'Inter') {
  useSyncExternalStore(subscribe, () => revision, () => 0);
  useEffect(() => { if (family && family !== 'system') ensureFont(family).catch(() => { /* Keep the readable bundled fallback if an asset cannot be loaded. */ }); }, [family]);
  if (family && Font.isLoaded(family)) return family;
  return Font.isLoaded(fallback) ? fallback : undefined;
}
