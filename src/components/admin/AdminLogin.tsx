import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from '@/hooks/useLeaveGuard';
import { useBp } from '@/hooks/useBp';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { Txt, useAppFont } from '@/components/ui/Txt';
import { backendEnabled, backendHandoff } from '@/lib/backend';
import { services } from '@/data/repositories';
import { LANGS, useLang, useT } from '@/i18n';
import { ADMIN_LOGIN, USER_LOGIN, safeNext } from '@/lib/loginRoutes';
import { useLocal } from '@/store/useLocal';
import { refreshAdminSession } from '@/lib/sync';
import { useIsAdmin, useStore } from '@/store/useStore';
import { useTheme } from '@/theme/ThemeProvider';

/** Error banner: an opaque, fixed pair (white on deep red, 6.5:1). The themes' own danger token is a mid red (3.9:1 with white), so it is not used for text backgrounds. */
const ERROR_BG = '#B42318';

const LANG_SHORT: Record<string, string> = { dar: 'الدارجة', ar: 'العربية', fr: 'Français' };

/**
 * Colours of this page come ONLY from the store theme tokens, in pairs `npm run check:themes` checks (fg/bg, muted/bg, muted/surface2,
 * onink/ink, onprimary/primary, white/ERROR_BG). Nothing here is a fixed white or black with transparency: that is what made the page
 * unreadable (washed-out fields, invisible labels) in every light theme.
 */

/** One field: label above, optional trailing control (the eye). */
function Field({ label, icon, trailing, testID, inputRef, ...p }: React.ComponentProps<typeof TextInput> & { label: string; icon: string; trailing?: React.ReactNode; testID: string; inputRef?: React.Ref<TextInput> }) {
  const { colors } = useTheme();
  const fontFamily = useAppFont();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Txt className="text-[12px] font-bold uppercase text-muted" style={{ letterSpacing: 1 }}>{label}</Txt>
      <View className="flex-row items-center rounded-2xl" style={{ height: 52, paddingHorizontal: 14, gap: 10, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: focus ? colors.ink : colors.line }}>
        <Icon name={icon} size={19} color={colors.muted} />
        <TextInput ref={inputRef} testID={testID} accessibilityLabel={label} placeholderTextColor={colors.muted} selectionColor={colors.primary} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} {...p}
          style={[{ flex: 1, minWidth: 0, height: 50, fontSize: 16, fontFamily, color: colors.fg, textAlign: undefined, outlineStyle: 'none' } as never, p.style]} />
        {trailing}
      </View>
    </View>
  );
}

