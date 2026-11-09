import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminAvatar } from '@/components/admin/AdminAvatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Txt } from '@/components/ui/Txt';
import { Toggle } from '@/components/ui/Toggle';
import { useT } from '@/i18n';
import { BackendError, backendEnabled } from '@/lib/backend';
import { mediaUploadsEnabled, uploadDataUrl } from '@/lib/media';
import { pickPhoto } from '@/lib/photo';
import { accountErrorKey, agoParts, deviceName, passwordStrength } from '@/lib/adminAccount';
import { changeAdminPassword, listAdminDevices, refreshProfile, revokeAdminDevice, revokeOtherAdminDevices, useAdminProfile, type AdminDevice } from '@/store/useAdminProfile';
import { useLocal } from '@/store/useLocal';
import { toast } from '@/store/useToast';

function Section({ icon, title, children, testID }: { icon: string; title: string; children: React.ReactNode; testID?: string }) {
  return (
    <Card testID={testID} className="p-4 mb-4">
      <View className="flex-row items-center mb-3" style={{ gap: 10 }}>
        <View className="w-9 h-9 rounded-xl bg-soft items-center justify-center"><Icon name={icon} size={20} tone="primary" /></View>
        <Txt className="text-[17px] font-black flex-1" accessibilityRole="header">{title}</Txt>
      </View>
      {children}
    </Card>
  );
}

const useWhen = () => {
  const { t } = useT();
  return (at?: number | null) => { const a = agoParts(at); return t(`ac.${a.key}`, { n: a.n }); };
};

/** A password box with a show / hide eye. */
function PasswordInput({ label, value, onChangeText, error, testID, autoComplete, onSubmitEditing }: { label: string; value: string; onChangeText: (v: string) => void; error?: string; testID: string; autoComplete?: 'current-password' | 'new-password'; onSubmitEditing?: () => void }) {
  const { t } = useT();
  const [shown, setShown] = useState(false);
  return (
    <View>
      <Input testID={testID} label={label} value={value} onChangeText={onChangeText} secureTextEntry={!shown} autoCapitalize="none" autoComplete={autoComplete ?? 'new-password'} error={error} onSubmitEditing={onSubmitEditing} />
      <Pressable testID={`${testID}-eye`} accessibilityRole="button" accessibilityLabel={shown ? t('ac.hide') : t('ac.show')} onPress={() => setShown((s) => !s)} hitSlop={8}
        className="absolute w-9 h-9 items-center justify-center" style={{ end: 6, top: 26 }}>
        <Icon name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} tone="muted" />
      </Pressable>
    </View>
  );
}

function StrengthBar({ value }: { value: string }) {
  const { t } = useT();
  const s = passwordStrength(value);
  if (!s) return null;
  const color = s === 1 ? 'bg-danger' : s === 2 ? 'bg-primary' : 'bg-success';
  const label = s === 1 ? t('ac.strengthWeak') : s === 2 ? t('ac.strengthOk') : t('ac.strengthStrong');
  return (
    <View testID="pw-strength" className="mb-3 -mt-1" style={{ gap: 6 }}>
      <View className="flex-row" style={{ gap: 4 }}>{[1, 2, 3].map((i) => <View key={i} className={`flex-1 h-1.5 rounded-full ${i <= s ? color : 'bg-surface2'}`} />)}</View>
      <Txt className="text-[12px] text-muted">{label} · {t('ac.rules')}</Txt>
    </View>
  );
}

