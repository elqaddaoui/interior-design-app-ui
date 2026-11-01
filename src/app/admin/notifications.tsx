import React from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { PushNotifications } from '@/components/admin/PushNotifications';
import { CampaignList } from '@/components/admin/campaigns/CampaignList';
import { Composer } from '@/components/admin/campaigns/Composer';
import { useAdminCampaigns, type Campaign } from '@/store/useAdminCampaigns';
import { useLocal } from '@/store/useLocal';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { useT } from '@/i18n';
import { api, backendEnabled } from '@/lib/backend';
import { toast } from '@/store/useToast';

type Subscriber = { id: string; name: string; whatsapp: string; devices: number; browsers: number; apps: number; status: 'on' | 'off' | 'paused' };
const DOT: Record<Subscriber['status'], string> = { on: 'bg-success', off: 'bg-muted', paused: 'bg-danger' };

/** Notification management: two independent master switches (saved with Submit) and the users who enabled notifications. */
export default function Notifications() {
  const { t } = useT();
  const { draft, patch, save, dirty } = useDraftDoc('settings');
  const [users, setUsers] = React.useState<Subscriber[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [tab, setTab] = React.useState<'campaigns' | 'automations' | 'devices'>('campaigns');
  const [editing, setEditing] = React.useState<{ mode: 'campaign' | 'automation'; campaign: Campaign | null } | null>(null);
  const campaigns = useAdminCampaigns(s => s.campaigns);
  const campaignsLoaded = useAdminCampaigns(s => s.loaded);
  const offline = useLocal(s => s.adminOffline);
  const load = React.useCallback(() => {
    if (!backendEnabled) { setUsers([]); return Promise.resolve(); }
    return api<{ users: Subscriber[] }>('/admin/notification-subscribers').then(r => { setUsers(r.users); setFailed(false); }).catch(() => setFailed(true));
  }, []);
  useFocusEffect(React.useCallback(() => { void load(); void useAdminCampaigns.getState().load().catch(() => {}); }, [load]));
  const rows: { key: 'notifyAdmins' | 'notifyUsers'; title: string; desc: string }[] = [
    { key: 'notifyAdmins', title: t('inbox.admins'), desc: t('inbox.adminsDesc') },
    { key: 'notifyUsers', title: t('inbox.users'), desc: t('inbox.usersDesc') },
  ];
  return (
    <AdminPage title={t('inbox.notifTitle')} max={820} right={<Button testID="notifications-submit" size="sm" title={t('improve.submit')} disabled={!dirty} onPress={async () => { if (await save()) { toast(t('admin.crud.saved')); void load(); } }} />}>
      <Txt className="text-muted text-[13px] mb-3">{t('inbox.notifIntro')}</Txt>
      <Card className="px-4 mb-4">
        {rows.map((row, i) => (
          <View key={row.key} className={`flex-row items-center gap-3 py-3.5 ${i ? 'border-t border-line' : ''}`}>
            <View className="w-10 h-10 rounded-full bg-soft items-center justify-center"><Icon name={draft[row.key] !== false ? 'bell-ring-outline' : 'bell-outline'} size={20} tone="primary" /></View>
            <View className="flex-1"><Txt className="font-bold text-[15px]">{row.title}</Txt><Txt className="text-muted text-[12px] mt-0.5">{row.desc}</Txt></View>
            <Toggle testID={`notify-${row.key}`} label={row.title} value={draft[row.key] !== false} onValueChange={value => patch({ [row.key]: value })} />
          </View>
        ))}
      </Card>
      <View className="mb-4">
        <Segmented testID="notif-tabs" optionPrefix="notif-tab" value={tab} onChange={setTab} options={[
          { key: 'campaigns', label: t('camp.campaigns') }, { key: 'automations', label: t('camp.automations') }, { key: 'devices', label: t('camp.devices') },
        ]} />
      </View>
      {tab !== 'devices' ? (
        <View testID={`notif-panel-${tab}`}>
          {draft.notifyUsers === false ? <View className="flex-row items-center gap-2 bg-surface2 rounded-xl p-3 mb-3"><Icon name="bell-off-outline" size={18} tone="muted" /><Txt testID="camp-paused-banner" className="flex-1 text-[13px]">{t('camp.pausedBanner')}</Txt></View> : null}
          {offline ? <Txt className="text-danger text-[13px] mb-3">{t('camp.offline')}</Txt> : null}
          <View className="flex-row items-center justify-between gap-3 mb-3">
            <Txt className="text-muted text-[13px] flex-1">{tab === 'campaigns' ? t('camp.intro') : t('camp.emptyASub')}</Txt>
            <Button testID={tab === 'campaigns' ? 'camp-new' : 'camp-new-auto'} size="sm" icon="plus" title={t(tab === 'campaigns' ? 'camp.newCampaign' : 'camp.newAutomation')} onPress={() => setEditing({ mode: tab === 'campaigns' ? 'campaign' : 'automation', campaign: null })} />
          </View>
          {campaignsLoaded || !backendEnabled ? (
            <CampaignList kind={tab === 'campaigns' ? 'campaign' : 'automation'} items={campaigns.filter(c => (tab === 'automations') === (c.kind === 'trigger'))}
              onOpen={c => setEditing({ mode: c.kind === 'trigger' ? 'automation' : 'campaign', campaign: c })} onCreate={() => setEditing({ mode: tab === 'campaigns' ? 'campaign' : 'automation', campaign: null })} />
          ) : <AdminLoading testID="camp-loading" />}
        </View>
      ) : (
      <View testID="notif-panel-devices">
      <PushNotifications />
      <Txt className="font-extrabold text-[16px] mb-2">{t('inbox.subscribers')}</Txt>
      {draft.notifyUsers === false ? <Txt testID="notify-users-paused" className="text-muted text-[12px] mb-2">{t('inbox.pausedNote')}</Txt> : null}
      <Card className="px-4">
        {failed ? <Txt className="text-muted py-4">{t('inbox.loadFailed')}</Txt>
          : users === null ? <AdminLoading testID="subscribers-loading" />
          : users && !users.length ? <Txt testID="notify-empty" className="text-muted py-4">{t('inbox.subscribersNone')}</Txt>
          : (users ?? []).map((u, i) => (
            <View key={u.id} testID={`notify-user-${u.id}`} className={`flex-row items-center gap-3 py-3 ${i ? 'border-t border-line' : ''}`}>
              <View className="flex-1"><Txt className="font-bold text-[14px]" numberOfLines={1}>{u.name}</Txt><Txt className="text-muted text-[12px]" numberOfLines={1}>{u.whatsapp} · {[u.browsers ? `${u.browsers} ${t('inbox.browsers')}` : '', u.apps ? `${u.apps} ${t('inbox.apps')}` : ''].filter(Boolean).join(' · ')}</Txt></View>
              <View className="flex-row items-center gap-1.5"><View className={`w-2.5 h-2.5 rounded-full ${DOT[u.status]}`} /><Txt testID={`notify-status-${u.id}`} className="text-[12px] font-semibold">{t(`inbox.${u.status}`)}</Txt></View>
            </View>
          ))}
      </Card>
      </View>
      )}
      <Composer visible={!!editing} mode={editing?.mode ?? 'campaign'} campaign={editing?.campaign ?? null} onClose={() => setEditing(null)} />
    </AdminPage>
  );
}
