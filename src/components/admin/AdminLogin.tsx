import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from '@/hooks/useLeaveGuard';
import { Button, Card, Icon, Input, Txt } from '@/components/ui';
import { services } from '@/data/repositories';
import { useT } from '@/i18n';
import { useLocal } from '@/store/useLocal';
import { useStore } from '@/store/useStore';

/** Mock login — swap `services.auth` for the real backend later. Role guard lives in admin/_layout. */
export function AdminLogin({ forbidden }: { forbidden?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const hasAdmin = useStore((s) => s.users.some((u) => u.role === 'admin'));
  const submit = async () => {
    setBusy(true); setErr('');
    const r = await services.auth.loginAdmin(email, pw);
    setBusy(false);
    if (!r.ok) return setErr(t('admin.invalid'));
    if (!hasAdmin) return setErr(t('admin.forbidden'));
    useLocal.getState().set({ adminSession: true });
  };
  return (
    <View className="flex-1 bg-bg items-center justify-center p-5">
      <Card className="w-full max-w-[420px] p-6">
        <View className="w-14 h-14 rounded-2xl bg-primary items-center justify-center self-center mb-4"><Icon name="shield-lock-outline" size={28} tone="onprimary" /></View>
        <Txt className="text-[22px] font-extrabold text-center mb-1">{t('admin.login')}</Txt>
        <Txt className="text-muted text-center text-[13px] mb-5">{forbidden ? t('admin.forbidden') : t('admin.demoHint')}</Txt>
        <Input testID="admin-email" label={t('admin.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <Input testID="admin-password" label={t('admin.password')} value={pw} onChangeText={setPw} secureTextEntry onSubmitEditing={submit} error={err} />
        <Button testID="admin-signin" title={t('admin.signIn')} onPress={submit} loading={busy} className="mt-1" />
        <Button title={t('admin.openApp')} variant="ghost" onPress={() => router.replace('/')} className="mt-2" />
      </Card>
    </View>
  );
}