function ProfileSection() {
  const { t } = useT();
  const profile = useAdminProfile((s) => s.profile);
  const offline = useLocal((s) => s.adminOffline);
  const [form, setForm] = useState({ name: '', title: '', phone: '', email: '' });
  const [credits, setCredits] = useState({ unlimited: true, amount: '0' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const seeded = profile?.id;
  useEffect(() => {
    if (!profile) return;
    setForm({ name: profile.name, title: profile.title, phone: profile.phone, email: profile.email });
    setCredits({ unlimited: profile.credits == null, amount: String(profile.credits ?? 0) });
  }, [seeded]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!profile && (form.name !== profile.name || form.title !== profile.title || form.phone !== profile.phone || form.email !== profile.email
    || (credits.unlimited ? profile.credits != null : String(profile.credits) !== credits.amount.trim()));
  const readOnly = !backendEnabled || offline || !profile;

  const save = async () => {
    if (!profile || readOnly) return;
    const amount = Number(credits.amount.trim());
    if (!credits.unlimited && !(Number.isInteger(amount) && amount >= 0)) { setErrors({ credits: t('ac.errCredits') }); return; }
    setBusy(true); setErrors({});
    try {
      const next = await useAdminProfile.getState().save({ name: form.name, title: form.title, phone: form.phone, email: form.email, credits: credits.unlimited ? null : amount });
      setForm({ name: next.name, title: next.title, phone: next.phone, email: next.email });
      toast(t('ac.saved'));
    } catch (e) {
      const code = e instanceof BackendError ? e.code : '';
      const field = code === 'INVALID_EMAIL' || code === 'EMAIL_TAKEN' ? 'email' : code === 'INVALID_PHONE' ? 'phone' : code === 'INVALID_PROFILE' ? 'name' : code === 'INVALID_CREDITS' ? 'credits' : 'form';
      setErrors({ [field]: t(accountErrorKey(code)) });
      if (field === 'form') toast(t('ac.saveFailed'));
    } finally { setBusy(false); }
  };
  const pick = async () => {
    const r = await pickPhoto('gallery', { purpose: 'photo' });
    if (!('uri' in r) || readOnly) return;
    setPhotoBusy(true);
    try {
      const uri = mediaUploadsEnabled && r.uri.startsWith('data:') ? await uploadDataUrl(r.uri, 'photo') : r.uri;
      await useAdminProfile.getState().save({ avatar: uri });
    } catch { toast(t('ac.saveFailed')); } finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => { try { await useAdminProfile.getState().save({ avatar: '' }); } catch { toast(t('ac.saveFailed')); } };
  const set = (k: keyof typeof form) => (v: string) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: '', form: '' })); };
  const when = useWhen();

  return (
    <Section icon="account-circle-outline" title={t('ac.profile')} testID="account-profile">
      <View className="flex-row items-center mb-4" style={{ gap: 14 }}>
        <AdminAvatar name={form.name || profile?.username || 'A'} uri={profile?.avatar} size={76} />
        <View className="flex-1" style={{ gap: 8 }}>
          <Txt className="text-muted text-[12px] font-semibold">{t('ac.photo')}</Txt>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            <Button testID="account-photo" title={t('ac.changePhoto')} icon="camera-outline" variant="soft" size="sm" onPress={pick} loading={photoBusy} disabled={readOnly} />
            {profile?.avatar ? <Pressable testID="account-photo-remove" onPress={removePhoto} className="h-9 px-3 justify-center"><Txt className="text-danger font-bold text-[13px]">{t('ac.removePhoto')}</Txt></Pressable> : null}
          </View>
        </View>
      </View>
      <Input testID="account-name" label={t('ac.name')} placeholder={t('ac.namePh')} value={form.name} onChangeText={set('name')} editable={!readOnly} error={errors.name} autoComplete="name" />
      <Input testID="account-title" label={t('ac.jobTitle')} placeholder={t('ac.jobTitlePh')} value={form.title} onChangeText={set('title')} editable={!readOnly} />
      <Input testID="account-phone" label={t('ac.phone')} placeholder={t('ac.phonePh')} value={form.phone} onChangeText={set('phone')} editable={!readOnly} keyboardType="phone-pad" autoComplete="tel" error={errors.phone} />
      <Input testID="account-email" label={t('ac.email')} value={form.email} onChangeText={set('email')} editable={!readOnly} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={errors.email} />
      <Txt className="text-muted text-[12px] -mt-2 mb-3">{t('ac.emailHint')}</Txt>
      <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
        <Icon name="account-key-outline" size={17} tone="muted" />
        <Txt className="text-[13px] text-muted">{t('ac.username')}: <Txt className="text-[13px] font-bold">{profile?.username ?? '—'}</Txt></Txt>
      </View>

      <View className="bg-surface2 rounded-2xl p-3 mb-3" testID="account-credits" style={{ gap: 10 }}>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Icon name="star-circle-outline" size={22} tone="primary" />
          <View className="flex-1"><Txt className="font-extrabold text-[14px]">{t('ac.creditsTitle')}</Txt><Txt className="text-muted text-[12px]">{t('ac.creditsHint')}</Txt></View>
        </View>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Toggle testID="account-unlimited" value={credits.unlimited} disabled={readOnly} onValueChange={(v) => setCredits((c) => ({ ...c, unlimited: v }))} label={t('ac.unlimited')} />
          <Txt className="font-bold text-[14px] flex-1">{t('ac.unlimited')}</Txt>
          {!credits.unlimited ? <View style={{ width: 120 }}><Input tight testID="account-credits-amount" accessibilityLabel={t('ac.amount')} value={credits.amount} onChangeText={(v) => setCredits((c) => ({ ...c, amount: v.replace(/[^\d]/g, '') }))} keyboardType="number-pad" invalid={!!errors.credits} style={{ textAlign: 'center' }} /></View> : null}
        </View>
        {errors.credits ? <Txt className="text-danger text-[12px]">{errors.credits}</Txt> : null}
      </View>

      {readOnly ? <View className="flex-row items-center mb-3" style={{ gap: 8 }}><Icon name="cloud-off-outline" size={16} tone="muted" /><Txt className="text-muted text-[12px] flex-1">{t('ac.offline')}</Txt></View> : null}
      <View className="flex-row items-center justify-between flex-wrap" style={{ gap: 8 }}>
        <Txt className="text-muted text-[12px] flex-1" style={{ minWidth: 140 }}>{t('ac.lastLogin', { when: profile?.lastLoginAt ? when(profile.lastLoginAt) : t('ac.never') })}</Txt>
        <Button testID="account-save" title={t('ac.save')} icon="content-save-outline" onPress={save} loading={busy} disabled={!dirty || readOnly} />
      </View>
      {errors.form ? <Txt className="text-danger text-[12px] mt-2">{errors.form}</Txt> : null}
    </Section>
  );
}

