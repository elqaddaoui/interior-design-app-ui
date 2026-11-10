import React, { useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from '@/hooks/useLeaveGuard';
import { useBp } from '@/hooks/useBp';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { Txt, useAppFont } from '@/components/ui/Txt';
import { backendEnabled } from '@/lib/backend';
import { services } from '@/data/repositories';
import { LANGS, useLang, useT } from '@/i18n';
import { USER_LOGIN, safeNext } from '@/lib/loginRoutes';
import { useLocal } from '@/store/useLocal';
import { refreshAdminSession } from '@/lib/sync';
import { useIsAdmin, useStore } from '@/store/useStore';
import { useTheme } from '@/theme/ThemeProvider';

const LANG_SHORT: Record<string, string> = { dar: 'الدارجة', ar: 'العربية', fr: 'Français' };

/** One dark field: label above, optional trailing control (the eye). */
function DarkField({ label, icon, trailing, testID, inputRef, ...p }: React.ComponentProps<typeof TextInput> & { label: string; icon: string; trailing?: React.ReactNode; testID: string; inputRef?: React.Ref<TextInput> }) {
  const { colors } = useTheme();
  const fontFamily = useAppFont();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Txt className="text-[12px] font-bold uppercase text-onink" style={{ letterSpacing: 1, opacity: 0.7 }}>{label}</Txt>
      <View className="flex-row items-center rounded-2xl" style={{ height: 52, paddingHorizontal: 14, gap: 10, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1.5, borderColor: focus ? colors.primary : 'rgba(255,255,255,0.12)' }}>
        <Icon name={icon} size={19} color="rgba(255,255,255,0.6)" />
        <TextInput ref={inputRef} testID={testID} accessibilityLabel={label} placeholderTextColor="rgba(255,255,255,0.35)" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} {...p}
          style={[{ flex: 1, minWidth: 0, height: 50, fontSize: 16, fontFamily, color: '#FFFFFF', textAlign: undefined, outlineStyle: 'none' } as never, p.style]} />
        {trailing}
      </View>
    </View>
  );
}

