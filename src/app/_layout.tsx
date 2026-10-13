import '../global.css';
import '@/lib/interop';
import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useStore } from '@/store/useStore';
import { useLocal } from '@/store/useLocal';
import { initLang, useLang, isRtl } from '@/i18n';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { UnsavedChangesHost } from '@/hooks/useLeaveGuard';
import { ToastHost } from '@/components/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Tajawal: require('../../assets/fonts/Tajawal.ttf'),
    NotoNaskhArabic: require('../../assets/fonts/NotoNaskhArabic.ttf'),
    Inter: require('../../assets/fonts/Inter.ttf'),
    Lora: require('../../assets/fonts/Lora.ttf'),
    Roboto: require('../../assets/fonts/Roboto.ttf'),
    Poppins: require('../../assets/fonts/Poppins.ttf'),
    Montserrat: require('../../assets/fonts/Montserrat.ttf'),
    Lato: require('../../assets/fonts/Lato.ttf'),
    Cairo: require('../../assets/fonts/Cairo.ttf'),
    'IBM Plex Sans Arabic': require('../../assets/fonts/IBMPlexSansArabic.ttf'),
    'Noto Sans Arabic': require('../../assets/fonts/NotoSansArabic.ttf'),
    Alexandria: require('../../assets/fonts/Alexandria.ttf'),
  });
  const ready = useStore((s) => s.ready);
  const loaded = useLocal((s) => s.loaded);
  const lang = useLang((s) => s.lang);

  useEffect(() => {
    (async () => {
      await Promise.all([initLang(), useLocal.getState().load(), useStore.getState().init()]);
      SplashScreen.hideAsync().catch(() => {});
    })();
  }, []);

  const ok = ready && loaded && (fontsLoaded || !!fontError);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          {/* `direction` flips every flex-row on native + web: Darija/Arabic = RTL, French = LTR. */}
          <View style={{ flex: 1, direction: isRtl(lang) ? 'rtl' : 'ltr' } as any} key={lang}>
            {ok ? (
              <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: 'transparent' } }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="pro" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              </Stack>
            ) : (
              <View className="flex-1 items-center justify-center bg-bg"><ActivityIndicator /></View>
            )}
            <ToastHost />
            <UnsavedChangesHost />
          </View>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
