import React, { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Txt } from '@/components/ui/Txt';
import { passwordOk, saApi, type SaProfile } from '@/lib/superadmin';
import { useSuperAdmin } from '@/store/useSuperAdmin';
import { toast } from '@/store/useToast';
import { PasswordField, PasswordRules, useSa } from './ui';

/** Change the Super Admin password (and optionally the username). Shared by the security page and the first-login dialog. */
export function CredentialsForm({ onDone, onCancel, cancelLabel }: { onDone?: () => void; onCancel?: () => void; cancelLabel?: string }) {
  const { t, err } = useSa();
  const profile = useSuperAdmin((s) => s.profile);
  const setProfile = useSuperAdmin((s) => s.setProfile);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const effectiveName = username.trim() || profile?.username || '';
  const mismatch = !!again && again !== next;
  const ready = !!current && passwordOk(next, effectiveName) && next === again;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try {
      const r = await saApi<{ profile?: SaProfile } & Partial<SaProfile>>('/credentials', { method: 'POST', body: { current, next, ...(username.trim() ? { username: username.trim() } : {}) } });
      setProfile((r.profile ?? r) as SaProfile);
      setCurrent(''); setNext(''); setAgain(''); setUsername('');
      toast(t('credsDone'));
      onDone?.();
    } catch (e) { setError(err(e)); }
    setBusy(false);
  };

  return (
    <View testID="sa-creds-form">
      <PasswordField testID="sa-current-pw" label={t('currentPw')} value={current} onChangeText={setCurrent} autoComplete="current-password" />
      <Input testID="sa-new-username" label={t('newUsername')} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder={profile?.username} />
      <PasswordField testID="sa-new-pw" label={t('newPw')} value={next} onChangeText={setNext} />
      <PasswordRules value={next} username={effectiveName} />
      <PasswordField testID="sa-confirm-pw" label={t('confirmPw')} value={again} onChangeText={setAgain} error={mismatch ? t('mismatch') : undefined} onSubmitEditing={submit} />
      {error ? <Txt testID="sa-creds-error" accessibilityRole="alert" className="text-danger text-[13px] font-semibold mb-3">{error}</Txt> : null}
      <View className="flex-row" style={{ gap: 10 }}>
        {onCancel ? <View style={{ flex: 1 }}><Button full variant="soft" title={cancelLabel ?? t('cancel')} onPress={onCancel} testID="sa-creds-cancel" /></View> : null}
        <View style={{ flex: 1 }}><Button full variant="ink" icon="shield-key-outline" title={t('updateCreds')} onPress={submit} loading={busy} disabled={!ready} testID="sa-creds-submit" /></View>
      </View>
    </View>
  );
}
