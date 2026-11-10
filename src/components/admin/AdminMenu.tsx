import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { usePathname } from 'expo-router';
import { useRouter } from '@/hooks/useLeaveGuard';
import { SearchTarget, RememberScroll } from '@/hooks/useViewState';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { AdminAvatar } from '@/components/admin/AdminAvatar';
import { AccountMenu, type Anchor } from '@/components/admin/AccountMenu';
import { RightClick, type MenuItem } from '@/components/admin/ContextMenu';
import { useAdminProfile } from '@/store/useAdminProfile';
import { ADMIN_NAV, visibleGroups, type NavItem } from '@/lib/adminNav';
import { MENU_GEO, activeKey, menuPositions } from '@/lib/menuLayout';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AdminMenuDesign } from '@/data/types';
import type { Href } from 'expo-router';

/**
 * The admin side menu: three animated designs, one geometry.
 *  - glide:     an ink pill glides (spring) from the old entry to the new one.
 *  - beam:      a soft tint slides to the entry and a coloured beam on the screen edge trails it with a little overshoot.
 *  - spotlight: a highlight follows the pointer over the entries (and rests on the current one) inside an outlined current-entry frame.
 * Expanded (text) and collapsed (icon rail) share the same rows and icon positions: collapsing only animates the width and fades the labels, so
 * nothing jumps. With animation off every move is instant. Fixed row heights (see lib/menuLayout) let one absolutely positioned layer slide
 * under the rows.
 */
export const MENU_DESIGNS: AdminMenuDesign[] = ['glide', 'beam', 'spotlight'];
const EASE = Easing.out(Easing.cubic);
const SPR = {
  glide: { damping: 21, stiffness: 270, mass: 0.7 },
  tint: { damping: 24, stiffness: 210, mass: 0.8 },
  beam: { damping: 13, stiffness: 150, mass: 0.9 },
  frame: { damping: 22, stiffness: 240, mass: 0.75 },
} as const;

/** Moves a shared value: spring when animation is on, a plain jump otherwise. */
const move = (sv: SharedValue<number>, to: number, cfg: (typeof SPR)[keyof typeof SPR], motion: boolean) => { sv.value = motion ? withSpring(to, cfg) : to; };

const ROW = MENU_GEO.row;

/** The layers that slide under the rows. */
function Layers({ design, active, hover, motion, rtl, POS }: { POS: ReturnType<typeof menuPositions>; design: AdminMenuDesign; active?: string; hover?: string; motion: boolean; rtl: boolean }) {
  const { colors } = useTheme();
  const ay = useSharedValue(active ? POS.y[active] : 0), av = useSharedValue(active ? 1 : 0);
  const by = useSharedValue(active ? POS.y[active] : 0);
  const hy = useSharedValue(0), hv = useSharedValue(0);
  const seen = useRef(false);
  useEffect(() => {
    if (!active) { av.value = 0; return; }
    const to = POS.y[active];
    if (!seen.current || av.value === 0) { ay.value = to; by.value = to; av.value = motion ? withTiming(1, { duration: 160 }) : 1; seen.current = true; return; }
    move(ay, to, design === 'beam' ? SPR.tint : design === 'spotlight' ? SPR.frame : SPR.glide, motion);
    move(by, to, SPR.beam, motion);
  }, [active, design, motion, ay, by, av]);
  useEffect(() => {
    if (design !== 'spotlight') return;
    if (!hover) { hv.value = motion ? withTiming(0, { duration: 160 }) : 0; return; }
    const to = POS.y[hover];
    if (hv.value < 0.05) hy.value = to; else hy.value = motion ? withTiming(to, { duration: 150, easing: EASE }) : to;
    hv.value = motion ? withTiming(1, { duration: 120 }) : 1;
  }, [hover, design, motion, hy, hv]);

  const pill = useAnimatedStyle(() => ({ opacity: av.value, transform: [{ translateY: ay.value }] }));
  const beam = useAnimatedStyle(() => ({ opacity: av.value, transform: [{ translateY: by.value + 11 }] }));
  const spot = useAnimatedStyle(() => ({ opacity: hv.value, transform: [{ translateY: hy.value }] }));
  const base = { position: 'absolute' as const, left: 0, right: 0, top: 0, height: ROW, borderRadius: 16 };
  if (design === 'glide') return <Animated.View pointerEvents="none" style={[base, { backgroundColor: colors.ink }, pill]} />;
  if (design === 'beam') return (
    <>
      <Animated.View pointerEvents="none" style={[base, { backgroundColor: colors.soft }, pill]} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, width: 4, height: ROW - 22, borderRadius: 2, backgroundColor: colors.primary }, rtl ? { right: -10 } : { left: -10 }, beam]} />
    </>
  );
  return (
    <>
      <Animated.View pointerEvents="none" style={[base, { backgroundColor: colors.surface2 }, spot]} />
      <Animated.View pointerEvents="none" style={[base, { backgroundColor: colors.soft, borderWidth: 1.5, borderColor: colors.primary }, pill]} />
    </>
  );
}

