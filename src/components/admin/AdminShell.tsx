import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
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
import { RememberScroll, SearchTarget, useViewState } from '@/hooks/useViewState';
import { useSearchObstacle } from '@/hooks/useSearchInset';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import type { AdminNavMode } from '@/data/types';
import { Platform } from 'react-native';
import { RightClick, type MenuItem } from '@/components/admin/ContextMenu';

import { ADMIN_GROUPS, type NavItem } from '@/lib/adminNav';
export { ADMIN_NAV } from '@/lib/adminNav';

const MODES: AdminNavMode[] = ['drawer', 'rail', 'top'];
const MODE_ICON: Record<AdminNavMode, string> = { drawer: 'menu', rail: 'dock-left', top: 'page-layout-header' };

function useActive() {
  const p = usePathname().replace(/\/$/, '');
  return (href: string) => (href === '/admin' ? p === '/admin' : p === href);
}

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return <View className="bg-danger rounded-full min-w-[20px] h-5 px-1.5 items-center justify-center"><Txt className="text-white text-[11px] font-bold">{n > 99 ? '99+' : n}</Txt></View>;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { desktop } = useBp();
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  // Startup already reads the admin lists in the background; this only covers an admin who signed in after startup.
  useEffect(() => { if (backendEnabled && !useStore.getState().adminLoaded) void useStore.getState().loadAdminData(); }, []);
  const { target, focus } = useGlobalSearchParams<{ target?: string; focus?: string }>();
  const insets = useSafeAreaInsets();
  const active = useActive();
  const name = useStore((s) => s.doc.branding.appName);
  const mode = (useStore((s) => s.doc.settings.adminNavMode) ?? 'drawer') as AdminNavMode;
  const pending = useStore((s) => s.requests.filter((r) => r.status === 'pending').length);
  const [open, setOpen] = useViewState('drawer-open', false); // mobile drawer overlay
  const [collapsed, setCollapsed] = useViewState('drawer-collapsed', false); // desktop drawer
  useEffect(() => {
    const menuTarget = typeof target === 'string' && target.startsWith('menu-');
    setOpen(menuTarget && !desktop && mode === 'drawer');
    if (menuTarget && desktop && mode === 'drawer') setCollapsed(false);
  }, [pathname, focus, target, desktop, mode, setOpen, setCollapsed]);
  useBackCheckpoint(open, () => setOpen(false), 1);
  useNativeOverlayBack(open, () => setOpen(false));
  const settingsDraft = useDraftDoc('settings');
  const measureDraft = useSearchObstacle(settingsDraft.dirty);

  const go = (href: string) => router.push(href as Href);
  /** Right-click on a menu entry (desktop): open it here or in a new browser tab. */
  const navMenu = (n: NavItem): MenuItem[] => [
    { key: 'open', label: label(n.key), icon: n.icon, onPress: () => go(n.href) },
    ...(Platform.OS === 'web' ? [{ key: 'newtab', label: t('ax.openNewTab'), icon: 'open-in-new', onPress: () => { (globalThis as any).window?.open?.(n.href, '_blank', 'noopener'); } } as MenuItem] : []),
  ];
  const logout = () => requestLeave(() => {
    // Stop this device's admin notifications before the session is revoked, then leave the panel.
    void releaseDevice('admin').catch(() => {}).then(() => backendLogout()).catch(() => {});
    usePrefs.getState().clear('admin');
    useLocal.getState().set({ adminSession: false });
  });
  const draftBar = settingsDraft.dirty ? <View onLayout={measureDraft} testID="admin-draft-bar" className="bg-soft border-t border-line p-2 flex-row items-center gap-2"><Txt className="flex-1 text-[12px] font-semibold">{t('improve.previewLabel')}</Txt><Button size="sm" variant="soft" title={t('improve.discard')} onPress={settingsDraft.discard} /><Button testID="admin-draft-submit" size="sm" title={t('improve.submit')} onPress={settingsDraft.save} /></View> : null;
  const nextMode = () => settingsDraft.patch( { adminNavMode: MODES[(MODES.indexOf(mode) + 1) % MODES.length] });
  const label = (k: string) => t(`admin.nav.${k}`);

  /* ---------- building blocks ---------- */
  const Brand = ({ compact }: { compact?: boolean }) => (
    <View className="flex-row items-center gap-2.5">
      <View className="w-9 h-9 rounded-xl bg-primary items-center justify-center"><Icon name="cog-outline" size={20} tone="onprimary" /></View>
      {compact ? null : <View className="shrink"><Txt numberOfLines={1} className="font-extrabold text-[16px]">{name}</Txt><Txt className="text-muted text-[12px]">{t('admin.title')}</Txt></View>}
    </View>
  );

  const Row = ({ n }: { n: NavItem }) => {
    const on = active(n.href);
    return (
      <SearchTarget id={`menu-${n.key}`}><RightClick items={() => navMenu(n)}><Pressable testID={`nav-${n.key}`} accessibilityRole="link" accessibilityLabel={label(n.key)} onPress={() => go(n.href)}
        className={`flex-row items-center gap-3 px-3 h-11 rounded-xl ${on ? 'bg-primary' : 'active:bg-surface2'}`}>
        <Icon name={n.icon} size={20} tone={on ? 'onprimary' : 'fg'} />
        <Txt numberOfLines={1} className={`flex-1 font-semibold text-[14px] ${on ? 'text-onprimary' : ''}`}>{label(n.key)}</Txt>
        {n.key === 'requests' ? <Badge n={pending} /> : null}
      </Pressable></RightClick></SearchTarget>
    );
  };

  const GroupedList = ({ onItem }: { onItem?: () => void }) => (
    <RememberScroll stateKey="shared:admin-menu" contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }} showsVerticalScrollIndicator={desktop}>
      {ADMIN_GROUPS.map((g) => (
        <View key={g.key} className="mb-3">
          <Txt className="text-muted text-[11px] font-bold uppercase tracking-wide px-3 mb-1">{t(`admin.group.${g.key}`)}</Txt>
          <View style={{ gap: 2 }}>{g.items.map((n) => <View key={n.key} onTouchEnd={onItem}>{Row({ n })}</View>)}</View>
        </View>
      ))}
    </RememberScroll>
  );

  const Footer = ({ compact }: { compact?: boolean }) => (
    <View className={`p-3 border-t border-line gap-1 ${compact ? 'items-center' : ''}`}>
      <Pressable testID="open-app" accessibilityLabel={t('admin.openApp')} onPress={() => router.push('/')} className="flex-row items-center gap-3 px-3 h-10"><Icon name="open-in-new" size={19} />{compact ? null : <Txt className="font-semibold text-[14px]">{t('admin.openApp')}</Txt>}</Pressable>
      <Pressable testID="logout" accessibilityLabel={t('admin.logout')} onPress={logout} className="flex-row items-center gap-3 px-3 h-10"><Icon name="logout" size={19} tone="danger" />{compact ? null : <Txt className="font-semibold text-[14px] text-danger">{t('admin.logout')}</Txt>}</Pressable>
    </View>
  );

  const LayoutBtn = () => (
    <Pressable testID="admin-layout-toggle" accessibilityLabel={t('admin.menu.layout')} onPress={nextMode} className="w-10 h-10 rounded-full items-center justify-center active:bg-surface2">
      <Icon name={MODE_ICON[MODES[(MODES.indexOf(mode) + 1) % MODES.length]]} size={21} />
    </Pressable>
  );

  /** Icon-only fixed rail (mobile + desktop). */
  const Rail = () => (
    <View className="w-[64px] bg-surface border-e border-line items-center" style={{ paddingTop: insets.top + 8 }}>
      {Brand({ compact: true })}
      <RememberScroll stateKey="shared:admin-rail" showsVerticalScrollIndicator={desktop} style={{ flex: 1, alignSelf: 'stretch' }} contentContainerStyle={{ alignItems: 'center', paddingVertical: 10 }}>
        {ADMIN_GROUPS.map((g, gi) => (
          <View key={g.key} className="items-center" style={{ gap: 4 }}>
            {gi > 0 ? <View className="h-px w-8 bg-line my-2" /> : null}
            {g.items.map((n) => {
              const on = active(n.href);
              return (
                <SearchTarget key={n.key} id={`menu-${n.key}`}><RightClick items={() => navMenu(n)}><Pressable testID={`nav-${n.key}`} accessibilityRole="link" accessibilityLabel={label(n.key)} onPress={() => go(n.href)}
                  className={`w-11 h-11 rounded-xl items-center justify-center ${on ? 'bg-primary' : 'active:bg-surface2'}`}>
                  <Icon name={n.icon} size={22} tone={on ? 'onprimary' : 'fg'} />
                  {n.key === 'requests' && pending > 0 ? <View className="absolute -top-0.5 -end-0.5 bg-danger rounded-full min-w-[16px] h-4 px-1 items-center justify-center"><Txt className="text-white text-[10px] font-bold">{pending}</Txt></View> : null}
                </Pressable></RightClick></SearchTarget>
              );
            })}
          </View>
        ))}
      </RememberScroll>
      {Footer({ compact: true })}
    </View>
  );

  /** Horizontal menu grouped by topic. */
  const TopMenu = () => (
    <View className="bg-surface border-b border-line">
      <RememberScroll stateKey="shared:admin-top" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, alignItems: 'flex-end' }}>
        {ADMIN_GROUPS.map((g, gi) => (
          <View key={g.key} className={`${gi > 0 ? 'ms-3 ps-3 border-s border-line' : ''}`}>
            <Txt className="text-muted text-[10px] font-bold uppercase tracking-wide mb-1 px-1">{t(`admin.group.${g.key}`)}</Txt>
            <View className="flex-row" style={{ gap: 6 }}>
              {g.items.map((n) => {
                const on = active(n.href);
                return (
                  <SearchTarget key={n.key} id={`menu-${n.key}`}><RightClick items={() => navMenu(n)}><Pressable testID={`nav-${n.key}`} accessibilityRole="link" onPress={() => go(n.href)}
                    className={`flex-row items-center gap-2 px-3 h-9 rounded-full ${on ? 'bg-primary' : 'bg-surface2'}`}>
                    <Icon name={n.icon} size={17} tone={on ? 'onprimary' : 'fg'} />
                    <Txt className={`font-semibold text-[13px] ${on ? 'text-onprimary' : ''}`}>{label(n.key)}</Txt>
                    {n.key === 'requests' ? <Badge n={pending} /> : null}
                  </Pressable></RightClick></SearchTarget>
                );
              })}
            </View>
          </View>
        ))}
      </RememberScroll>
    </View>
  );

  const TopBar = ({ menuBtn }: { menuBtn?: boolean }) => (
    <View className="flex-row items-center px-3 h-14 gap-2 bg-bg">
      {menuBtn ? <Pressable testID="admin-menu-btn" accessibilityLabel={t('admin.menu.open')} onPress={() => setOpen(true)} className="w-10 h-10 rounded-full items-center justify-center active:bg-surface2"><Icon name="menu" size={23} /></Pressable> : null}
      <Txt numberOfLines={1} className="font-extrabold text-[17px] flex-1">{name} · {t('admin.title')}</Txt>
      {LayoutBtn()}
      {mode === 'top' ? (
        <>
          <Pressable onPress={() => router.push('/')} accessibilityLabel={t('admin.openApp')} className="w-10 h-10 items-center justify-center"><Icon name="open-in-new" size={21} /></Pressable>
          <Pressable testID="logout" onPress={logout} accessibilityLabel={t('admin.logout')} className="w-10 h-10 items-center justify-center"><Icon name="logout" size={21} tone="danger" /></Pressable>
        </>
      ) : null}
    </View>
  );

  /* ---------- layouts ---------- */
  if (mode === 'rail') {
    return (
      <View className="flex-1 flex-row bg-bg">
        {Rail()}
        <View className="flex-1">
          {!desktop ? <View style={{ paddingTop: insets.top }}>{TopBar({})}</View> : null}
          {children}{draftBar}
        </View>
      </View>
    );
  }

  if (mode === 'top') {
    return (
      <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
        {TopBar({})}
        {TopMenu()}
        <View className="flex-1">{children}{draftBar}</View>
      </View>
    );
  }

  // drawer
  if (desktop) {
    return (
      <View className="flex-1 flex-row bg-bg">
        {collapsed ? Rail() : (
          <View className="w-[260px] bg-surface border-e border-line" style={{ paddingTop: insets.top }}>
            <View className="px-4 py-4 flex-row items-center justify-between">{Brand({})}</View>
            {GroupedList({})}
            {Footer({})}
          </View>
        )}
        <View className="flex-1">
          <View className="flex-row items-center px-3 h-12 gap-1">
            <Pressable testID="admin-collapse" accessibilityLabel={collapsed ? t('admin.menu.expand') : t('admin.menu.collapse')} onPress={() => setCollapsed((c) => !c)} className="w-10 h-10 rounded-full items-center justify-center active:bg-surface2"><Icon name="menu" size={22} /></Pressable>
            <View className="flex-1" />
            {LayoutBtn()}
          </View>
          {children}{draftBar}
        </View>
      </View>
    );
  }
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {TopBar({ menuBtn: true })}
      <View className="flex-1">{children}{draftBar}</View>
      {open ? (
        <View testID="admin-drawer" className="absolute inset-0 flex-row" style={{ zIndex: 50 }}>
          <View className="w-[280px] max-w-[85%] bg-surface border-e border-line" style={{ paddingTop: insets.top }}>
            <View className="px-4 py-3 flex-row items-center justify-between">
              {Brand({})}
              <Pressable testID="admin-menu-close" accessibilityLabel={t('admin.menu.close')} onPress={() => setOpen(false)} className="w-9 h-9 rounded-full items-center justify-center active:bg-surface2"><Icon name="close" size={21} /></Pressable>
            </View>
            {GroupedList({})}
            {Footer({})}
          </View>
          <Pressable accessibilityLabel={t('admin.menu.close')} onPress={() => setOpen(false)} className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} />
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
    <View style={{ flex: 1, minHeight: 0 }}><RememberScroll contentContainerStyle={{ padding: tablet ? 16 : 12, paddingBottom: floating ? 160 : 32 }}>
      <View style={{ width: '100%', maxWidth: max, alignSelf: 'center' }}>
        <View className="flex-row flex-wrap items-center justify-between mb-3 gap-2">
          <Pressable testID="admin-back" accessibilityLabel={t('improve.back')} onPress={() => router.back()} className="w-10 h-10 items-center justify-center"><Icon name="chevron-left" size={24} flip /></Pressable>
          <Txt className="text-[21px] font-extrabold flex-1" accessibilityRole="header" style={{ minWidth: 80, flexBasis: 120 }}>{title}</Txt>
          {right}
        </View>
        {children}
      </View>
    </RememberScroll>{floating ? <View onLayout={measureFloating} style={{ position: 'absolute', bottom: 20, left: 12, right: 12, maxWidth: 700, alignSelf: 'center', marginHorizontal: 'auto', zIndex: 10 } as any}>{floating}</View> : null}</View>
  );
}
