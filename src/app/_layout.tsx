import '../global.css';
import '@/lib/interop';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Slot, Stack, usePathname } from 'expo-router';
import { GestureRoot } from '@/components/GestureRoot';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ensureFont } from '@/lib/fonts';
import { loadIcons } from '@/components/ui/Icon';
import * as SplashScreen from 'expo-splash-screen';
import { useStore } from '@/store/useStore';
import { useUserSession } from '@/store/useUserSession';
import { useLocal } from '@/store/useLocal';
import { initLang, useLang, isRtl } from '@/i18n';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { UnsavedChangesHost } from '@/hooks/useLeaveGuard';
import { AppExitHost } from '@/components/AppExitHost';
import { PushNavigationHost } from '@/components/PushNavigationHost';
import { GlobalSearch } from '@/components/GlobalSearch';
import { ToastHost } from '@/components/ui/Toast';
import { startPreferenceBindings, startSync } from '@/lib/sync';
import { setCurrentPath } from '@/lib/route';
import { backendEnabled } from '@/lib/backend';
import { prefetchContent, primeContent } from '@/data/repositories/remoteContent';
import { boot, loaderConfig } from '@/lib/boot';
import { resolveTokens } from '@/theme/tokens';
import { BootOverlay } from '@/components/BootOverlay';
import { defaultSettings, defaultTheme } from '@/data/mock/seed';
import { isSuperAdminPath } from '@/superadmin/paths';
import { applyStoreIdentity } from '@/lib/brand/export';

SplashScreen.preventAutoHideAsync().catch(() => {});
// The Super Admin console (/super-admin) is not a tenant: it never loads tenant content, theme, loader or branding.
const ON_CONSOLE = typeof window !== 'undefined' && isSuperAdminPath(window.location.pathname);
// Native / dev: until the real settings arrive the React loader uses the defaults (web production uses index.html's loader).
if (!ON_CONSOLE) { const tokens = resolveTokens(defaultTheme()); boot.preset(loaderConfig(defaultSettings(), tokens)); }
// Public content does not depend on who is signed in: download it now, not after the session answers.
if (backendEnabled && !ON_CONSOLE) prefetchContent();

/** Startup reads are retried a few times with a short pause; after that the app opens anyway and the sync loop keeps checking. */
const INIT_ATTEMPTS = 4;
const INIT_DELAY_MS = 800;
/** A font still missing after this long never holds the first paint: text swaps to it when it arrives (font-display: swap). */
const FONT_WAIT_MS = 400;
async function initWithRetry() {
  for (let attempt = 0; attempt < INIT_ATTEMPTS; attempt++) {
    try { await useStore.getState().init(); return true; }
    catch (error) { useStore.setState({ contentError: (error as { code?: string; message?: string })?.code || (error as Error)?.message || 'UNKNOWN' }); if (attempt < INIT_ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, INIT_DELAY_MS * (attempt + 1))); }
  }
  return false;
}
/** Background retries after the startup attempts gave up: 3 s, 6 s, 9 s ... up to 30 s, until the content is loaded. */
let retrying = false;
async function keepRetryingContent() {
  if (retrying) return;
  retrying = true;
  try {
    for (let i = 1; useStore.getState().contentFailed; i++) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 3000 * i)));
      if (!useStore.getState().contentFailed) break;
      try { await useStore.getState().reloadContent(); } catch { /* still down: next round */ }
    }
  } finally { retrying = false; }
}
const withTimeout = (work: Promise<unknown>, ms: number) => Promise.race([work.catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))]);