function PasswordSection() {
  const { t } = useT();
  const profile = useAdminProfile((s) => s.profile);
  const offline = useLocal((s) => s.adminOffline);
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const reset = () => { setOpen(false); setCur(''); setNext(''); setAgain(''); setErrors({}); };
  const readOnly = !backendEnabled || offline || !profile;
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!cur) e.cur = t('ac.errWrong');
    if (passwordStrength(next) < 2) e.next = t('ac.errWeak');
    else if (next === cur) e.next = t('ac.errSame');
    if (again !== next) e.again = t('ac.errMismatch');
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await changeAdminPassword(cur, next); toast(t('ac.passwordSaved')); reset(); }
    catch (error) {
      const code = error instanceof BackendError ? error.code : '';
      setErrors({ [code === 'WRONG_PASSWORD' ? 'cur' : 'next']: t(accountErrorKey(code)) });
    } finally { setBusy(false); }
  };
  return (
    <Section icon="shield-lock-outline" title={t('ac.security')} testID="account-security">
      {profile?.defaultPassword ? (
        <View testID="account-default-warning" className="flex-row bg-soft rounded-2xl p-3 mb-3 border border-danger" style={{ gap: 10 }}>
          <Icon name="alert-outline" size={20} tone="danger" /><Txt className="flex-1 text-[13px] font-semibold leading-[19px]">{t('ac.passwordDefault')}</Txt>
        </View>
      ) : null}
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View className="flex-1">
          <Txt className="font-extrabold text-[15px]">{t('ac.password')}</Txt>
          <Txt className="text-muted text-[12px]" style={{ writingDirection: 'ltr' } as never}>••••••••••{profile?.passwordChangedAt ? `  ·  ${t('ac.passwordSince', { date: new Date(profile.passwordChangedAt).toLocaleDateString() })}` : ''}</Txt>
        </View>
        {!open ? <Button testID="account-pw-edit" title={t('ac.editPassword')} icon="lock-reset" variant="soft" size="sm" disabled={readOnly} onPress={() => setOpen(true)} /> : null}
      </View>
      {open ? (
        <View className="mt-4" testID="account-pw-form">
          <PasswordInput testID="pw-current" label={t('ac.current')} value={cur} onChangeText={(v) => { setCur(v); setErrors((x) => ({ ...x, cur: '' })); }} error={errors.cur} autoComplete="current-password" />
          <PasswordInput testID="pw-new" label={t('ac.next')} value={next} onChangeText={(v) => { setNext(v); setErrors((x) => ({ ...x, next: '' })); }} error={errors.next} />
          <StrengthBar value={next} />
          <PasswordInput testID="pw-confirm" label={t('ac.confirm')} value={again} onChangeText={(v) => { setAgain(v); setErrors((x) => ({ ...x, again: '' })); }} error={errors.again} onSubmitEditing={submit} />
          <View className="flex-row justify-end" style={{ gap: 8 }}>
            <Button testID="pw-cancel" title={t('common.cancel')} variant="soft" onPress={reset} />
            <Button testID="pw-submit" title={t('ac.save')} icon="check" onPress={submit} loading={busy} />
          </View>
        </View>
      ) : null}
    </Section>
  );
}

