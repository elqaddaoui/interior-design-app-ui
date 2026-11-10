import React, { useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useBp } from '@/hooks/useBp';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { Txt } from '@/components/ui/Txt';
import { DarkField, LANG_SHORT } from '@/components/admin/AdminLogin';
import { backendEnabled } from '@/lib/backend';
import { LANGS, useLang } from '@/i18n';
import { useSuperAdmin } from '@/store/useSuperAdmin';
import { useStore } from '@/store/useStore';
import { useSa } from './ui';

/** Super Admin sign-in (route /superadmin): its own dark page, independent from the administrator and client sign-ins. */
export function SaLogin() {
  const { t, lang, rtl } = useSa();
  const { tablet } = useBp();
  const router = useRouter();
  const brand = useStore((s) => s.doc.branding.appName);
  const signIn = useSuperAdmin((s) => s.signIn);
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [shown, setShown] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [caps, setCaps] = useState(false);
  const pwRef = useRef<TextInput>(null);

  const submit = async () => {
    if (busy) return;
    if (!id.trim() || !pw) { setErr(t('invalid')); return; }
    setBusy(true); setErr('');
    const r = await signIn(id, pw);
    setBusy(false);
    if (!r.ok) setErr(t(r.code === 'TOO_MANY_ATTEMPTS' ? 'limited' : r.code === 'BACKEND_UNAVAILABLE' ? 'offline' : 'invalid'));
  };

  const hero = (
    <View className="flex-1 justify-between" style={{ padding: tablet ? 48 : 0, gap: 24 }}>
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View className="w-12 h-12 rounded-2xl bg-primary items-center justify-center"><Icon name="shield-account-outline" size={26} tone="onprimary" /></View>
        <View><Txt className="font-black text-[19px] text-onink" style={{ letterSpacing: -0.3 }}>{brand}</Txt><Txt className="text-[11px] font-bold uppercase text-onink" style={{ letterSpacing: 1.2, opacity: 0.6 }}>{t('tag')}</Txt></View>
      </View>
      {tablet ? (
        <View style={{ gap: 18 }}>
          {[['shield-key-outline', 'heroA'], ['domain', 'heroB'], ['clipboard-text-clock-outline', 'heroC']].map(([icon, key]) => (
            <View key={key} className="flex-row items-center" style={{ gap: 14 }}>
              <View className="w-11 h-11 rounded-2xl items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}><Icon name={icon} size={22} color="#FFFFFF" /></View>
              <Txt className="text-onink text-[16px] font-semibold" style={{ opacity: 0.85 }}>{t(key)}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      {tablet ? <View className="flex-row items-center" style={{ gap: 8 }}><Icon name="shield-check-outline" size={16} color="rgba(255,255,255,0.6)" /><Txt className="text-onink text-[12px]" style={{ opacity: 0.6 }}>{t('secure')}</Txt></View> : null}
    </View>
  );

  return (
    <View testID="sa-login" className="flex-1 bg-ink" style={{ flexDirection: tablet ? 'row' : 'column' }}>
      {tablet ? <View style={{ flex: 1, maxWidth: 560 }}>{hero}</View> : null}
      <View className="flex-1 items-center justify-center" style={{ padding: tablet ? 32 : 20, backgroundColor: tablet ? 'rgba(255,255,255,0.04)' : undefined }}>
        <Animated.View entering={FadeInDown.duration(380)} style={{ width: '100%', maxWidth: 420, gap: 18 }}>
          {!tablet ? <View style={{ marginBottom: 6 }}>{hero}</View> : null}
          <View accessibilityRole="radiogroup" className="flex-row self-end rounded-full p-1" style={{ gap: 2, backgroundColor: 'rgba(255,255,255,0.08)' }}>
            {LANGS.map((l) => (
              <Pressable key={l} testID={`sa-login-lang-${l}`} accessibilityRole="radio" accessibilityState={{ selected: lang === l }} onPress={() => useLang.getState().set(l)} className="rounded-full items-center justify-center" style={{ height: 30, paddingHorizontal: 12, backgroundColor: lang === l ? '#FFFFFF' : 'transparent' }}>
                <Txt className="text-[12px] font-bold" style={{ color: lang === l ? '#111111' : 'rgba(255,255,255,0.8)' }}>{LANG_SHORT[l]}</Txt>
              </Pressable>
            ))}
          </View>
          <View style={{ gap: 6 }}>
            <Txt accessibilityRole="header" className="text-onink text-[28px] font-black" style={{ letterSpacing: -0.6 }}>{t('loginTitle')}</Txt>
            <Txt className="text-onink text-[14px]" style={{ opacity: 0.7 }}>{t('loginSub')}</Txt>
          </View>
          <View style={{ gap: 14 }}>
            <DarkField testID="sa-username-input" label={t('username')} icon="account-outline" placeholder={t('usernamePh')} value={id} onChangeText={(v) => { setId(v); setErr(''); }}
              autoCapitalize="none" autoCorrect={false} autoComplete="username" returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()} />
            <DarkField testID="sa-password-input" inputRef={pwRef} label={t('password')} icon="lock-outline" value={pw} onChangeText={(v) => { setPw(v); setErr(''); }} secureTextEntry={!shown}
              autoCapitalize="none" autoComplete="current-password" returnKeyType="go" onSubmitEditing={submit}
              {...(Platform.OS === 'web' ? ({ onKeyUp: (e: { getModifierState?: (k: string) => boolean }) => setCaps(!!e.getModifierState?.('CapsLock')) } as object) : {})}
              trailing={<Pressable testID="sa-password-eye" accessibilityRole="button" accessibilityLabel={shown ? t('hide') : t('show')} onPress={() => setShown((s) => !s)} hitSlop={8}><Icon name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color="rgba(255,255,255,0.7)" /></Pressable>} />
            {caps ? <View className="flex-row items-center" style={{ gap: 6 }}><Icon name="apple-keyboard-caps" size={16} color="#F5C451" /><Txt className="text-[12px]" style={{ color: '#F5C451' }}>Caps Lock</Txt></View> : null}
          </View>
          {err ? <View testID="sa-login-error" accessibilityRole="alert" className="flex-row items-center rounded-2xl" style={{ gap: 8, padding: 12, backgroundColor: 'rgba(255,90,90,0.14)' }}><Icon name="alert-circle-outline" size={18} color="#FF8A8A" /><Txt className="flex-1 text-[13px] font-semibold" style={{ color: '#FFB3B3' }}>{err}</Txt></View> : null}
          <Pressable testID="sa-signin" accessibilityRole="button" accessibilityLabel={t('signIn')} disabled={busy} onPress={submit} className="bg-primary rounded-2xl flex-row items-center justify-center active:opacity-85" style={{ height: 54, gap: 10, opacity: busy ? 0.8 : 1 }}>
            {busy ? <Spinner size={22} /> : <Icon name={rtl ? 'arrow-left' : 'arrow-right'} size={20} tone="onprimary" />}
            <Txt className="text-onprimary font-extrabold text-[16px]">{t('signIn')}</Txt>
          </Pressable>
          {!backendEnabled ? <Txt className="text-onink text-center text-[12px]" style={{ opacity: 0.55 }}>{t('demo')}</Txt> : null}
          <Pressable testID="sa-back-app" accessibilityRole="link" onPress={() => router.replace('/')} className="flex-row items-center self-start" style={{ gap: 6 }}>
            <Icon name={rtl ? 'arrow-right' : 'arrow-left'} size={16} color="rgba(255,255,255,0.7)" /><Txt className="text-onink text-[13px] font-semibold" style={{ opacity: 0.8 }}>{t('backToApp')}</Txt>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}
