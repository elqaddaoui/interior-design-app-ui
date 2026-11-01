import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { create } from 'zustand';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Desktop right-click menus for the admin panel.
 *  - `<RightClick items={() => [...]}>` wraps any element; a right click with a MOUSE opens the menu of the nearest wrapper.
 *    (A touch long-press keeps its existing behaviour: selecting rows, drag handles... and never opens this menu.)
 *  - Text fields keep the browser's own menu (copy / paste), and a wrapper only answers clicks that happen inside its own DOM
 *    subtree, so a page-level menu never shows up from inside a popup that is rendered in a portal.
 *  - `<ContextMenuHost/>` is rendered once (admin layout) and draws the menu above everything, popups included.
 */
export type MenuItem =
  | { key: string; label: string; icon?: string; danger?: boolean; disabled?: boolean; onPress: () => void }
  | { key: string; separator: true };

type Open = { x: number; y: number; items: MenuItem[] } | null;
const useMenu = create<{ menu: Open; open(x: number, y: number, items: MenuItem[]): void; close(): void }>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: { x, y, items } }),
  close: () => set({ menu: null }),
}));
export const closeContextMenu = () => useMenu.getState().close();
export const sep = (key: string): MenuItem => ({ key, separator: true });

const isField = (node: unknown) => {
  const el = node as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.isContentEditable);
};

export function RightClick({ items, children, disabled, style }: { items: () => MenuItem[] | null | undefined; children: React.ReactNode; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  if (Platform.OS !== 'web' || disabled) return <View style={style}>{children}</View>;
  const onContextMenu = (e: any) => {
    const native = e.nativeEvent ?? e;
    if (native.pointerType === 'touch' || native.pointerType === 'pen') return;
    if (isField(native.target)) return;
    const current = native.currentTarget ?? e.currentTarget;
    if (current?.contains && native.target && !current.contains(native.target)) return;
    const list = items()?.filter(Boolean);
    if (!list?.length) return;
    e.preventDefault?.(); e.stopPropagation?.();
    useMenu.getState().open(native.clientX ?? 0, native.clientY ?? 0, list);
  };
  const web = { onContextMenu } as object;
  return <View {...web} style={style}>{children}</View>;
}

const WIDTH = 236;
const ROW = 40;
const SEP = 9;

export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu);
  const close = useMenu((s) => s.close);
  const { style, colors } = useTheme();
  const { rtl } = useT();
  const { width, height } = useWindowDimensions();
  const [active, setActive] = useState(-1);
  useEffect(() => { setActive(-1); }, [menu]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !menu) return;
    const actionable = menu.items.map((item, i) => ('separator' in item || item.disabled ? -1 : i)).filter((i) => i >= 0);
    const run = (index: number) => { const item = menu.items[index]; if (item && !('separator' in item) && !item.disabled) { close(); setTimeout(item.onPress, 0); } };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((old) => { const at = actionable.indexOf(old); const next = e.key === 'ArrowDown' ? (at + 1) % actionable.length : (at <= 0 ? actionable.length - 1 : at - 1); return actionable[next] ?? -1; });
      } else if (e.key === 'Enter') { setActive((old) => { if (old >= 0) { e.preventDefault(); run(old); } return old; }); }
    };
    const shut = () => close();
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', shut);
    window.addEventListener('resize', shut);
    window.addEventListener('wheel', shut, { passive: true });
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', shut); window.removeEventListener('resize', shut); window.removeEventListener('wheel', shut); };
  }, [menu, close]);

  if (!menu) return null;
  const total = menu.items.reduce((sum, item) => sum + ('separator' in item ? SEP : ROW), 12);
  const left = Math.max(8, Math.min(menu.x, width - WIDTH - 8));
  const top = Math.max(8, Math.min(menu.y, height - total - 8));
  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={[style, { flex: 1, direction: rtl ? 'rtl' : 'ltr' } as ViewStyle]}>
        <Pressable accessibilityLabel="close" style={StyleSheet.absoluteFill} onPress={close} {...(Platform.OS === 'web' ? ({ onContextMenu: (e: any) => { e.preventDefault?.(); close(); } } as object) : {})} />
        <View testID="context-menu" accessibilityRole="menu" className="bg-surface border border-line rounded-2xl py-1.5"
          style={{ position: 'absolute', left, top, width: WIDTH, boxShadow: '0 14px 40px rgba(0,0,0,0.28)' } as ViewStyle}>
          {menu.items.map((item, i) => 'separator' in item
            ? <View key={item.key} style={{ height: SEP, justifyContent: 'center' }}><View style={{ height: 1, backgroundColor: colors.line, marginHorizontal: 10 }} /></View>
            : (
              <Pressable key={item.key} testID={`menu-${item.key}`} accessibilityRole="menuitem" accessibilityState={{ disabled: !!item.disabled }} disabled={item.disabled}
                onPress={() => { close(); setTimeout(item.onPress, 0); }}
                {...(Platform.OS === 'web' ? ({ onMouseEnter: () => setActive(i) } as object) : {})}
                className={`flex-row items-center gap-3 px-3 mx-1.5 rounded-xl ${active === i ? 'bg-surface2' : ''}`} style={{ height: ROW, opacity: item.disabled ? 0.4 : 1 }}>
                {item.icon ? <Icon name={item.icon} size={19} tone={item.danger ? 'danger' : 'fg'} /> : <View style={{ width: 19 }} />}
                <Txt numberOfLines={1} className={`flex-1 text-[14px] font-semibold ${item.danger ? 'text-danger' : ''}`}>{item.label}</Txt>
              </Pressable>
            ))}
        </View>
      </View>
    </Modal>
  );
}
