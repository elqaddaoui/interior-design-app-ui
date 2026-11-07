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
import { Initials } from '@/components/admin/dashboard/Kit';

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
  return <View testID="nav-badge" className="bg-danger rounded-full min-w-[20px] h-5 px-1.5 items-center justify-center"><Txt className="text-white text-[11px] font-extrabold">{n > 99 ? '99+' : n}</Txt></View>;
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
    <View className="flex-row items-center gap-3" testID="admin-brand">
      <View className="w-10 h-10 rounded-2xl bg-primary items-center justify-center" style={{ boxShadow: '0 6px 16px -6px rgba(0,0,0,0.35)' } as any}><Txt className="font-black text-[19px] text-onprimary" style={{ letterSpacing: -0.5 }}>{(name || 'D').trim().charAt(0).toUpperCase()}</Txt></View>
      {compact ? null : <View className="shrink"><Txt numberOfLines={1} className="font-black text-[16px] leading-[20px]" style={{ letterSpacing: -0.3 }}>{name}</Txt><Txt className="text-muted text-[11px] font-bold uppercase" style={{ letterSpacing: 1 }}>{t('admin.title')}</Txt></View>}
    </View>
  );

  const Row = ({ n }: { n: NavItem }) => {
    const on = active(n.href);
    return (
      <SearchTarget id={`menu-${n.key}`}><RightClick items={() => navMenu(n)}><Pressable testID={`nav-${n.key}`} accessibilityRole="link" accessibilityLabel={label(n.key)} onPress={() => go(n.href)}
        className={`flex-row items-center gap-3 px-3 h-11 rounded-2xl ${on ? 'bg-ink' : 'hover:bg-surface2'}`}>
        <View className={`w-7 h-7 rounded-lg items-center justify-center ${on ? 'bg-primary' : ''}`}><Icon name={n.icon} size={18} tone={on ? 'onprimary' : 'muted'} /></View>
        <Txt numberOfLines={1} className={`flex-1 font-semibold text-[14px] ${on ? 'text-onink font-bold' : ''}`}>{label(n.key)}</Txt>
        {n.key === 'requests' ? <Badge n={pending} /> : null}
      </Pressable></RightClick></SearchTarget>
    );
  };

  const GroupedList = ({ onItem }: { onItem?: () => void }) => (
    <RememberScroll stateKey="shared:admin-menu" contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }} showsVerticalScrollIndicator={desktop}>
      {ADMIN_GROUPS.map((g) => (
        <View key={g.key} className="mb-4">
          <Txt className="text-muted text-[10px] font-extrabold uppercase px-3 mb-1.5" style={{ letterSpacing: 1.2 }}>{t(`admin.group.${g.key}`)}</Txt>
          <View style={{ gap: 2 }}>{g.items.map((n) => <View key={n.key} onTouchEnd={onItem}>{Row({ n })}</View>)}</View>
        </View>
      ))}
    </RememberScroll>
  );

  const Footer = ({ compact }: { compact?: boolean }) => (
    <View className={`p-3 border-t border-line gap-1 ${compact ? 'items-center' : ''}`}>
      {compact ? null : (
        <View testID="admin-user" className="flex-row items-center gap-3 bg-surface2 rounded-2xl p-2.5 mb-1.5">
          <Initials name={name || 'A'} size={34} />
          <View className="flex-1"><Txt numberOfLines={1} className="font-extrabold text-[13px]">{t('dx.shell.admin')}</Txt><Txt numberOfLines={1} className="text-muted text-[11px]">{pending > 0 ? t('dx.shell.pending') + ' · ' + pending : t('dx.shell.noPending')}</Txt></View>
        </View>
      )}
      <Pressable testID="open-app" accessibilityLabel={t('admin.openApp')} onPress={() => router.push('/')} className="flex-row items-center gap-3 px-3 h-10 rounded-xl active:bg-surface2"><Icon name="open-in-new" size={19} tone="muted" />{compact ? null : <Txt className="font-semibold text-[14px]">{t('admin.openApp')}</Txt>}</Pressable>
      <Pressable testID="logout" accessibilityLabel={t('admin.logout')} onPress={logout} className="flex-row items-center gap-3 px-3 h-10 rounded-xl active:bg-surface2"><Icon name="logout" size={19} tone="danger" />{compact ? null : <Txt className="font-semibold text-[14px] text-danger">{t('admin.logout')}</Txt>}</Pressable>
    </View>
  );

  const LayoutBtn = () => (
    <Pressable testID="admin-layout-toggle" accessibilityLabel={t('admin.menu.layout')} onPress={nextMode} className="w-10 h-10 rounded-full border border-line bg-surface items-center justify-center">
      <Icon name={MODE_ICON[MODES[(MODES.indexOf(mode) + 1) % MODES.length]]} size={21} />
    </Pressable>
  );

  const Bell = () => (
    <Pressable testID="admin-bell" accessibilityLabel={t('dx.shell.pending')} onPress={() => go('/admin/requests')} className="w-10 h-10 rounded-full border border-line bg-surface items-center justify-center">
      <Icon name="bell-outline" size={20} />
      {pending > 0 ? <View className="absolute -top-1 -end-1 bg-danger rounded-full min-w-[18px] h-[18px] px-1 items-center justify-center"><Txt className="text-white text-[10px] font-extrabold">{pending > 99 ? '99+' : pending}</Txt></View> : null}
    </Pressable>
  );

  /** Icon-only fixed rail (mobile + desktop). */
  const Rail = () => (
    <View className="w-[68px] bg-surface border-e border-line items-center" style={{ paddingTop: insets.top + 14 }}>
      {Brand({ compact: true })}
      <RememberScroll stateKey="shared:admin-rail" showsVerticalScrollIndicator={desktop} style={{ flex: 1, alignSelf: 'stretch' }} contentContainerStyle={{ alignItems: 'center', paddingVertical: 10 }}>
        {ADMIN_GROUPS.map((g, gi) => (
          <View key={g.key} className="items-center" style={{ gap: 4 }}>
            {gi > 0 ? <View className="h-px w-8 bg-line my-2" /> : null}
            {g.items.map((n) => {
              const on = active(n.href);
              return (
                <SearchTarget key={n.key} id={`menu-${n.key}`}><RightClick items={() => navMenu(n)}><Pressable testID={`nav-${n.key}`} accessibilityRole="link" accessibilityLabel={label(n.key)} onPress={() => go(n.href)}
                  className={`w-11 h-11 rounded-2xl items-center justify-center ${on ? 'bg-ink' : 'active:bg-surface2'}`}>
                  <Icon name={n.icon} size={21} tone={on ? 'onink' : 'muted'} />
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
                    className={`flex-row items-center gap-2 px-3 h-9 rounded-full ${on ? 'bg-ink' : 'bg-surface2'}`}>
                    <Icon name={n.icon} size={17} tone={on ? 'onink' : 'fg'} />
                    <Txt className={`font-semibold text-[13px] ${on ? 'text-onink font-bold' : ''}`}>{label(n.key)}</Txt>
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
      {menuBtn ? <Pressable testID="admin-menu-btn" accessibilityLabel={t('admin.menu.open')} onPress={() => setOpen(true)} className="w-10 h-10 rounded-full border border-line bg-surface items-center justify-center"><Icon name="menu" size={21} /></Pressable> : null}
      <Txt numberOfLines={1} className="font-black text-[17px] flex-1" style={{ letterSpacing: -0.3 }}>{name} · {t('admin.title')}</Txt>
      {Bell()}
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
          <View className="w-[272px] bg-surface border-e border-line" style={{ paddingTop: insets.top }}>
            <View className="px-5 pt-5 pb-4 flex-row items-center justify-between">{Brand({})}</View>
            {GroupedList({})}
            {Footer({})}
          </View>
        )}
        <View className="flex-1">
          <View className="flex-row items-center px-4 h-14 gap-2">
            <Pressable testID="admin-collapse" accessibilityLabel={collapsed ? t('admin.menu.expand') : t('admin.menu.collapse')} onPress={() => setCollapsed((c) => !c)} className="w-10 h-10 rounded-full border border-line bg-surface items-center justify-center"><Icon name="menu" size={20} /></Pressable>
            <View className="flex-1" />
            {Bell()}
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
          <View className="w-[292px] max-w-[88%] bg-surface border-e border-line" style={{ paddingTop: insets.top, boxShadow: '0 0 60px rgba(0,0,0,0.3)' } as any}>
            <View className="px-4 py-3 flex-row items-center justify-between">
              {Brand({})}
              <Pressable testID="admin-menu-close" accessibilityLabel={t('admin.menu.close')} onPress={() => setOpen(false)} className="w-9 h-9 rounded-full items-center justify-center active:bg-surface2"><Icon name="close" size={21} /></Pressable>
            </View>
            {GroupedList({})}
            {Footer({})}
          </View>
          <Pressable accessibilityLabel={t('admin.menu.close')} onPress={() => setOpen(false)} className="flex-1" style={{ backgroundColor: 'rgba(8,10,16,0.55)' }} />
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
    <View style={{ flex: 1, minHeight: 0 }}><RememberScroll contentContainerStyle={{ padding: tablet ? 24 : 14, paddingTop: tablet ? 8 : 6, paddingBottom: floating ? 160 : 48 }}>
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
