import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { router } from '@/hooks/useLeaveGuard';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/StepHeader';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { BackendError, backendEnabled, isBackendUnavailable } from '@/lib/backend';
import { ADMIN_LOGIN, safeNext } from '@/lib/loginRoutes';
import { cleanPhone, validPhone } from '@/lib/share';
import { LANGS, useLang, useT } from '@/i18n';
import { reloadUserSpace } from '@/store/useStore';
import { toast } from '@/store/useToast';
import { useUserSession } from '@/store/useUserSession';

/** Client sign-in (route /login): name + WhatsApp number, no password. A friendly light page, separate from /admin/login. */
export default function UserLogin() {
  const { t, lang } = useT();
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(params.next, 'user');
  const me = useUserSession((s) => s.user);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState<{ n?: string; p?: string; f?: string }>({});
  const [busy, setBusy] = useState(false);

  if (me) return <Redirect href={next as never} />;

  const submit = async () => {
    if (busy) return;
    const e: typeof err = {};
    if (name.trim().length < 2) e.n = t('lead.errName');
    if (!validPhone(phone)) e.p = t('lead.errPhone');
    setErr(e);
    if (e.n || e.p) return;
    if (!backendEnabled) { setErr({ f: t('account.unavailable') }); return; }
    setBusy(true);
    try {
      const user = await useUserSession.getState().login(name.trim(), cleanPhone(phone));
      await reloadUserSpace();
      toast(t('ac.userDone', { name: user.name }));
      router.replace(next as never);
    } catch (error) {
      setErr({ f: t(error instanceof BackendError && error.code === 'ACCOUNT_BLOCKED' ? 'account.blocked' : isBackendUnavailable(error) ? 'account.unavailable' : 'account.loginError') });
    } finally { setBusy(false); }
  };

  return (
    <Screen max={480} header={<PageHeader title="" onBack={() => router.back()} />}
      footer={<Button testID="login-submit" title={t('ac.userSignIn')} icon="whatsapp" onPress={submit} loading={busy} full size="lg" />}>
      <View testID="user-login" className="items-center pt-2 pb-6">
        <Animated.View entering={ZoomIn.duration(380)} className="w-20 h-20 rounded-full bg-[#25D366] items-center justify-center mb-5"><Icon name="whatsapp" size={42} color="#fff" /></Animated.View>
        <Animated.View entering={FadeInDown.delay(100)} className="items-center">
          <Txt accessibilityRole="header" className="text-[26px] font-black text-center">{t('ac.userTitle')}</Txt>
          <Txt className="text-muted text-[15px] text-center mt-2 leading-[22px]">{t('ac.userSub')}</Txt>
        </Animated.View>
      </View>
      <Animated.View entering={FadeInDown.delay(200)}>
        <Input testID="login-name" label={t('lead.name')} placeholder={t('lead.namePh')} value={name} onChangeText={(v) => { setName(v); setErr((x) => ({ ...x, n: undefined, f: undefined })); }} error={err.n} autoComplete="name" returnKeyType="next" />
        <Input testID="login-phone" label={t('lead.whatsapp')} placeholder={t('lead.whatsappPh')} value={phone} onChangeText={(v) => { setPhone(v); setErr((x) => ({ ...x, p: undefined, f: undefined })); }} error={err.p} keyboardType="phone-pad" autoComplete="tel" returnKeyType="go" onSubmitEditing={submit} />
        {err.f ? <View testID="login-error" accessibilityRole="alert" className="flex-row items-center bg-soft rounded-2xl p-3 mb-3 border border-danger" style={{ gap: 8 }}><Icon name="alert-circle-outline" size={18} tone="danger" /><Txt className="flex-1 text-[13px] font-semibold">{err.f}</Txt></View> : null}
        <View className="flex-row items-center mt-1" style={{ gap: 8 }}><Icon name="lock-outline" size={14} tone="muted" /><Txt className="text-muted text-[12px] flex-1">{t('ac.userNoPassword')} {t('lead.privacy')}</Txt></View>
        <View className="flex-row self-center bg-surface2 rounded-full p-1 mt-6" style={{ gap: 2 }}>
          {LANGS.map((l) => (
            <Pressable key={l} testID={`user-login-lang-${l}`} accessibilityRole="radio" accessibilityState={{ selected: lang === l }} onPress={() => useLang.getState().set(l)} className={`rounded-full items-center justify-center px-3 ${lang === l ? 'bg-primary' : ''}`} style={{ height: 32 }}>
              <Txt className={`text-[12px] font-bold ${lang === l ? 'text-onprimary' : ''}`}>{t(`lang.${l}`)}</Txt>
            </Pressable>
          ))}
        </View>
        <Pressable testID="user-to-admin" accessibilityRole="link" onPress={() => router.replace(ADMIN_LOGIN as never)} className="self-center mt-5 py-2"><Txt className="text-muted text-[13px] font-semibold">{t('ac.userAdminLink')}</Txt></Pressable>
      </Animated.View>
    </Screen>
  );
}
