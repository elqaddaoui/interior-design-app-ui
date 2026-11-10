import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, SlideInLeft, SlideInRight } from 'react-native-reanimated';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useBp } from '@/hooks/useBp';
import { LANGS, useLang } from '@/i18n';
import { SUPER_GROUPS } from '@/lib/superRoutes';
import { useSuperAdmin } from '@/store/useSuperAdmin';
import { useStore } from '@/store/useStore';
import { LANG_SHORT } from '@/components/admin/AdminLogin';
import { useSa } from './ui';

const SIDE = 276;

function Menu({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  const { t, rtl } = useSa();
  const router = useRouter();
  const path = usePathname().replace(/\/+$/, '');
  const profile = useSuperAdmin((s) => s.profile);
  const signOut = useSuperAdmin((s) => s.signOut);
  const brand = useStore((s) => s.doc.branding.appName);
  const lang = useLang((s) => s.lang);
  const insets = useSafeAreaInsets();
  return (
    <View testID="sa-menu" className="flex-1 bg-ink" style={{ paddingTop: Math.max(insets.top, 14), paddingBottom: Math.max(insets.bottom, 12) }}>
      <View className="flex-row items-center px-4" style={{ gap: 12, marginBottom: 18 }}>
        <View className="w-10 h-10 rounded-2xl bg-primary items-center justify-center"><Icon name="shield-account-outline" size={22} tone="onprimary" /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt numberOfLines={1} className="text-onink font-black text-[16px]" style={{ letterSpacing: -0.3 }}>{brand}</Txt>
          <Txt className="text-onink text-[10.5px] font-bold uppercase" style={{ letterSpacing: 1.2, opacity: 0.6 }}>{t('tag')}</Txt>
        </View>
        {onClose ? <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={onClose} hitSlop={8}><Icon name="close" size={22} color="#FFFFFF" /></Pressable> : null}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 10, gap: 16 }}>
        {SUPER_GROUPS.map((g) => (
          <View key={g.key} style={{ gap: 2 }}>
            <Txt className="text-onink text-[10.5px] font-extrabold uppercase px-3 mb-1" style={{ letterSpacing: 1.3, opacity: 0.45 }}>{t(`group_${g.key}`)}</Txt>
            {g.items.map((n) => {
              const on = path === n.href || path.startsWith(`${n.href}/`);
              return (
                <Pressable key={n.key} testID={`sa-nav-${n.key}`} accessibilityRole="link" accessibilityState={{ selected: on }} onPress={() => { router.push(n.href as Href); onNavigate?.(); }}
                  className="flex-row items-center rounded-2xl active:opacity-80" style={{ height: 44, paddingHorizontal: 12, gap: 12, backgroundColor: on ? 'rgba(255,255,255,0.12)' : 'transparent' }}>
                  <Icon name={n.icon} size={20} color={on ? '#FFFFFF' : 'rgba(255,255,255,0.65)'} />
                  <Txt numberOfLines={1} className="text-[14px] font-bold flex-1" style={{ color: on ? '#FFFFFF' : 'rgba(255,255,255,0.75)' }}>{t(`nav_${n.key}`)}</Txt>
                  {on ? <View className="w-1.5 h-1.5 rounded-full bg-primary" /> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View className="px-3" style={{ gap: 10, paddingTop: 10 }}>
        <View accessibilityRole="radiogroup" className="flex-row rounded-full p-1" style={{ gap: 2, backgroundColor: 'rgba(255,255,255,0.08)' }}>
          {LANGS.map((l) => (
            <Pressable key={l} testID={`sa-lang-${l}`} accessibilityRole="radio" accessibilityState={{ selected: lang === l }} onPress={() => useLang.getState().set(l)} className="flex-1 rounded-full items-center justify-center" style={{ height: 30, backgroundColor: lang === l ? '#FFFFFF' : 'transparent' }}>
              <Txt className="text-[12px] font-bold" style={{ color: lang === l ? '#111111' : 'rgba(255,255,255,0.8)' }}>{LANG_SHORT[l]}</Txt>
            </Pressable>
          ))}
        </View>
        <Pressable testID="sa-open-admin" accessibilityRole="link" onPress={() => { router.push('/admin' as Href); onNavigate?.(); }} className="flex-row items-center rounded-2xl active:opacity-80" style={{ height: 40, paddingHorizontal: 12, gap: 10 }}>
          <Icon name="open-in-new" size={18} color="rgba(255,255,255,0.65)" flip />
          <Txt className="text-[13px] font-semibold flex-1" style={{ color: 'rgba(255,255,255,0.75)' }}>{t('openAdmin')}</Txt>
        </Pressable>
        <View className="flex-row items-center rounded-2xl" style={{ padding: 10, gap: 10, backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <View className="w-9 h-9 rounded-full bg-primary items-center justify-center"><Txt className="text-onprimary font-black text-[14px]">{(profile?.username || 'S').charAt(0).toUpperCase()}</Txt></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt numberOfLines={1} testID="sa-username" className="text-onink font-bold text-[13px]">{profile?.username}</Txt>
            <Txt className="text-onink text-[11px]" style={{ opacity: 0.55 }}>{t('owner')}</Txt>
          </View>
          <Pressable testID="sa-signout" accessibilityRole="button" accessibilityLabel={t('signOut')} onPress={() => { onNavigate?.(); void signOut(); }} hitSlop={8} className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <Icon name="logout" size={18} color="#FFFFFF" flip />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Frame of every signed-in Super Admin page: a dark sidebar on large screens, a drawer on phones and tablets. */
export function SaShell({ children }: { children: React.ReactNode }) {
  const { desktop } = useBp();
  const { t, rtl } = useSa();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname, desktop]);
  if (desktop) {
    return (
      <View testID="sa-shell" className="flex-1 flex-row bg-bg">
        <View style={{ width: SIDE }}><Menu /></View>
        <View className="flex-1" style={{ minWidth: 0, paddingTop: 16 }}>{children}</View>
      </View>
    );
  }
  return (
    <View testID="sa-shell" className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-3 h-14" style={{ gap: 10 }}>
        <Pressable testID="sa-menu-btn" accessibilityRole="button" accessibilityLabel={t('menu')} onPress={() => setOpen(true)} className="w-10 h-10 rounded-full border border-line bg-surface items-center justify-center"><Icon name="menu" size={21} /></Pressable>
        <View className="w-8 h-8 rounded-xl bg-ink items-center justify-center"><Icon name="shield-account-outline" size={18} tone="onink" /></View>
        <Txt numberOfLines={1} className="font-black text-[17px] flex-1" style={{ letterSpacing: -0.3 }}>{t('tag')}</Txt>
      </View>
      <View className="flex-1" style={{ minHeight: 0 }}>{children}</View>
      {open ? (
        <View testID="sa-drawer" className="absolute inset-0 flex-row" style={{ zIndex: 50 }}>
          <Animated.View entering={(rtl ? SlideInRight : SlideInLeft).duration(240)} className="max-w-[88%]" style={{ width: 300, boxShadow: '0 0 60px rgba(0,0,0,0.3)' } as never}>
            <Menu onClose={() => setOpen(false)} onNavigate={() => setOpen(false)} />
          </Animated.View>
          <Animated.View entering={FadeIn.duration(180)} style={{ flex: 1, backgroundColor: 'rgba(8,10,16,0.55)' }}>
            <Pressable accessibilityLabel={t('close')} onPress={() => setOpen(false)} style={{ flex: 1 }} />
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}
