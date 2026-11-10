import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Txt } from '@/components/ui/Txt';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Toggle } from '@/components/ui/Toggle';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/admin/dashboard/Kit';
import { Chips, Label, Loading, SuperPage, useFail, useLoad } from '@/components/super/ui';
import { LANGS, useLang, useT } from '@/i18n';
import { toast } from '@/store/useToast';
import { errorKey, useSuper } from '@/store/useSuper';
import { superApi, type Plan, type PlatformConfig } from '@/lib/superApi';

const LANG_LABEL: Record<string, string> = { dar: 'الدارجة', ar: 'العربية', fr: 'Français' };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Row({ title, hint, children, testID }: { title: string; hint?: string; children: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} className="flex-row items-center justify-between" style={{ gap: 12, paddingVertical: 6 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt className="font-bold text-[14px]">{title}</Txt>
        {hint ? <Txt className="text-muted text-[12px] leading-[17px] mt-0.5">{hint}</Txt> : null}
      </View>
      {children}
    </View>
  );
}

export default function SettingsPage() {
  const { t, lang } = useT();
  const fail = useFail();
  const username = useSuper((s) => s.username);
  const defaultCredentials = useSuper((s) => s.defaultCredentials);
  const remote = useLoad(() => superApi<PlatformConfig>('/config'));
  const plans = useLoad(() => superApi<Plan[]>('/plans'));
  const [cfg, setCfg] = useState<PlatformConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const seeded = useRef(false);
  useEffect(() => { if (remote.data && !seeded.current) { seeded.current = true; setCfg(remote.data); } }, [remote.data]);
  const dirty = !!cfg && !!remote.data && !same(cfg, remote.data);
  const patch = (p: Partial<PlatformConfig>) => setCfg((c) => (c ? { ...c, ...p } : c));

  const save = async () => {
    if (!cfg || busy) return;
    setBusy(true); setErr('');
    try { const next = await superApi<PlatformConfig>('/config', { method: 'PATCH', body: cfg }); remote.setData(next); setCfg(next); toast(t('sx.c.saved')); }
    catch (e) { const key = errorKey(e); setErr(t(key)); if (key === 'sx.err.SESSION') fail(e); }
    finally { setBusy(false); }
  };

  /* ---- password ---- */
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const changePassword = async () => {
    if (pwBusy) return;
    if (next.length < 10) { setPwErr(t('sx.st.short')); return; }
    if (next !== again) { setPwErr(t('sx.st.mismatch')); return; }
    setPwBusy(true); setPwErr('');
    try {
      await superApi('/password', { method: 'POST', body: { current: cur, next } });
      useSuper.getState().setDefaultCredentials(false);
      setCur(''); setNext(''); setAgain(''); toast(t('sx.st.changed'));
    } catch (e) { const key = errorKey(e); setPwErr(t(key)); if (key === 'sx.err.SESSION') fail(e); }
    finally { setPwBusy(false); }
  };

  return (
    <SuperPage title={t('sx.st.title')} sub={t('sx.st.sub')} max={860}>
      {!cfg ? <Loading error={remote.error} onRetry={remote.reload} /> : (
        <View style={{ gap: 14 }}>
          <Panel>
            <Row testID="set-maintenance" title={t('sx.st.maintenance')} hint={t('sx.st.maintenanceHint')}>
              <Toggle testID="set-maintenance-toggle" value={cfg.maintenance.enabled} onValueChange={(v) => patch({ maintenance: { ...cfg.maintenance, enabled: v } })} label={t('sx.st.maintenance')} />
            </Row>
            <Input testID="set-maintenance-msg" label={t('sx.st.maintenanceMsg')} value={cfg.maintenance.message} onChangeText={(v) => patch({ maintenance: { ...cfg.maintenance, message: v } })} multiline style={{ height: 64, textAlignVertical: 'top' }} />
          </Panel>

          <Panel>
            <Row testID="set-announce" title={t('sx.st.announce')} hint={t('sx.st.announceHint')}>
              <Toggle testID="set-announce-toggle" value={cfg.announcement.enabled} onValueChange={(v) => patch({ announcement: { ...cfg.announcement, enabled: v } })} label={t('sx.st.announce')} />
            </Row>
            <Input testID="set-announce-text" label={t('sx.st.announceText')} value={cfg.announcement.text} onChangeText={(v) => patch({ announcement: { ...cfg.announcement, text: v } })} />
            <Label>{t('sx.st.level')}</Label>
            <Chips testID="set-announce-level" options={(['info', 'warning', 'success'] as const).map((k) => ({ key: k, label: t(`sx.st.${k}`) }))} value={cfg.announcement.level} onChange={(k) => patch({ announcement: { ...cfg.announcement, level: k } })} />
          </Panel>

          <Panel>
            <Row testID="set-signup" title={t('sx.st.signup')} hint={t('sx.st.signupHint')}>
              <Toggle testID="set-signup-toggle" value={cfg.signupOpen} onValueChange={(v) => patch({ signupOpen: v })} label={t('sx.st.signup')} />
            </Row>
            <Label>{t('sx.st.defaultPlan')}</Label>
            <Chips testID="set-default-plan" options={(plans.data || []).map((p) => ({ key: p.id, label: p.name }))} value={cfg.defaultPlan} onChange={(k) => patch({ defaultPlan: k })} />
            <View style={{ height: 12 }} />
            <Input testID="set-support" label={t('sx.st.supportEmail')} value={cfg.supportEmail} onChangeText={(v) => patch({ supportEmail: v })} autoCapitalize="none" keyboardType="email-address" />
          </Panel>

          {dirty ? (
            <View testID="settings-bar" className="bg-ink rounded-2xl p-3 flex-row items-center flex-wrap" style={{ gap: 10 }}>
              <Txt className="text-onink font-bold text-[13px] flex-1" style={{ minWidth: 160 }}>{t('sx.ac.unsaved')}</Txt>
              {err ? <Txt testID="settings-error" accessibilityRole="alert" className="text-onink text-[12px] w-full">{err}</Txt> : null}
              <Button testID="settings-discard" size="sm" variant="soft" title={t('sx.ac.discard')} onPress={() => { if (remote.data) setCfg(remote.data); setErr(''); }} />
              <Button testID="settings-save" size="sm" title={t('sx.c.save')} loading={busy} onPress={save} />
            </View>
          ) : null}

          <Panel>
            <View className="flex-row items-center" style={{ gap: 10, marginBottom: 4 }}>
              <Icon name="shield-lock-outline" size={20} />
              <View style={{ flex: 1 }}>
                <Txt className="font-extrabold text-[15px]">{t('sx.st.security')}</Txt>
                <Txt className="text-muted text-[12px]">{t('sx.st.securitySub')} · @{username}</Txt>
              </View>
            </View>
            {defaultCredentials ? <View testID="set-default-warning" className="bg-danger/10 rounded-xl p-3 mb-3 mt-2"><Txt className="text-danger text-[13px] font-semibold">{t('sx.st.defaultWarn')}</Txt></View> : null}
            <Input testID="set-pw-current" label={t('sx.st.current')} value={cur} onChangeText={setCur} secureTextEntry autoCapitalize="none" />
            <Input testID="set-pw-next" label={t('sx.st.next')} value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
            <Input testID="set-pw-confirm" label={t('sx.st.confirm')} value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" />
            {pwErr ? <Txt testID="set-pw-error" accessibilityRole="alert" className="text-danger text-[13px] mb-2">{pwErr}</Txt> : null}
            <Button testID="set-pw-save" variant="ink" title={t('sx.st.change')} loading={pwBusy} disabled={!cur || !next || !again} onPress={changePassword} />
          </Panel>

          <Panel>
            <Label>{t('sx.st.language')}</Label>
            <Chips testID="set-lang" options={LANGS.map((l) => ({ key: l, label: LANG_LABEL[l] }))} value={lang} onChange={(l) => useLang.getState().set(l)} />
          </Panel>
        </View>
      )}
    </SuperPage>
  );
}
