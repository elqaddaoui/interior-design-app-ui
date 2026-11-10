import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { Panel } from '@/components/admin/dashboard/Kit';
import { useSuperData } from '@/hooks/useSuperData';
import { saApi, type SaPlatform as Platform } from '@/lib/superadmin';
import { toast } from '@/store/useToast';
import { Loaded, SaPage, SwitchRow, useSa } from './ui';

export function SaPlatform() {
  const { t, err } = useSa();
  const q = useSuperData<Platform>('/platform');
  const [message, setMessage] = useState('');
  const [credits, setCredits] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { if (q.data) { setMessage(q.data.maintenanceMessage); setCredits(String(q.data.defaultFreeCredits)); } }, [q.data]);

  const patch = async (key: string, body: Partial<Platform>) => {
    setBusy(key);
    try { q.setData(await saApi<Platform>('/platform', { method: 'PATCH', body })); toast(t('saved')); } catch (e) { toast(err(e)); }
    setBusy('');
  };
  const sw = (key: 'maintenance' | 'allowClientSignup' | 'allowRequests' | 'notifyAdmins' | 'notifyUsers', value: boolean) => (
    <Toggle testID={`sa-switch-${key}`} label={key} value={value} onValueChange={(v) => patch(key, { [key]: v })} disabled={busy === key} />
  );

  return (
    <SaPage title={t('platformTitle')} sub={t('platformSub')} max={860}>
      <Loaded q={q}>
        {(p) => (
          <View style={{ gap: 14 }} testID="sa-platform">
            {p.maintenance ? (
              <View testID="sa-maintenance-live" className="flex-row items-center bg-danger/10 border border-danger/30 rounded-3xl p-4" style={{ gap: 10 }}>
                <Icon name="alert-circle-outline" size={22} tone="danger" /><Txt className="flex-1 text-[13.5px] font-bold">{t('pLive')}</Txt>
              </View>
            ) : null}
            <Panel title={t('pSwitches')}>
              <SwitchRow label={t('pMaintenance')} hint={t('pMaintenanceSub')}>{sw('maintenance', p.maintenance)}</SwitchRow>
              <View className="border-t border-line" />
              <SwitchRow label={t('pSignup')} hint={t('pSignupSub')}>{sw('allowClientSignup', p.allowClientSignup)}</SwitchRow>
              <View className="border-t border-line" />
              <SwitchRow label={t('pRequests')} hint={t('pRequestsSub')}>{sw('allowRequests', p.allowRequests)}</SwitchRow>
              <View className="border-t border-line pt-4">
                <Input testID="sa-maint-message" label={t('pMessage')} value={message} onChangeText={setMessage} multiline maxLength={300} />
                <Button size="sm" variant="soft" title={t('save')} onPress={() => patch('message', { maintenanceMessage: message })} loading={busy === 'message'} disabled={message === p.maintenanceMessage} testID="sa-maint-save" />
              </View>
            </Panel>
            <Panel title={t('pNotifications')}>
              <SwitchRow label={t('pNotifyAdmins')}>{sw('notifyAdmins', p.notifyAdmins)}</SwitchRow>
              <View className="border-t border-line" />
              <SwitchRow label={t('pNotifyUsers')}>{sw('notifyUsers', p.notifyUsers)}</SwitchRow>
              <View className="border-t border-line pt-4">
                <Input testID="sa-free-credits" label={t('pCredits')} value={credits} onChangeText={(v) => setCredits(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" />
                <Button size="sm" variant="soft" title={t('save')} onPress={() => patch('credits', { defaultFreeCredits: Number(credits || 0) })} loading={busy === 'credits'} disabled={credits === String(p.defaultFreeCredits)} testID="sa-credits-apply" />
              </View>
            </Panel>
          </View>
        )}
      </Loaded>
    </SaPage>
  );
}
