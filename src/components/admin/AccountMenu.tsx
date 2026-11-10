import React, { useEffect } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { AdminAvatar } from '@/components/admin/AdminAvatar';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { LANGS, useLang, useT } from '@/i18n';
import { useAdminProfile } from '@/store/useAdminProfile';
import { useTheme } from '@/theme/ThemeProvider';

export const ACCOUNT_MENU_WIDTH = 288;
export type Anchor = { x: number; y: number; w: number };

/** Short language names shown on the three fast-select chips (always in their own language). */
const LANG_SHORT: Record<string, string> = { dar: 'الدارجة', ar: 'العربية', fr: 'Français' };

function Entry({ id, icon, label, onPress, danger, trailing }: { id: string; icon: string; label: string; onPress: () => void; danger?: boolean; trailing?: React.ReactNode }) {
  return (
    <Pressable testID={`account-menu-${id}`} accessibilityRole="menuitem" accessibilityLabel={label} onPress={onPress}
      className="flex-row items-center px-3 mx-1.5 rounded-xl hover:bg-surface2 active:bg-surface2" style={{ height: 44, gap: 12 }}>
      <Icon name={icon} size={20} tone={danger ? 'danger' : 'fg'} />
      <Txt numberOfLines={1} className={`flex-1 text-[14px] font-semibold ${danger ? 'text-danger' : ''}`}>{label}</Txt>
      {trailing}
    </Pressable>
  );
}

/**
 * The account popover: who is signed in, the admin's credits, a one-tap language switch and the personal links.
 * It sits above the account row of the side menu (desktop sidebar, collapsed rail and mobile drawer alike).
 */
export function AccountMenu({ anchor, onClose, onGo, onOpenApp, onLogout, fallbackName }: {
  anchor: Anchor | null; onClose: () => void; onGo: (href: '/admin/account' | '/admin/settings') => void; onOpenApp: () => void; onLogout: () => void; fallbackName: string;
}) {
  const { t, rtl, lang } = useT();
  const { style, colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const profile = useAdminProfile((s) => s.profile);
  useEffect(() => {
    if (Platform.OS !== 'web' || !anchor) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    const shut = () => onClose();
    window.addEventListener('keydown', key, true); window.addEventListener('resize', shut);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('resize', shut); };
  }, [anchor, onClose]);
  if (!anchor) return null;

  const W = Math.min(ACCOUNT_MENU_WIDTH, width - 16);
  const left = Math.max(8, Math.min(rtl ? anchor.x + anchor.w - W : anchor.x, width - W - 8));
  const bottom = Math.max(8, height - anchor.y + 8);
  const name = (profile?.name || '').trim() || fallbackName;
  const sub = profile?.title || profile?.email || profile?.username || t('ac.administrator');
  const credits = profile?.credits;
  const unlimited = credits == null;
  const run = (fn: () => void) => () => { onClose(); setTimeout(fn, 0); };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={[style, { flex: 1, direction: rtl ? 'rtl' : 'ltr' } as ViewStyle]}>
        <Pressable accessibilityLabel="close" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View testID="account-menu" accessibilityRole="menu" className="bg-surface border border-line rounded-3xl overflow-hidden"
          style={{ position: 'absolute', left, bottom, width: W, maxHeight: height - 24, boxShadow: '0 18px 48px rgba(0,0,0,0.32)' } as ViewStyle}>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {/* who */}
            <Pressable testID="account-menu-profile" accessibilityRole="button" accessibilityLabel={t('ac.account')} onPress={run(() => onGo('/admin/account'))}
              className="flex-row items-center hover:bg-surface2 active:bg-surface2" style={{ padding: 14, gap: 12 }}>
              <AdminAvatar name={name} uri={profile?.avatar} size={46} />
              <View className="flex-1" style={{ minWidth: 0 }}>
                <Txt numberOfLines={1} className="font-black text-[15px]">{name}</Txt>
                <Txt numberOfLines={1} className="text-muted text-[12px]">{sub}</Txt>
              </View>
              <Icon name="chevron-right" size={20} tone="muted" flip />
            </Pressable>

            {/* credits */}
            <View testID="account-menu-credits" className="mx-3.5 mb-3 flex-row items-center rounded-2xl bg-soft" style={{ paddingHorizontal: 12, height: 44, gap: 10 }}>
              <Icon name="star-circle-outline" size={21} tone="primary" />
              <Txt numberOfLines={1} className="flex-1 font-extrabold text-[14px]">{unlimited ? t('ac.creditsUnlimited') : t('ac.credits', { n: credits })}</Txt>
              {unlimited ? <Icon name="infinity" size={20} tone="primary" /> : null}
            </View>

            {/* language */}
            <View className="mx-3.5 mb-3" style={{ gap: 8 }}>
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <Icon name="translate" size={16} tone="muted" />
                <Txt className="text-muted text-[11px] font-extrabold uppercase" style={{ letterSpacing: 1 }}>{t('ac.language')}</Txt>
              </View>
              <View testID="account-menu-lang" accessibilityRole="radiogroup" className="flex-row bg-surface2 rounded-2xl p-1" style={{ gap: 4 }}>
                {LANGS.map((l) => {
                  const on = lang === l;
                  return (
                    <Pressable key={l} testID={`account-lang-${l}`} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={LANG_SHORT[l]} onPress={() => useLang.getState().set(l)}
                      className={`flex-1 items-center justify-center rounded-xl ${on ? 'bg-ink' : ''}`} style={{ height: 36, minWidth: 0 }}>
                      <Txt numberOfLines={1} className={`text-[13px] font-bold ${on ? 'text-onink' : ''}`}>{LANG_SHORT[l]}</Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: colors.line, marginHorizontal: 14 }} />
            <View style={{ paddingVertical: 6 }}>
              <Entry id="account" icon="account-cog-outline" label={t('ac.account')} onPress={run(() => onGo('/admin/account'))} />
              <Entry id="settings-map" icon="tune-variant" label={t('ac.settingsMap')} onPress={run(() => onGo('/admin/settings'))} />
              <Entry id="open-app" icon="open-in-new" label={t('admin.openApp')} onPress={run(onOpenApp)} />
            </View>
            <View style={{ height: 1, backgroundColor: colors.line, marginHorizontal: 14 }} />
            <View style={{ paddingVertical: 6 }}>
              <Entry id="logout" icon="logout" label={t('admin.logout')} danger onPress={run(onLogout)} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
