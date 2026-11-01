import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from '@/hooks/useLeaveGuard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Txt } from '@/components/ui/Txt';
import { backendEnabled } from '@/lib/backend';
import { services } from '@/data/repositories';
import { useT } from '@/i18n';
import { useLocal } from '@/store/useLocal';
import { refreshAdminSession } from '@/lib/sync';
import { useIsAdmin, useStore } from '@/store/useStore';

/** Mock login — swap `services.auth` for the real backend later. Role guard lives in admin/_layout. */
export function AdminLogin({ forbidden }: { forbidden?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const hasAdmin = useIsAdmin();
  const submit = async () => {
    setBusy(true); setErr('');
    const r = await services.auth.loginAdmin(email, pw);
    setBusy(false);
    if (!r.ok) return setErr(t('admin.invalid'));
    if (!hasAdmin) return setErr(t('admin.forbidden'));
    useLocal.getState().set({ adminSession: true });
    if (backendEnabled) { useStore.setState({ adminLoaded: false }); await Promise.all([refreshAdminSession(), useStore.getState().loadAdminData()]); }
  };
  return (
    <View className="flex-1 bg-bg items-center justify-center p-5">
      <Card className="w-full max-w-[420px] p-6">
        <View className="w-14 h-14 rounded-2xl bg-primary items-center justify-center self-center mb-4"><Icon name="shield-lock-outline" size={28} tone="onprimary" /></View>
        <Txt className="text-[22px] font-extrabold text-center mb-1">{t('admin.login')}</Txt>
        <Txt className="text-muted text-center text-[13px] mb-5">{forbidden ? t('admin.forbidden') : t(backendEnabled ? 'push.loginHint' : 'admin.demoHint')}</Txt>
        <Input testID="admin-email" label={t('admin.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="username" />
        <Input testID="admin-password" label={t('admin.password')} value={pw} onChangeText={setPw} secureTextEntry autoComplete="current-password" onSubmitEditing={submit} error={err} />
        <Button testID="admin-signin" title={t('admin.signIn')} onPress={submit} loading={busy} className="mt-1" />
        <Button title={t('admin.openApp')} variant="ghost" onPress={() => router.replace('/')} className="mt-2" />
      </Card>
    </View>
  );
}
