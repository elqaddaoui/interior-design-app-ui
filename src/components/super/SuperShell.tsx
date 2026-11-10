import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInLeft, SlideInRight, SlideOutLeft, SlideOutRight } from 'react-native-reanimated';
import { usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from '@/hooks/useLeaveGuard';
import { useBp } from '@/hooks/useBp';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { LANGS, useLang, useT } from '@/i18n';
import { useSuper } from '@/store/useSuper';

export const SUPER_NAV = [
  { key: 'dashboard', icon: 'view-dashboard-outline', href: '/super' },
  { key: 'tenants', icon: 'domain', href: '/super/tenants' },
  { key: 'admins', icon: 'account-key-outline', href: '/super/admins' },
  { key: 'roles', icon: 'shield-account-outline', href: '/super/roles' },
  { key: 'access', icon: 'shield-lock-outline', href: '/super/access' },
  { key: 'clients', icon: 'account-group-outline', href: '/super/clients' },
  { key: 'audit', icon: 'history', href: '/super/audit' },
  { key: 'settings', icon: 'cog-outline', href: '/super/settings' },
] as const;
const LANG_SHORT: Record<string, string> = { dar: 'الدارجة', ar: 'العربية', fr: 'Français' };
const isActive = (path: string, href: string) => (href === '/super' ? path === '/super' : path === href || path.startsWith(`${href}/`));

function Menu({ collapsed, fill, onNavigate, onClose, insetTop = 0 }: { collapsed: boolean; fill?: boolean; onNavigate?: () => void; onClose?: () => void; insetTop?: number }) {
  const { t, lang } = useT();
  const router = useRouter();
  const path = usePathname().replace(/\/+$/, '') || '/';
  const username = useSuper((s) => s.username);
  return (
    <View testID="super-menu" className="bg-surface border-e border-line" style={{ width: fill ? '100%' : collapsed ? 76 : 264, flex: fill ? 1 : undefined, paddingTop: insetTop + 12, paddingBottom: 12, paddingHorizontal: 12, gap: 6 }}>
      <View className="flex-row items-center" style={{ gap: 10, paddingHorizontal: 4, marginBottom: 10 }}>
        <View className="w-10 h-10 rounded-2xl bg-ink items-center justify-center"><Icon name="shield-crown-outline" size={22} tone="onink" /></View>
        {!collapsed ? <View style={{ flex: 1, minWidth: 0 }}><Txt numberOfLines={1} className="font-black text-[16px]" style={{ letterSpacing: -0.3 }}>{t('sx.title')}</Txt><Txt numberOfLines={1} className="text-muted text-[11px] font-bold uppercase" style={{ letterSpacing: 1 }}>{t('sx.tag')}</Txt></View> : null}
        {onClose ? <Pressable testID="super-menu-close" accessibilityRole="button" accessibilityLabel={t('sx.shell.close')} onPress={onClose} className="w-9 h-9 rounded-full items-center justify-center active:bg-surface2"><Icon name="close" size={21} /></Pressable> : null}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 4 }} showsVerticalScrollIndicator={false}>
        {SUPER_NAV.map((n) => {
          const on = isActive(path, n.href);
          return (
            <Pressable key={n.key} testID={`super-nav-${n.key}`} accessibilityRole="link" accessibilityState={{ selected: on }} accessibilityLabel={t(`sx.nav.${n.key}`)} onPress={() => { onNavigate?.(); router.push(n.href as Href); }}
              className={`flex-row items-center rounded-2xl ${on ? 'bg-ink' : 'active:bg-surface2'}`} style={{ height: 46, paddingHorizontal: 12, gap: 12, justifyContent: collapsed ? 'center' : 'flex-start' }}>
              <Icon name={n.icon} size={20} tone={on ? 'onink' : 'fg'} />
              {!collapsed ? <Txt numberOfLines={1} className={`text-[14px] flex-1 ${on ? 'font-extrabold text-onink' : 'font-semibold'}`}>{t(`sx.nav.${n.key}`)}</Txt> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {!collapsed ? (
        <View accessibilityRole="radiogroup" className="flex-row bg-surface2 rounded-full p-0.5" style={{ gap: 2 }}>
          {LANGS.map((l) => (
            <Pressable key={l} testID={`super-menu-lang-${l}`} accessibilityRole="radio" accessibilityState={{ selected: lang === l }} onPress={() => useLang.getState().set(l)} className={`flex-1 h-8 rounded-full items-center justify-center ${lang === l ? 'bg-ink' : ''}`}>
              <Txt className={`text-[11px] font-bold ${lang === l ? 'text-onink' : 'text-muted'}`}>{LANG_SHORT[l]}</Txt>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View className="border-t border-line" style={{ paddingTop: 10, gap: 4 }}>
        <Pressable testID="super-open-app" accessibilityRole="link" accessibilityLabel={t('sx.shell.openApp')} onPress={() => { onNavigate?.(); router.push('/'); }} className="flex-row items-center rounded-2xl active:bg-surface2" style={{ height: 40, paddingHorizontal: 12, gap: 12, justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <Icon name="open-in-new" size={18} tone="muted" />{!collapsed ? <Txt className="text-muted font-semibold text-[13px]">{t('sx.shell.openApp')}</Txt> : null}
        </Pressable>
        <Pressable testID="super-logout" accessibilityRole="button" accessibilityLabel={t('sx.shell.logout')} onPress={() => { onNavigate?.(); void useSuper.getState().logout(); }} className="flex-row items-center rounded-2xl active:bg-surface2" style={{ height: 44, paddingHorizontal: 12, gap: 12, justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <Icon name="logout" size={19} tone="danger" />
          {!collapsed ? <View style={{ flex: 1, minWidth: 0 }}><Txt className="font-bold text-[13px] text-danger">{t('sx.shell.logout')}</Txt><Txt numberOfLines={1} className="text-muted text-[11px]">{username}</Txt></View> : null}
        </Pressable>
      </View>
    </View>
  );
}

export function SuperShell({ children }: { children: React.ReactNode }) {
  const { desktop } = useBp();
  const { t, rtl } = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const warn = useSuper((s) => s.defaultCredentials);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname, desktop]);
  useEffect(() => { void useSuper.getState().loadCatalog(); }, []);
  const reduced = Platform.OS === 'web' && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const banner = warn ? (
    <Pressable testID="super-default-warning" accessibilityRole="alert" onPress={() => router.push('/super/settings' as Href)} className="flex-row items-center bg-danger/15" style={{ gap: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
      <Icon name="alert-outline" size={18} tone="danger" /><Txt className="flex-1 text-[12px] font-bold text-danger">{t('sx.shell.defaultWarn')}</Txt>
      <View className="rounded-full bg-danger px-3 h-7 items-center justify-center"><Txt className="text-white text-[12px] font-extrabold">{t('sx.shell.changeNow')}</Txt></View>
    </Pressable>
  ) : null;

  if (desktop) {
    return (
      <View className="flex-1 flex-row bg-bg">
        <Menu collapsed={collapsed} insetTop={insets.top} />
        <View className="flex-1" style={{ minWidth: 0 }}>
          {banner}
          <View className="flex-row items-center px-4 h-14">
            <Pressable testID="super-collapse" accessibilityRole="button" accessibilityState={{ expanded: !collapsed }} accessibilityLabel={collapsed ? t('sx.shell.expand') : t('sx.shell.collapse')} onPress={() => setCollapsed((c) => !c)} className="w-10 h-10 rounded-full border border-line bg-surface items-center justify-center"><Icon name={collapsed ? 'dock-left' : 'menu-open'} size={21} flip /></Pressable>
          </View>
          <View className="flex-1" style={{ minHeight: 0 }}>{children}</View>
        </View>
      </View>
    );
  }
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {banner}
      <View className="flex-row items-center px-3 h-14 gap-2">
        <Pressable testID="super-menu-btn" accessibilityRole="button" accessibilityLabel={t('sx.shell.menu')} onPress={() => setOpen(true)} className="w-10 h-10 rounded-full border border-line bg-surface items-center justify-center"><Icon name="menu" size={21} /></Pressable>
        <Txt numberOfLines={1} className="font-black text-[17px] flex-1" style={{ letterSpacing: -0.3 }}>{t('sx.title')}</Txt>
      </View>
      <View className="flex-1" style={{ minHeight: 0 }}>{children}</View>
      {open ? (
        <View testID="super-drawer" className="absolute inset-0 flex-row" style={{ zIndex: 50 }}>
          <Animated.View entering={reduced ? undefined : (rtl ? SlideInRight : SlideInLeft).duration(240)} exiting={reduced ? undefined : (rtl ? SlideOutRight : SlideOutLeft).duration(180)} className="max-w-[88%]" style={{ width: 300, boxShadow: '0 0 60px rgba(0,0,0,0.3)' } as any}>
            <Menu fill collapsed={false} insetTop={insets.top} onClose={() => setOpen(false)} onNavigate={() => setOpen(false)} />
          </Animated.View>
          <Animated.View entering={reduced ? undefined : FadeIn.duration(180)} exiting={reduced ? undefined : FadeOut.duration(140)} style={{ flex: 1, backgroundColor: 'rgba(8,10,16,0.55)' }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('sx.shell.close')} onPress={() => setOpen(false)} style={{ flex: 1 }} />
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}