/** Administrator sign-in (route /admin/login): its own page, independent from the client sign-in at /login. Also receives the Super Admin hand-off (?handoff=). */
export function AdminLogin() {
  const { t, lang, rtl } = useT();
  const { colors } = useTheme();
  const { tablet } = useBp();
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string; handoff?: string }>();
  const next = safeNext(params.next, 'admin');
  const handoff = typeof params.handoff === 'string' && /^[a-f0-9]{64}$/.test(params.handoff) ? params.handoff : '';
  const session = useLocal((s) => s.adminSession);
  const isAdmin = useIsAdmin();
  const brand = useStore((s) => s.doc.branding.appName);
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [shown, setShown] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [caps, setCaps] = useState(false);
  const [opening, setOpening] = useState(!!handoff && backendEnabled);
  const pwRef = useRef<TextInput>(null);
  const redeemed = useRef(false);
  const forbidden = session && !isAdmin;

  const enter = async () => {
    useLocal.getState().set({ adminSession: true });
    if (backendEnabled) { useStore.setState({ adminLoaded: false }); await Promise.all([refreshAdminSession(), useStore.getState().loadAdminData()]); }
  };

  // The console opened this page with a one-time code: it is spent once (also under React strict mode) and removed from the address bar.
  useEffect(() => {
    if (!handoff || !backendEnabled || redeemed.current) return;
    redeemed.current = true;
    void (async () => {
      const ok = await backendHandoff(handoff);
      if (ok) await enter();
      else { setErr(t('ac.handoffFailed')); setOpening(false); router.replace(ADMIN_LOGIN as never); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  if (session && isAdmin) return <Redirect href={next as never} />;

  const submit = async () => {
    if (busy) return;
    if (!id.trim() || !pw) { setErr(t('ac.adminInvalid')); return; }
    setBusy(true); setErr('');
    const r = await services.auth.loginAdmin(id, pw);
    if (!r.ok) { setBusy(false); setErr(t(r.reason === 'limited' ? 'ac.adminLimited' : r.reason === 'unreachable' ? 'ac.adminOfflineErr' : 'ac.adminInvalid')); return; }
    await enter();
    setBusy(false);
  };

  // Brand block: on the tablet side panel it sits on `ink` (text `onink`), on a phone directly on the page (text `fg`).
  const onPanel = tablet;
  const strong = onPanel ? colors.onink : colors.fg;
  const soft = onPanel ? colors.onink : colors.muted;
  const hero = (
    <View className="flex-1 justify-between" style={{ padding: tablet ? 48 : 0, gap: 24 }}>
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View className="w-12 h-12 rounded-2xl bg-primary items-center justify-center"><Txt className="font-black text-[22px] text-onprimary">{(brand || 'D').trim().charAt(0).toUpperCase()}</Txt></View>
        <View style={{ flexShrink: 1 }}><Txt numberOfLines={1} className="font-black text-[19px]" style={{ letterSpacing: -0.3, color: strong }}>{brand}</Txt><Txt className="text-[11px] font-bold uppercase" style={{ letterSpacing: 1.2, color: soft }}>{t('ac.adminTag')}</Txt></View>
      </View>
      {tablet ? (
        <View style={{ gap: 18 }}>
          {[['view-dashboard-outline', 'dx.shell.pending'], ['message-text-outline', 'admin.nav.chats'], ['palette-outline', 'admin.nav.theme']].map(([icon, key]) => (
            <View key={key} className="flex-row items-center" style={{ gap: 14 }}>
              <View className="w-11 h-11 rounded-2xl items-center justify-center bg-primary"><Icon name={icon} size={22} color={colors.onprimary} /></View>
              <Txt className="text-[16px] font-semibold" style={{ color: colors.onink }}>{t(key)}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      {tablet ? <View className="flex-row items-center" style={{ gap: 8 }}><Icon name="shield-check-outline" size={16} color={colors.onink} /><Txt className="text-[12px]" style={{ color: colors.onink }}>{t('ac.secure')}</Txt></View> : null}
    </View>
  );

  if (opening) {
    return (
      <View testID="admin-login" className="flex-1 bg-bg items-center justify-center" style={{ padding: 24, gap: 16 }}>
        <Spinner size={40} />
        <Txt testID="admin-handoff-opening" className="font-bold text-[15px]">{t('ac.handoffOpening')}</Txt>
      </View>
    );
  }

  return (
    <View testID="admin-login" className="flex-1 bg-bg" style={{ flexDirection: tablet ? 'row' : 'column' }}>
      {tablet ? <View className="bg-ink" style={{ flex: 1, maxWidth: 560 }}>{hero}</View> : null}
      <View className="flex-1 items-center justify-center" style={{ padding: tablet ? 32 : 20 }}>
        <Animated.View entering={FadeInDown.duration(380)} style={{ width: '100%', maxWidth: 420, gap: 18 }}>
          {!tablet ? <View style={{ marginBottom: 6 }}>{hero}</View> : null}
          {/* language fast-select */}
          <View accessibilityRole="radiogroup" className="flex-row self-end rounded-full p-1 bg-surface2" style={{ gap: 2 }}>
            {LANGS.map((l) => (
              <Pressable key={l} testID={`login-lang-${l}`} accessibilityRole="radio" accessibilityState={{ selected: lang === l }} onPress={() => useLang.getState().set(l)} className="rounded-full items-center justify-center" style={{ height: 30, paddingHorizontal: 12, backgroundColor: lang === l ? colors.ink : 'transparent' }}>
                <Txt className="text-[12px] font-bold" style={{ color: lang === l ? colors.onink : colors.muted }}>{LANG_SHORT[l]}</Txt>
              </Pressable>
            ))}
          </View>
          <View style={{ gap: 6 }}>
            <Txt accessibilityRole="header" className="text-fg text-[28px] font-black" style={{ letterSpacing: -0.6 }}>{t('ac.adminTitle')}</Txt>
            <Txt className="text-muted text-[14px]">{forbidden ? t('ac.adminForbidden') : t('ac.adminSub')}</Txt>
          </View>
          <View style={{ gap: 14 }}>
            <Field testID="admin-email" label={t('ac.adminId')} icon="account-outline" placeholder={t('ac.adminIdPh')} value={id} onChangeText={(v) => { setId(v); setErr(''); }}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="username" returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()} />
            <Field testID="admin-password" inputRef={pwRef} label={t('admin.password')} icon="lock-outline" value={pw} onChangeText={(v) => { setPw(v); setErr(''); }} secureTextEntry={!shown}
              autoCapitalize="none" autoComplete="current-password" returnKeyType="go" onSubmitEditing={submit}
              {...(Platform.OS === 'web' ? ({ onKeyUp: (e: any) => setCaps(!!e.getModifierState?.('CapsLock')) } as object) : {})}
              trailing={<Pressable testID="admin-password-eye" accessibilityRole="button" accessibilityLabel={shown ? t('ac.hide') : t('ac.show')} onPress={() => setShown((x) => !x)} hitSlop={8}><Icon name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} /></Pressable>} />
            {caps ? <View className="flex-row items-center" style={{ gap: 6 }}><Icon name="apple-keyboard-caps" size={16} tone="fg" /><Txt className="text-[12px] font-semibold text-fg">Caps Lock</Txt></View> : null}
          </View>
          {err ? <View testID="admin-login-error" accessibilityRole="alert" className="flex-row items-center rounded-2xl" style={{ gap: 8, padding: 12, backgroundColor: ERROR_BG }}><Icon name="alert-circle-outline" size={18} color="#FFFFFF" /><Txt className="flex-1 text-[13px] font-semibold" style={{ color: '#FFFFFF' }}>{err}</Txt></View> : null}
          <Pressable testID="admin-signin" accessibilityRole="button" accessibilityLabel={t('ac.adminSignIn')} disabled={busy} onPress={submit} className="bg-primary rounded-2xl flex-row items-center justify-center active:opacity-85" style={{ height: 54, gap: 10, opacity: busy ? 0.8 : 1 }}>
            {busy ? <Spinner size={22} /> : <Icon name={rtl ? 'arrow-left' : 'arrow-right'} size={20} tone="onprimary" />}
            <Txt className="text-onprimary font-extrabold text-[16px]">{t('ac.adminSignIn')}</Txt>
          </Pressable>
          {!backendEnabled ? <Txt className="text-muted text-center text-[12px]">{t('ac.adminDemo')}</Txt> : null}
          <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 10 }}>
            <Pressable testID="admin-back-app" accessibilityRole="link" onPress={() => router.replace('/')} className="flex-row items-center" style={{ gap: 6 }}><Icon name={rtl ? 'arrow-right' : 'arrow-left'} size={16} tone="fg" /><Txt className="text-fg text-[13px] font-semibold">{t('ac.backToApp')}</Txt></Pressable>
            <Pressable testID="admin-to-user" accessibilityRole="link" onPress={() => router.replace(USER_LOGIN as never)}><Txt className="text-muted text-[13px] font-semibold">{t('ac.adminToUser')}</Txt></Pressable>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}