function DevicesSection() {
  const { t } = useT();
  const offline = useLocal((s) => s.adminOffline);
  const [rows, setRows] = useState<AdminDevice[] | null>(null);
  const when = useWhen();
  const load = useCallback(async () => { try { setRows(await listAdminDevices()); } catch { setRows([]); } }, []);
  useEffect(() => { if (backendEnabled && !offline) void load(); else setRows([]); }, [load, offline]);
  const others = useMemo(() => (rows ?? []).filter((r) => !r.current), [rows]);
  const revoke = async (id: string) => { try { await revokeAdminDevice(id); toast(t('ac.deviceRevoked')); } catch { toast(t('ac.saveFailed')); } void load(); };
  const revokeAll = async () => { try { await revokeOtherAdminDevices(); toast(t('ac.deviceRevoked')); } catch { toast(t('ac.saveFailed')); } void load(); };
  return (
    <Section icon="devices" title={t('ac.devices')} testID="account-devices">
      {(rows ?? []).map((r) => (
        <View key={r.id} testID={`device-${r.current ? 'current' : r.id}`} className="flex-row items-center py-2.5 border-b border-line" style={{ gap: 12 }}>
          <View className="w-9 h-9 rounded-xl bg-surface2 items-center justify-center"><Icon name={/Android|iOS|App/.test(deviceName(r.ua)) ? 'cellphone' : 'laptop'} size={19} /></View>
          <View className="flex-1" style={{ minWidth: 0 }}>
            <Txt numberOfLines={1} className="font-bold text-[14px]">{deviceName(r.ua) || t('ac.thisDevice')}{r.current ? `  ·  ${t('ac.thisDevice')}` : ''}</Txt>
            <Txt numberOfLines={1} className="text-muted text-[12px]">{t('ac.signedIn', { when: when(r.createdAt) })}</Txt>
          </View>
          {!r.current ? <Button testID={`device-revoke-${r.id}`} title={t('ac.signOutDevice')} variant="soft" size="sm" onPress={() => revoke(r.id)} /> : null}
        </View>
      ))}
      {rows && !others.length ? <Txt className="text-muted text-[13px] pt-3">{t('ac.noOthers')}</Txt> : null}
      {others.length ? <Button testID="device-revoke-others" title={t('ac.signOutOthers')} icon="logout-variant" variant="outline" className="mt-3" onPress={revokeAll} /> : null}
    </Section>
  );
}

export default function AdminAccount() {
  const { t } = useT();
  useEffect(() => { void refreshProfile(); }, []);
  return (
    <AdminPage title={t('ac.title')} max={720}>
      <Txt className="text-muted text-[14px] mb-4 -mt-2">{t('ac.subtitle')}</Txt>
      <ProfileSection />
      <PasswordSection />
      <DevicesSection />
    </AdminPage>
  );
}
