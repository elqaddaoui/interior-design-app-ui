import React, { useState } from 'react';
import { View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { useSuper } from '@/superadmin/session';
import { SA } from '@/superadmin/tokens';
import { Badge, Btn, Card, ErrorLine, Field, Heading, Loading, Row, T, ago, useLoad } from '@/superadmin/ui';

type Account = { email: string; isDefault: boolean; passwordChangedAt: number | null; lastLoginAt: number | null };

/** Account settings of the platform owner: the sign-in e-mail / user name and the password, stored in the database (table saas_super). */
export default function Settings() {
  const setMe = useSuper(s => s.setMe);
  const { data, error: loadError, loading, reload } = useLoad(() => sa<Account>('/account'));
  const [email, setEmail] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const shownEmail = email ?? data?.email ?? '';
  const mismatch = !!next && !!again && next !== again;
  const changesEmail = !!data && shownEmail.trim().toLowerCase() !== data.email;
  const canSave = !!current && (changesEmail || !!next) && !mismatch && (!next || next === again);

  const save = async () => {
    setBusy(true); setError(null); setSaved('');
    try {
      const result = await sa<Account>('/account', { method: 'PATCH', body: { currentPassword: current, ...(changesEmail ? { email: shownEmail } : {}), ...(next ? { newPassword: next } : {}) } });
      setMe({ email: result.email, isDefault: result.isDefault });
      setEmail(null); setCurrent(''); setNext(''); setAgain('');
      setSaved(next ? 'Saved. Use the new login next time you sign in. Other sessions were signed out.' : 'Saved. Use the new e-mail next time you sign in.');
      reload();
    } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };

  return (
    <View>
      <Heading title="Settings" hint="Your platform login. It is stored in the database, so it follows the app to every deployment." />
      <ErrorLine error={loadError} />
      {loading && !data ? <Loading /> : (
        <Card>
          <Row style={{ marginBottom: SA.space.md, justifyContent: 'space-between' }}>
            <T size="lg" weight="bold">Account</T>
            {data?.isDefault ? <Badge tone="warn" label="Factory login" /> : <Badge tone="ok" label="Custom login" />}
          </Row>
          <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.lg }} testID="sa-account-info">
            {data?.isDefault ? 'The e-mail and password are still "superadmin". Change them now.' : `Password changed ${ago(data?.passwordChangedAt)}. Last sign-in ${ago(data?.lastLoginAt)}.`}
          </T>
          <Field label="E-mail or user name" value={shownEmail} onChangeText={setEmail} testID="sa-set-email" />
          <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry testID="sa-set-current" />
          <Field label="New password (leave empty to keep it)" value={next} onChangeText={setNext} secureTextEntry testID="sa-set-new" />
          <Field label="Repeat the new password" value={again} onChangeText={setAgain} secureTextEntry error={mismatch ? 'The two passwords differ.' : undefined} testID="sa-set-again" />
          <ErrorLine error={error} />
          {saved ? <T size="sm" color={SA.color.ok} testID="sa-set-saved" style={{ marginBottom: SA.space.md }}>{saved}</T> : null}
          <Btn testID="sa-set-save" label="Save changes" onPress={save} busy={busy} disabled={!canSave} />
        </Card>
      )}
    </View>
  );
}