function Row({ n, on, design, motion, p, pending, label, onGo, onHover, menu }: {
  n: NavItem; on: boolean; design: AdminMenuDesign; motion: boolean; p: SharedValue<number>; pending: number; label: string;
  onGo: (n: NavItem) => void; onHover: (key?: string) => void; menu: (n: NavItem) => MenuItem[];
}) {
  const scale = useSharedValue(1);
  const box = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const text = useAnimatedStyle(() => ({ opacity: p.value }));
  const dot = useAnimatedStyle(() => ({ opacity: 1 - p.value }));
  const tile = on && design !== 'beam';
  const light = on && design === 'glide'; // ink pill: light text
  const web = Platform.OS === 'web';
  const showBadge = n.key === 'requests' && pending > 0;
  const hover = web ? ({ onHoverIn: () => onHover(n.key), onHoverOut: () => onHover(undefined), title: label } as object) : {};
  return (
    <SearchTarget id={`menu-${n.key}`}>
      <RightClick items={() => menu(n)}>
        <Animated.View style={box}>
          <Pressable testID={`nav-${n.key}`} accessibilityRole="link" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => onGo(n)} {...hover}
            onPressIn={() => { if (motion) scale.value = withTiming(0.97, { duration: 90 }); }} onPressOut={() => { scale.value = motion ? withSpring(1, { damping: 14, stiffness: 300 }) : 1; }}
            className={`flex-row items-center rounded-2xl overflow-hidden ${!on && design !== 'spotlight' ? 'hover:bg-surface2' : ''}`} style={{ height: ROW, paddingStart: 8, paddingEnd: 10, gap: 12 }}>
            <View className={`w-7 h-7 rounded-[10px] items-center justify-center ${tile ? 'bg-primary' : ''}`}>
              <Icon name={n.icon} size={19} tone={tile ? 'onprimary' : on ? 'fg' : 'muted'} />
              {showBadge ? <Animated.View style={dot} className="absolute -top-1 -end-1 bg-danger rounded-full w-2.5 h-2.5 border border-surface" /> : null}
            </View>
            <Animated.View style={[{ flex: 1, minWidth: 0 }, text]}>
              <Txt numberOfLines={1} className={`font-semibold text-[14px] ${on ? 'font-bold' : ''} ${light ? 'text-onink' : ''}`}>{label}</Txt>
            </Animated.View>
            {showBadge ? <Animated.View style={text} testID="nav-badge" className="bg-danger rounded-full min-w-[20px] h-5 px-1.5 items-center justify-center"><Txt className="text-white text-[11px] font-extrabold">{pending > 99 ? '99+' : pending}</Txt></Animated.View> : null}
          </Pressable>
        </Animated.View>
      </RightClick>
    </SearchTarget>
  );
}

