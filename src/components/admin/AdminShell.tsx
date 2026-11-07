import React, { useEffect } from 'react';
import { Platform, Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInLeft, SlideInRight, SlideOutLeft, SlideOutRight } from 'react-native-reanimated';
import { Href, useGlobalSearchParams, usePathname } from 'expo-router';
import { useRouter, requestLeave, useBackCheckpoint, useNativeOverlayBack } from '@/hooks/useLeaveGuard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { backendEnabled, backendLogout } from '@/lib/backend';
import { useLocal } from '@/store/useLocal';
import { usePrefs } from '@/store/usePrefs';
import { releaseDevice } from '@/lib/notifications';
import { useStore } from '@/store/useStore';
import { useAdminMenu } from '@/store/useAdminMenu';
import { RememberScroll, useViewState } from '@/hooks/useViewState';
import { useSearchObstacle } from '@/hooks/useSearchInset';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { useHistoryShortcuts } from '@/hooks/useHistoryShortcuts';
import { AdminMenu } from '@/components/admin/AdminMenu';
import { HistoryButtons } from '@/components/admin/HistoryButtons';
import type { AdminMenuDesign } from '@/data/types';

export { ADMIN_NAV } from '@/lib/adminNav';

/** Motion of the menu: the admin's setting, switched off by the system's "reduce motion". */
function useMenuMotion() {
  const on = useStore((s) => s.doc.settings.adminMenuAnim) !== false;
  const reduced = Platform.OS === 'web' && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return on && !reduced;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { desktop } = useBp();
  const { t, rtl } = useT();
  const router = useRouter();
  const pathname = usePathname();
  // Startup already reads the admin lists in the background; this only covers an admin who signed in after startup.
  useEffect(() => { if (backendEnabled && !useStore.getState().adminLoaded) void useStore.getState().loadAdminData(); }, []);
  useEffect(() => { void useAdminMenu.getState().load(); }, []);
  useHistoryShortcuts();
  const { target, focus } = useGlobalSearchParams<{ target?: string; focus?: string }>();
  const insets = useSafeAreaInsets();
  const name = useStore((s) => s.doc.branding.appName);
  const design = (useStore((s) => s.doc.settings.adminMenuDesign) ?? 'glide') as AdminMenuDesign;
  const anim = useMenuMotion();
  const pending = useStore((s) => s.requests.filter((r) => r.status === 'pending').length);
  const collapsed = useAdminMenu((s) => s.collapsed);
  const setCollapsed = useAdminMenu((s) => s.setCollapsed);
  const [open, setOpen] = useViewState('drawer-open', false); // phone drawer overlay
  useEffect(() => {
    const menuTarget = typeof target === 'string' && target.startsWith('menu-');
    setOpen(menuTarget && !desktop);
    if (menuTarget && desktop) setCollapsed(false);
  }, [pathname, focus, target, desktop, setOpen, setCollapsed]);
  useBackCheckpoint(open, () => setOpen(false), 1);
  useNativeOverlayBack(open, () => setOpen(false));
  const settingsDraft = useDraftDoc('settings');
  const measureDraft = useSearchObstacle(settingsDraft.dirty);

  const go = (href: string) => router.push(href as Href);
  const logout = () => requestLeave(() => {
    // Stop this device's admin notifications before the session is revoked, then leave the panel.
    void releaseDevice('admin').catch(() => {}).then(() => backendLogout()).catch(() => {});
    usePrefs.getState().clear('admin');
    useLocal.getState().set({ adminSession: false });
  });
  const draftBar = settingsDraft.dirty ? (
    <View onLayout={measureDraft} testID="admin-draft-bar" className="bg-soft border-t border-line px-3 py-2 flex-row flex-wrap items-center" style={{ gap: 8, rowGap: 6 }}>
      <View className="flex-row items-center flex-1" style={{ gap: 8, minWidth: 150 }}>
        <View className="w-2 h-2 rounded-full bg-danger" />
        <Txt numberOfLines={2} className="flex-1 text-[12px] font-semibold">{t('improve.previewLabel')}</Txt>
      </View>
      <HistoryButtons prefix="admin" />
      <Button size="sm" variant="soft" title={t('improve.discard')} onPress={settingsDraft.discard} />
      <Button testID="admin-draft-submit" size="sm" title={t('improve.submit')} onPress={settingsDraft.save} />
    </View>
  ) : null;

  const Bell = () => (
    <Pressable testID="admin-bell" accessibilityLabel={t('dx.shell.pending')} onPress={() => go('/admin/requests')} className="w-10 h-10 rounded-full border border-line bg-surface items-center justify-center">
      <Icon name="bell-outline" size={20} />
      {pending > 0 ? <View className="absolute -top-1 -end-1 bg-danger rounded-full min-w-[18px] h-[18px] px-1 items-center justify-center"><Txt className="text-white text-[10px] font-extrabold">{pending > 99 ? '99+' : pending}</Txt></View> : null}
    </Pressable>
  );

  if (desktop) {
    return (
      <View className="flex-1 flex-row bg-bg">
        <AdminMenu collapsed={collapsed} design={design} anim={anim} insetTop={insets.top} onLogout={logout} />
        <View className="flex-1">
          <View className="flex-row items-center px-4 h-14 gap-2">
            <Pressable testID="admin-collapse" accessibilityRole="button" accessibilityState={{ expanded: !collapsed }} accessibilityLabel={collapsed ? t('admin.menu.expand') : t('admin.menu.collapse')} {...(Platform.OS === 'web' ? ({ title: collapsed ? t('admin.menu.expand') : t('admin.menu.collapse') } as object) : {})}
              onPress={() => setCollapsed((c) => !c)} className="w-10 h-10 rounded-full border border-line bg-surface items-center justify-center"><Icon name={collapsed ? 'dock-left' : 'menu-open'} size={21} flip /></Pressable>
            <View className="flex-1" />
            {Bell()}
          </View>
          {children}{draftBar}
        </View>
      </View>
    );
  }
  const enter = (a: typeof SlideInLeft) => (anim ? a.duration(260) : undefined);
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-3 h-14 gap-2 bg-bg">
        <Pressable testID="admin-menu-btn" accessibilityLabel={t('admin.menu.open')} onPress={() => setOpen(true)} className="w-10 h-10 rounded-full border border-line bg-surface items-center justify-center"><Icon name="menu" size={21} /></Pressable>
        <Txt numberOfLines={1} className="font-black text-[17px] flex-1" style={{ letterSpacing: -0.3 }}>{name} · {t('admin.title')}</Txt>
        {Bell()}
      </View>
      <View className="flex-1">{children}{draftBar}</View>
      {open ? (
        <View testID="admin-drawer" className="absolute inset-0 flex-row" style={{ zIndex: 50 }}>
          <Animated.View entering={enter(rtl ? SlideInRight : SlideInLeft)} exiting={anim ? (rtl ? SlideOutRight : SlideOutLeft).duration(200) : undefined} className="max-w-[88%]" style={{ width: 300, boxShadow: '0 0 60px rgba(0,0,0,0.3)' } as any}>
            <AdminMenu fill collapsed={false} design={design} anim={anim} insetTop={insets.top} onClose={() => setOpen(false)} onNavigate={() => setOpen(false)} onLogout={() => { setOpen(false); logout(); }} />
          </Animated.View>
          <Animated.View entering={anim ? FadeIn.duration(200) : undefined} exiting={anim ? FadeOut.duration(160) : undefined} style={{ flex: 1, backgroundColor: 'rgba(8,10,16,0.55)' }}>
            <Pressable accessibilityLabel={t('admin.menu.close')} onPress={() => setOpen(false)} style={{ flex: 1 }} />
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}

/** Standard admin page: title row + scrollable, width-limited body. */
export function AdminPage({ title, right, children, max = 1100, floating }: { title: string; right?: React.ReactNode; children: React.ReactNode; max?: number; floating?: React.ReactNode }) {
  const { tablet } = useBp();
  const measureFloating = useSearchObstacle(!!floating, 20);
  const router = useRouter();
  const { t } = useT();
  return (
    <View style={{ flex: 1, minHeight: 0 }}><RememberScroll contentContainerStyle={{ padding: tablet ? 24 : 14, paddingTop: tablet ? 8 : 6, paddingBottom: floating ? 160 : 88 }}>
      <View style={{ width: '100%', maxWidth: max, alignSelf: 'center' }}>
        <View className="flex-row flex-wrap items-center justify-between mb-4 gap-2.5">
          <Pressable testID="admin-back" accessibilityLabel={t('improve.back')} onPress={() => router.back()} className="w-10 h-10 rounded-full items-center justify-center active:bg-surface2"><Icon name="chevron-left" size={24} flip /></Pressable>
          <Txt className="text-[26px] leading-[32px] font-black flex-1" accessibilityRole="header" style={{ minWidth: 80, flexBasis: 120, letterSpacing: -0.6 }}>{title}</Txt>
          {right}
        </View>
        {children}
      </View>
    </RememberScroll>{floating ? <View onLayout={measureFloating} style={{ position: 'absolute', bottom: 20, left: 12, right: 12, maxWidth: 700, alignSelf: 'center', marginHorizontal: 'auto', zIndex: 10 } as any}>{floating}</View> : null}</View>
  );
}
