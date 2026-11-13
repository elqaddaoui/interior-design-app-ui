import React from 'react';
import { StyleSheet, Text, type TextProps } from 'react-native';

import { useStore } from '@/store/useStore';
import { useFontFamily } from '@/lib/fonts';
import { useLang } from '@/i18n';

export const ARABIC_FONTS = ['Tajawal', 'Cairo', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Alexandria'];
export const FRENCH_FONTS = ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Lato'];
export function useAppFont(language?: string) {
  const lang = useLang((s) => s.lang);
  const settings = useStore((s) => s.doc?.settings);
  const font = (language ?? lang) === 'fr' ? settings?.frenchFont : settings?.arabicFont;
  const fallback = (language ?? lang) === 'fr' ? FRENCH_FONTS[0] : ARABIC_FONTS[0];
  return useFontFamily(font && font !== 'system' ? font : fallback, fallback);
}
const HAS_COLOR = /\btext-(fg|muted|primary|onprimary|onink|ink|danger|success|white|black|soft)\b/;
/** Tajawal ships one font file per weight; the single 400 file would make browsers fake bold (thin, wide, dim). */
const WEIGHT_CLASS = /(?:^|\s)font-(medium|semibold|bold|extrabold|black)(?=\s|$)/;
const WEIGHT_NAME: Record<string, string> = { medium: 'TajawalMedium', semibold: 'TajawalBold', bold: 'TajawalBold', extrabold: 'TajawalExtraBold', black: 'TajawalExtraBold' };
const NUMERIC_WEIGHT: Record<string, string> = { '500': 'TajawalMedium', '600': 'TajawalBold', '700': 'TajawalBold', bold: 'TajawalBold', '800': 'TajawalExtraBold', '900': 'TajawalExtraBold' };
function weightFamily(className: string, style: unknown): string | undefined {
  const flat = StyleSheet.flatten(style as never) as { fontWeight?: string | number } | undefined;
  if (flat?.fontWeight != null) return NUMERIC_WEIGHT[String(flat.fontWeight)];
  const m = WEIGHT_CLASS.exec(className);
  return m ? WEIGHT_NAME[m[1]] : undefined;
}
/** Text that defaults to the theme foreground colour. */
export function Txt({ className = '', ...p }: TextProps & { className?: string }) {
  const base = useAppFont(typeof p.children === 'string' && /[\u0600-\u06ff]/.test(p.children) ? 'ar' : undefined);
  const variant = base === 'Tajawal' ? weightFamily(className, p.style) : undefined;
  const real = useFontFamily(variant ?? 'Tajawal', 'Tajawal');
  // The real weight file is declared as weight 400, so the weight style is reset to stop the browser from bolding it a second time.
  const fontFamily = variant && real === variant ? variant : base;
  const style = variant && real === variant ? [{ fontFamily }, p.style, { fontWeight: '400' as const }] : [{ fontFamily }, p.style];
  return <Text {...p} style={style} className={`${HAS_COLOR.test(className) ? '' : 'text-fg '}${className}`} />;
}
