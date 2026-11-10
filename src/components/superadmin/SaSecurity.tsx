import React, { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { Panel } from '@/components/admin/dashboard/Kit';
import { useSuperData } from '@/hooks/useSuperData';
import { saApi, type SaSession } from '@/lib/superadmin';
import { useSuperAdmin } from '@/store/useSuperAdmin';
import { toast } from '@/store/useToast';
import { CredentialsForm } from './CredentialsForm';
import { Empty, Loaded, Pill, SaPage, useSa } from './ui';

const device = (ua: string) => (/iphone|ipad|ios/i.test(ua) ? 'cellphone' : /android/i.test(ua) ? 'cellphone' : 'monitor');
const browser = (ua: string) => (/edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : ua ? ua.slice(0, 24) : '—');

export function SaSecurity() {
  const { t, err, ago, dateTime } = useSa();
  const profile = useSuperAdmin((s) => s.profile);
  const q = useSuperData<{ sessions: SaSession[] }>('/sessions');
  const [busy, setBusy] = useState(false);
  const others = (q.data?.sessions ?? []).filter((s) => !s.current).length;

  const signOutOthers = async () => {
    setBusy(true);
    try { await saApi('/sessions', { method: 'DELETE' }); toast(t('othersOut')); q.reload(); } catch (e) { toast(err(e)); }
    setBusy(false);
  };

  return (
    <SaPage title={t('secTitle')} sub={t('secSub')} max={920}>
      <Panel title={t('credsTitle')} sub={t('credsSub')} testID="sa-security-creds">
        {profile?.defaultPassword ? (
          <View testID="sa-default-warning" className="flex-row items-center bg-danger/10 rounded-2xl p-3 mb-4" style={{ gap: 8 }}>
            <Icon name="alert-circle-outline" size={20} tone="danger" />
            <Txt className="flex-1 text-[13px] font-bold text-danger">{t('pwDefault')}</Txt>
          </View>
        ) : null}
        <CredentialsForm />
      </Panel>

      <Panel title={t('accountInfo')} testID="sa-security-info">
        <View style={{ gap: 10 }}>
          {[
            ['username', profile?.username ?? ''],
            ['lastLogin', profile?.lastLoginAt ? dateTime(profile.lastLoginAt) : t('never')],
            ['pwChanged', profile?.defaultPassword ? t('pwDefault') : profile?.passwordChangedAt ? `${dateTime(profile.passwordChangedAt)} · ${t('pwCustom')}` : t('pwCustom')],
          ].map(([k, v]) => (
            <View key={k} className="flex-row items-center justify-between" style={{ gap: 12 }}>
              <Txt className="text-muted text-[13px]">{t(k)}</Txt>
              <Txt testID={`sa-info-${k}`} className="text-[13.5px] font-bold flex-1 text-end" numberOfLines={2}>{v}</Txt>
            </View>
          ))}
        </View>
      </Panel>

      <Panel title={t('devices')} right={others > 0 ? <Button size="sm" variant="outline" icon="logout" title={t('signOutOthers')} loading={busy} onPress={signOutOthers} testID="sa-signout-others" /> : undefined} testID="sa-security-sessions">
        <Loaded q={q}>
          {(d) => d.sessions.length === 0 ? <Empty text={t('empty')} /> : (
            <View style={{ gap: 8 }}>
              {d.sessions.map((s) => (
                <View key={s.id} testID={`sa-session-${s.current ? 'current' : 'other'}`} className="flex-row items-center bg-surface2 rounded-2xl p-3" style={{ gap: 12 }}>
                  <Icon name={device(s.ua)} size={22} tone="muted" />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt className="text-[14px] font-bold" numberOfLines={1}>{browser(s.ua)}{s.ip ? ` · ${s.ip}` : ''}</Txt>
                    <Txt className="text-muted text-[12px]">{ago(s.createdAt)}</Txt>
                  </View>
                  {s.current ? <Pill tone="success" label={t('thisDevice')} /> : null}
                </View>
              ))}
            </View>
          )}
        </Loaded>
      </Panel>
    </SaPage>
  );
}