/** The console's own root: no tenant theme, store, loader, fonts, sync or push. Its look comes from src/superadmin/tokens.ts only. */
function ConsoleRoot() {
  useEffect(() => {
    // The HTML shell's tenant loader would otherwise stay up until its safety timer.
    (globalThis as { __dwiraBoot?: { hide?: () => void } }).__dwiraBoot?.hide?.();
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  return <View style={{ flex: 1 }}><Slot /></View>;
}

export default function RootLayout() {
  const path = usePathname();
  // `ON_CONSOLE` is fixed for the page's lifetime (the console is its own page load), so the hook order below never changes.
  return ON_CONSOLE || isSuperAdminPath(path) ? <ConsoleRoot /> : <TenantRoot />;
}

function TenantRoot() {
  const initialPath = usePathname();
  setCurrentPath(initialPath);
  const [shown, setShown] = useState(false);
  // True once startup reads finished, or gave up after the bounded retries (the sync loop keeps trying afterwards).
  const [settled, setSettled] = useState(false);
  const contentReady = useStore((s) => s.contentReady);
  const loaded = useLocal((s) => s.loaded);
  const lang = useLang((s) => s.lang);
  const home = initialPath === '/' || initialPath === '';

  useEffect(() => {
    void ensureFont('Lora').catch(() => {});
    void loadIcons().catch(() => {});
    (async () => {
      // Device-only reads (storage): no network.
      await Promise.all([initLang(), useLocal.getState().load()]);
      if (backendEnabled) {
        // Cached / HTML-shell copy of the public content, if any: real content on the very first frame.
        try { if (await primeContent()) await useStore.getState().applyContent(); } catch { /* no cached copy: placeholders */ }
      }
      // Everything below runs in parallel and none of it waits for the others: public content (what pages are built from), the
      // session, and the person's own data. Home never waits at all; other pages wait only for the public content.
      void (async () => {
        const content = (async () => {
          const done = await initWithRetry();
          if (!done) {
            // The API never answered: say so (Home shows "cannot connect" + Retry, not a false "no tools") and keep trying in the
            // background with a growing pause until the real content arrives. The sync loop and the Retry button also clear it.
            useStore.setState({ contentReady: true, contentFailed: true });
            void keepRetryingContent();
          }
          setSettled(true);
        })();
        // The person's own data needs the session first, but that chain no longer sits in front of the content download.
        const personal = (async () => {
          await useUserSession.getState().refresh();
          await useStore.getState().loadPersonal();
        })();
        await Promise.allSettled([content, personal]);
      })();
      const settings = useStore.getState().doc.settings;
      const family = useLang.getState().lang === 'fr' ? settings.frenchFont || 'Inter' : settings.arabicFont || 'Tajawal';
      await withTimeout(Promise.all([ensureFont(family), ensureFont(useStore.getState().doc.branding.logoFont || 'Inter'), ...(family === 'Tajawal' ? [ensureFont('TajawalBold')] : []), ...(initialPath.startsWith('/admin') ? [ensureFont(settings.arabicFont || 'Tajawal'), ensureFont(settings.frenchFont || 'Inter'), ensureFont('TajawalBold'), ensureFont('TajawalExtraBold'), ensureFont('TajawalMedium')] : [])]), FONT_WAIT_MS);
      setShown(true);
      SplashScreen.hideAsync().catch(() => {});
    })();
  // Startup route is captured once; later navigation must never restart initialization.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Home never waits for the network. Every other page waits only for the public content (cached copy, HTML-shell download or
  // network); the person's own data (history, chats, requests, clients) fills in afterwards behind skeletons inside the page.
  const ok = shown && loaded && (home || contentReady || settled);
  // Startup loader (admin: Interface > Loading screen): follows the saved settings and theme, and learns when the first screen is up.
  const settings = useStore((s) => s.doc.settings);
  const theme = useStore((s) => s.doc.theme);
  useEffect(() => {
    if (!contentReady) return;
    const tokens = resolveTokens(theme);
    boot.configure(loaderConfig(settings, tokens));
  }, [contentReady, settings, theme]);
  useEffect(() => { if (ok) boot.shown(home); }, [ok, home]);
  // Each store shows its own name and favicon in the browser tab (set from its published branding).
  const brandName = useStore((s) => s.doc.branding.appName);
  const brandIcon = useStore((s) => s.doc.branding.favicon);
  useEffect(() => { if (contentReady) applyStoreIdentity({ appName: brandName, favicon: brandIcon }); }, [contentReady, brandName, brandIcon]);
  // Real-time sync + database-backed preferences start as soon as the first screen is up.
  useEffect(() => {
    if (!ok) return;
    const stopPrefs = startPreferenceBindings();
    const stopSync = startSync();
    return () => { stopSync(); stopPrefs(); };
  }, [ok]);
  return (
    <GestureRoot style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          {/* `direction` flips every flex-row on native + web: Darija/Arabic = RTL, French = LTR. */}
          <View style={{ flex: 1, direction: isRtl(lang) ? 'rtl' : 'ltr' } as any}>
            {ok ? (
              <>
              <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: 'transparent' } }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="pro" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              </Stack>
              <GlobalSearch />
              <AppExitHost />
              <PushNavigationHost />
              </>
            ) : null}
            {/* Deep links to screens built from signed-in data wait behind a plain background; the loader (if enabled) covers it. */}
            {!ok ? <View pointerEvents="auto" className="absolute inset-0 bg-bg" /> : null}
            <BootOverlay />
            <ToastHost />
            <UnsavedChangesHost />
          </View>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureRoot>
  );
}