/** Administrator sign-in (route /admin/login): its own dark page, independent from the client sign-in at /login. */
export function AdminLogin() {
  const { t, lang, rtl } = useT();
  const { tablet } = useBp();
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(params.next, 'admin');
  const session = useLocal((s) => s.adminSession);
  const isAdmin = useIsAdmin();
  const brand = useStore((s) => s.doc.branding.appName);
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [shown, setShown] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [caps, setCaps] = useState(false);
  const pwRef = useRef<TextInput>(null);
  const forbidden = session && !isAdmin;

  if (session && isAdmin) return <Redirect href={next as never} />;

  const submit = async () => {
    if (busy) return;
    if (!id.trim() || !pw) { setErr(t('ac.adminInvalid')); return; }
    setBusy(true); setErr('');
    const r = await services.auth.loginAdmin(id, pw);
    if (!r.ok) { setBusy(false); setErr(t(r.reason === 'limited' ? 'ac.adminLimited' : r.reason === 'unreachable' ? 'ac.adminOfflineErr' : r.reason === 'maintenance' ? 'sx.bn.maintenance' : r.reason === 'suspended' ? 'sx.bn.suspended' : r.reason === 'disabled' ? 'sx.bn.disabled' : 'ac.adminInvalid')); return; }
    useLocal.getState().set({ adminSession: true });
    if (backendEnabled) { useStore.setState({ adminLoaded: false }); await Promise.all([refreshAdminSession(), useStore.getState().loadAdminData()]); }
    setBusy(false);
  };

  const hero = (
    <View className="flex-1 justify-between" style={{ padding: tablet ? 48 : 0, gap: 24 }}>
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View className="w-12 h-12 rounded-2xl bg-primary items-center justify-center"><Txt className="font-black text-[22px] text-onprimary">{(brand || 'D').trim().charAt(0).toUpperCase()}</Txt></View>
        <View><Txt className="font-black text-[19px] text-onink" style={{ letterSpacing: -0.3 }}>{brand}</Txt><Txt className="text-[11px] font-bold uppercase text-onink" style={{ letterSpacing: 1.2, opacity: 0.6 }}>{t('ac.adminTag')}</Txt></View>
      </View>
      {tablet ? (
        <View style={{ gap: 18 }}>
          {[['view-dashboard-outline', 'dx.shell.pending'], ['message-text-outline', 'admin.nav.chats'], ['palette-outline', 'admin.nav.theme']].map(([icon, key]) => (
            <View key={key} className="flex-row items-center" style={{ gap: 14 }}>
              <View className="w-11 h-11 rounded-2xl items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}><Icon name={icon} size={22} color="#FFFFFF" /></View>
              <Txt className="text-onink text-[16px] font-semibold" style={{ opacity: 0.85 }}>{t(key)}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      {tablet ? <View className="flex-row items-center" style={{ gap: 8 }}><Icon name="shield-check-outline" size={16} color="rgba(255,255,255,0.6)" /><Txt className="text-onink text-[12px]" style={{ opacity: 0.6 }}>{t('ac.secure')}</Txt></View> : null}
    </View>
  );

  return (
    <View testID="admin-login" className="flex-1 bg-ink" style={{ flexDirection: tablet ? 'row' : 'column' }}>
      {tablet ? <View style={{ flex: 1, maxWidth: 560 }}>{hero}</View> : null}
      <View className="flex-1 items-center justify-center" style={{ padding: tablet ? 32 : 20, backgroundColor: tablet ? 'rgba(255,255,255,0.04)' : undefined }}>
        <Animated.View entering={FadeInDown.duration(380)} style={{ width: '100%', maxWidth: 420, gap: 18 }}>
          {!tablet ? <View style={{ marginBottom: 6 }}>{hero}</View> : null}
          {/* language fast-select */}
          <View accessibilityRole="radiogroup" className="flex-row self-end rounded-full p-1" style={{ gap: 2, backgroundColor: 'rgba(255,255,255,0.08)' }}>
            {LANGS.map((l) => (
              <Pressable key={l} testID={`login-lang-${l}`} accessibilityRole="radio" accessibilityState={{ selected: lang === l }} onPress={() => useLang.getState().set(l)} className="rounded-full items-center justify-center" style={{ height: 30, paddingHorizontal: 12, backgroundColor: lang === l ? '#FFFFFF' : 'transparent' }}>
                <Txt className="text-[12px] font-bold" style={{ color: lang === l ? '#111111' : 'rgba(255,255,255,0.8)' }}>{LANG_SHORT[l]}</Txt>
              </Pressable>
            ))}
          </View>
          <View style={{ gap: 6 }}>
            <Txt accessibilityRole="header" className="text-onink text-[28px] font-black" style={{ letterSpacing: -0.6 }}>{t('ac.adminTitle')}</Txt>
            <Txt className="text-onink text-[14px]" style={{ opacity: 0.7 }}>{forbidden ? t('ac.adminForbidden') : t('ac.adminSub')}</Txt>
          </View>
          <View style={{ gap: 14 }}>
            <DarkField testID="admin-email" label={t('ac.adminId')} icon="account-outline" placeholder={t('ac.adminIdPh')} value={id} onChangeText={(v) => { setId(v); setErr(''); }}
              autoCapitalize="none" autoCorrect={false} keyboardType="default" autoComplete="username" returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()} />
            <DarkField testID="admin-password" inputRef={pwRef} label={t('admin.password')} icon="lock-outline" value={pw} onChangeText={(v) => { setPw(v); setErr(''); }} secureTextEntry={!shown}
              autoCapitalize="none" autoComplete="current-password" returnKeyType="go" onSubmitEditing={submit}
              {...(Platform.OS === 'web' ? ({ onKeyUp: (e: any) => setCaps(!!e.getModifierState?.('CapsLock')) } as object) : {})}
              trailing={<Pressable testID="admin-password-eye" accessibilityRole="button" accessibilityLabel={shown ? t('ac.hide') : t('ac.show')} onPress={() => setShown((s) => !s)} hitSlop={8}><Icon name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color="rgba(255,255,255,0.7)" /></Pressable>} />
            {caps ? <View className="flex-row items-center" style={{ gap: 6 }}><Icon name="apple-keyboard-caps" size={16} color="#F5C451" /><Txt className="text-[12px]" style={{ color: '#F5C451' }}>Caps Lock</Txt></View> : null}
          </View>
          {err ? <View testID="admin-login-error" accessibilityRole="alert" className="flex-row items-center rounded-2xl" style={{ gap: 8, padding: 12, backgroundColor: 'rgba(255,90,90,0.14)' }}><Icon name="alert-circle-outline" size={18} color="#FF8A8A" /><Txt className="flex-1 text-[13px] font-semibold" style={{ color: '#FFB3B3' }}>{err}</Txt></View> : null}
          <Pressable testID="admin-signin" accessibilityRole="button" accessibilityLabel={t('ac.adminSignIn')} disabled={busy} onPress={submit} className="bg-primary rounded-2xl flex-row items-center justify-center active:opacity-85" style={{ height: 54, gap: 10, opacity: busy ? 0.8 : 1 }}>
            {busy ? <Spinner size={22} /> : <Icon name={rtl ? 'arrow-left' : 'arrow-right'} size={20} tone="onprimary" />}
            <Txt className="text-onprimary font-extrabold text-[16px]">{t('ac.adminSignIn')}</Txt>
          </Pressable>
          {!backendEnabled ? <Txt className="text-onink text-center text-[12px]" style={{ opacity: 0.55 }}>{t('ac.adminDemo')}</Txt> : null}
          <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 10 }}>
            <Pressable testID="admin-back-app" accessibilityRole="link" onPress={() => router.replace('/')} className="flex-row items-center" style={{ gap: 6 }}><Icon name={rtl ? 'arrow-right' : 'arrow-left'} size={16} color="rgba(255,255,255,0.7)" /><Txt className="text-onink text-[13px] font-semibold" style={{ opacity: 0.8 }}>{t('ac.backToApp')}</Txt></Pressable>
            <Pressable testID="admin-to-user" accessibilityRole="link" onPress={() => router.replace(USER_LOGIN as never)}><Txt className="text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>{t('ac.adminToUser')}</Txt></Pressable>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}