export function AdminMenu({ collapsed, design, anim, fill, insetTop = 0, onNavigate, onLogout, onClose }: {
  collapsed: boolean; design: AdminMenuDesign; anim: boolean;
  /** Fill the parent (mobile drawer) instead of animating its own width. */
  fill?: boolean; insetTop?: number; onNavigate?: () => void; onLogout: () => void; onClose?: () => void;
}) {
  const { t, rtl } = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const path = usePathname();
  const access = useAdminProfile((s) => s.access);
  const groups = useMemo(() => visibleGroups(access), [access]);
  const POS = useMemo(() => menuPositions(groups), [groups]);
  const active = activeKey(ADMIN_NAV, path);
  const name = useStore((s) => s.doc.branding.appName);
  const pending = useStore((s) => s.requests.filter((r) => r.status === 'pending').length);
  const [hover, setHover] = useState<string | undefined>();
  const p = useSharedValue(collapsed ? 0 : 1); // 1 = expanded, 0 = icon rail
  const account = useRef<View>(null);
  useEffect(() => { p.value = anim ? withTiming(collapsed ? 0 : 1, { duration: 260, easing: EASE }) : collapsed ? 0 : 1; }, [collapsed, anim, p]);
  const widthStyle = useAnimatedStyle(() => ({ width: interpolate(p.value, [0, 1], [MENU_GEO.rail, MENU_GEO.wide]) }));
  const fade = useAnimatedStyle(() => ({ opacity: p.value }));
  const rail = useAnimatedStyle(() => ({ opacity: 1 - p.value }));
  const label = (k: string) => t(`admin.nav.${k}`);
  const go = (n: NavItem) => { onNavigate?.(); router.push(n.href as Href); };
  const menu = useMemo(() => (n: NavItem): MenuItem[] => [
    { key: 'open', label: t(`admin.nav.${n.key}`), icon: n.icon, onPress: () => { router.push(n.href as Href); } },
    ...(Platform.OS === 'web' ? [{ key: 'newtab', label: t('ax.openNewTab'), icon: 'open-in-new', onPress: () => { (globalThis as any).window?.open?.(n.href, '_blank', 'noopener'); } } as MenuItem] : []),
  ], [t, router]);

  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const profile = useAdminProfile((s) => s.profile);
  const adminName = (profile?.name || '').trim() || t('dx.shell.admin');
  const openAccount = () => { account.current?.measureInWindow((x, y, w) => setAnchor({ x, y, w })); };
  const closeAccount = () => setAnchor(null);

  return (
    <Animated.View testID="admin-menu" style={[fill ? { flex: 1 } : widthStyle, { backgroundColor: colors.surface, borderEndWidth: 1, borderColor: colors.line, paddingTop: insetTop, overflow: 'hidden' }]}>
      {/* brand */}
      <View testID="admin-brand" className="flex-row items-center" style={{ height: 72, paddingHorizontal: 16, gap: 12 }}>
        <View className="w-10 h-10 rounded-2xl bg-primary items-center justify-center" style={{ boxShadow: '0 6px 16px -6px rgba(0,0,0,0.35)' } as any}><Txt className="font-black text-[19px] text-onprimary" style={{ letterSpacing: -0.5 }}>{(name || 'D').trim().charAt(0).toUpperCase()}</Txt></View>
        <Animated.View style={[{ flex: 1, minWidth: 0 }, fade]}><Txt numberOfLines={1} className="font-black text-[16px] leading-[20px]" style={{ letterSpacing: -0.3 }}>{name}</Txt><Txt numberOfLines={1} className="text-muted text-[11px] font-bold uppercase" style={{ letterSpacing: 1 }}>{t('admin.title')}</Txt></Animated.View>
        {onClose ? <Pressable testID="admin-menu-close" accessibilityRole="button" accessibilityLabel={t('admin.menu.close')} onPress={onClose} className="w-9 h-9 rounded-full items-center justify-center active:bg-surface2" style={{ marginEnd: -4 }}><Icon name="close" size={21} /></Pressable> : null}
      </View>

      {/* entries */}
      <RememberScroll stateKey="shared:admin-menu" style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        <View style={{ position: 'relative' }}>
          <Layers design={design} active={active} hover={hover} motion={anim} rtl={rtl} POS={POS} />
          {groups.map((g, gi) => (
            <View key={g.key} style={{ marginBottom: gi < groups.length - 1 ? MENU_GEO.groupGap : 0 }}>
              <View style={{ height: MENU_GEO.head, justifyContent: 'flex-end', paddingBottom: 6, paddingHorizontal: 10 }}>
                <Animated.View style={fade}><Txt numberOfLines={1} className="text-muted text-[10px] font-extrabold uppercase" style={{ letterSpacing: 1.2 }}>{t(`admin.group.${g.key}`)}</Txt></Animated.View>
                {gi > 0 ? <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 14, right: 14, top: MENU_GEO.head / 2 - 4, height: 1, backgroundColor: colors.line }, rail]} /> : null}
              </View>
              <View style={{ gap: MENU_GEO.gap }}>
                {g.items.map((n) => <Row key={n.key} n={n} on={active === n.key} design={design} motion={anim} p={p} pending={pending} label={label(n.key)} onGo={go} onHover={setHover} menu={menu} />)}
              </View>
            </View>
          ))}
        </View>
      </RememberScroll>

      {/* account: one compact row, the rest lives in its popover */}
      <View style={{ padding: 12, borderTopWidth: 1, borderColor: colors.line }}>
        <View ref={account} collapsable={false}>
          <Pressable testID="admin-account" accessibilityRole="button" accessibilityLabel={t('dx.shell.admin')} {...(Platform.OS === 'web' ? ({ 'aria-haspopup': 'menu', title: t('dx.shell.admin') } as object) : {})} onPress={openAccount}
            className="flex-row items-center rounded-2xl hover:bg-surface2 active:bg-surface2 overflow-hidden" style={{ height: 52, paddingStart: 5, paddingEnd: 8, gap: 10 }}>
            <AdminAvatar name={adminName} uri={profile?.avatar} size={34} />
            <Animated.View style={[{ flex: 1, minWidth: 0 }, fade]}>
              <Txt numberOfLines={1} className="font-extrabold text-[13px]">{adminName}</Txt>
              <Txt numberOfLines={1} className="text-muted text-[11px]">{pending > 0 ? `${t('dx.shell.pending')} · ${pending}` : t('dx.shell.noPending')}</Txt>
            </Animated.View>
            <Animated.View style={fade}><Icon name="unfold-more-horizontal" size={18} tone="muted" /></Animated.View>
          </Pressable>
        </View>
      </View>
      <AccountMenu anchor={anchor} onClose={closeAccount} fallbackName={t('dx.shell.admin')} onGo={(href) => { onNavigate?.(); router.push(href as Href); }} onOpenApp={() => { onNavigate?.(); router.push('/'); }} onLogout={onLogout} />
    </Animated.View>
  );
}
