import React, { useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useStore, useMe } from '@/store/useStore';
import { useWizard } from '@/store/useWizard';
import { ME } from '@/data/repositories';
import { useT } from '@/i18n';
import { Button, Icon, Input, PageHeader, Screen, Txt } from '@/components/ui';
import { cleanPhone, validPhone } from '@/lib/share';

/** First free render: ask for Name + WhatsApp. Creates a Render Request for the admin. */
export default function Lead() {
  const { t } = useT();
  const me = useMe();
  const w = useWizard();
  const [name, setName] = useState(me?.name ?? '');
  const [phone, setPhone] = useState(me?.whatsapp ?? '');
  const [err, setErr] = useState<{ n?: string; p?: string }>({});
  const [busy, setBusy] = useState(false);

  if (!w.photoUri) return <Redirect href="/" />;

  const submit = async () => {
    const e: typeof err = {};
    if (name.trim().length < 2) e.n = t('lead.errName');
    if (!validPhone(phone)) e.p = t('lead.errPhone');
    setErr(e);
    if (e.n || e.p) return;
    setBusy(true);
    const st = useStore.getState();
    const whatsapp = cleanPhone(phone);
    await st.update('users', ME, { name: name.trim(), whatsapp, leadDone: true });
    await st.create('requests', { userId: ME, name: name.trim(), whatsapp, photoUri: w.photoUri, draft: w.draft, status: 'pending', createdAt: Date.now() });
    w.setLead({ name: name.trim(), whatsapp });
    setBusy(false);
    router.replace('/render');
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
