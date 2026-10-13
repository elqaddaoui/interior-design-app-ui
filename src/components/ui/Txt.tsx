import React from 'react';
import { Text, type TextProps } from 'react-native';

import { useStore } from '@/store/useStore';
import { useLang } from '@/i18n';

export const ARABIC_FONTS = ['Tajawal', 'Cairo', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Alexandria'];
export const FRENCH_FONTS = ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Lato'];
export function useAppFont(language?: string) {
  const lang = useLang((s) => s.lang);
  const settings = useStore((s) => s.doc?.settings);
  const font = (language ?? lang) === 'fr' ? settings?.frenchFont : settings?.arabicFont;
  return font && font !== 'system' ? font : undefined;
}
const HAS_COLOR = /\btext-(fg|muted|primary|onprimary|onink|ink|danger|success|white|black|soft)\b/;
/** Text that defaults to the theme foreground colour. */
export function Txt({ className = '', ...p }: TextProps & { className?: string }) {
  const fontFamily = useAppFont(typeof p.children === 'string' && /[\u0600-\u06ff]/.test(p.children) ? 'ar' : undefined);
  return <Text {...p} style={[{ fontFamily }, p.style]} className={`${HAS_COLOR.test(className) ? '' : 'text-fg '}${className}`} />;
}
