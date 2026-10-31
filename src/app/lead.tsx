import { useViewState } from '@/hooks/useViewState';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { toast } from '@/store/useToast';
import { useUserSession } from '@/store/useUserSession';
import { backendEnabled, BackendError, isBackendUnavailable } from '@/lib/backend';
import { useWizardGuard } from '@/hooks/useWizardGuard';
import { reloadUserSpace } from '@/store/useStore';
import { useWizard, wizardReady } from '@/store/useWizard';
import { useT } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/StepHeader';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { cleanPhone, validPhone } from '@/lib/share';
import { needsPro } from '@/lib/credits';

/** First free render: ask for Name + WhatsApp. Creates a Render Request for the admin. */
export default function Lead() {
  const { t } = useT();
  const me = useUserSession(s => s.user);
  useWizardGuard();
  const w = useWizard();
  const [name, setName] = useViewState('name', me?.name ?? '');
  const [phone, setPhone] = useViewState('phone', me?.whatsapp ?? '');
  const [err, setErr] = useState<{ n?: string; p?: string }>({});
  const [busy, setBusy] = useState(false);

  if (!wizardReady(w)) return <Redirect href="/" />;

  const submit = async () => {
    const e: typeof err = {};
    if (name.trim().length < 2) e.n = t('lead.errName');
    if (!validPhone(phone)) e.p = t('lead.errPhone');
    setErr(e);
    if (e.n || e.p) return;
    setBusy(true);
    const whatsapp = cleanPhone(phone);
    try {
      if (!backendEnabled) { toast(t('account.unavailable')); return; }
      const user = await useUserSession.getState().login(name.trim(), whatsapp);
      await reloadUserSpace();
      if (!user.freeUsed) w.setLead({ name: user.name, whatsapp: user.whatsapp });
      if (needsPro(user)) router.replace({ pathname: '/pro', params: { generation: '1' } });
      else router.replace('/render');
    } catch (error) { toast(t(error instanceof BackendError && error.code === 'ACCOUNT_BLOCKED' ? 'account.blocked' : isBackendUnavailable(error) ? 'account.unavailable' : 'account.loginError')); }
    finally { setBusy(false); }
  };

  return (
    <Screen max={520} header={<PageHeader title="" onBack={() => router.back()} />}
      footer={<Button testID="lead-submit" title={t('lead.submit')} icon="whatsapp" onPress={submit} loading={busy} full size="lg" />}>
      <View className="items-center pt-4 pb-6">
        <Animated.View entering={ZoomIn.duration(400)} className="w-20 h-20 rounded-full bg-[#25D366] items-center justify-center mb-5">
          <Icon name="whatsapp" size={42} color="#fff" />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(120)} className="items-center">
          <Txt className="text-[24px] font-black text-center">{t('lead.title')}</Txt>
          <Txt className="text-muted text-[15px] text-center mt-2">{t('lead.subtitle')}</Txt>
        </Animated.View>
      </View>
      <Animated.View entering={FadeInDown.delay(220)}>
        <Input testID="lead-name" label={t('lead.name')} placeholder={t('lead.namePh')} value={name} onChangeText={setName} error={err.n} autoComplete="name" />
        <Input testID="lead-phone" label={t('lead.whatsapp')} placeholder={t('lead.whatsappPh')} value={phone} onChangeText={setPhone} error={err.p} keyboardType="phone-pad" autoComplete="tel" />
        <View className="flex-row items-center gap-2 mt-1"><Icon name="lock-outline" size={14} tone="muted" /><Txt className="text-muted text-[12px] flex-1">{t('lead.privacy')}</Txt></View>
      </Animated.View>
    </Screen>
  );
}
