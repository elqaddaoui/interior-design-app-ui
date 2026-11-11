import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { NavigationBar } from 'expo-navigation-bar';
import { useTheme } from '@/theme/ThemeProvider';
import { luminance } from '@/theme/color';
import { storagePrefix } from '@/lib/tenant';

/**
 * Status bar + Android navigation bar follow the app background chosen by the admin (theme stored in the database),
 * instead of the fixed brand yellow from the native splash configuration.
 *  - Android app (edge-to-edge): the bars are transparent, so the root view colour shows through behind them;
 *    the icons switch light/dark to stay readable.
 *  - Web / installed PWA: `<meta name="theme-color">` colours the browser / standalone status bar.
 */
export function SystemBars() {
  const { colors, dark } = useTheme();
  // Icon contrast comes from the real background colour the admin chose (not only the theme's dark flag).
  const lightIcons = (() => { try { return luminance(colors.bg) < 0.5; } catch { return dark; } })();
  useEffect(() => {
    const apply = () => {
      void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
      if (Platform.OS === 'android') { try { NavigationBar.setStyle(lightIcons ? 'light' : 'dark'); } catch { /* older Android: keep default */ } }
    };
    apply();
    // Android can reset the bar style when the app returns from the background or after a system theme change.
    const sub = Platform.OS === 'android' ? AppState.addEventListener('change', state => { if (state === 'active') apply(); }) : null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
      if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
      meta.content = colors.bg;
      try { localStorage.setItem(`${storagePrefix()}bar-color`, colors.bg); } catch { /* private mode */ }
    }
    return () => sub?.remove();
  }, [colors.bg, lightIcons]);
  return null;
}
