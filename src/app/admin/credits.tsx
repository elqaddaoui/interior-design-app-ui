import { useViewState } from '@/hooks/useViewState';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { router, useBackCheckpoint, useLeaveGuard } from '@/hooks/useLeaveGuard';
import { toast } from '@/store/useToast';

export default function Credits() {
  const { t } = useT();
  const s = useStore();
  const users = s.users.filter((u) => u.role === 'user');
  const [def, setDef] = useState(String(s.doc.settings.defaultFreeCredits));
  const [uid, setUid] = useViewState('credit-user', users[0]?.id ?? '');
  const [amt, setAmt] = useViewState('credit-amount', '1');
  const saveDef = async () => { await s.patchDoc('settings', { defaultFreeCredits: Math.max(0, parseInt(def, 10) || 0) }); toast(t('admin.crud.saved')); };
  const dirty = def !== String(s.doc.settings.defaultFreeCredits);
  useLeaveGuard(dirty, saveDef, () => setDef(String(s.doc.settings.defaultFreeCredits)), { before: { defaultFreeCredits: String(s.doc.settings.defaultFreeCredits) }, after: { defaultFreeCredits: def } });
  useBackCheckpoint(dirty, () => router.back());
  const grant = async () => {
    const u = s.users.find((x) => x.id === uid); const n = parseInt(amt, 10) || 0;
    if (!u || n <= 0) return;
    await s.update('users', u.id, { credits: u.credits + n });
    toast(t('admin.credits.granted'));
  };
  if (!s.contentReady || !s.adminLoaded) return <AdminPage title={t('admin.nav.credits')} max={720}><AdminLoading /></AdminPage>;
  return (
    <AdminPage title={t('admin.nav.credits')} max={720}>
      <Card className="p-3 mb-3">
        <Input testID="credits-default" label={t('admin.credits.defaultCredits')} value={def} onChangeText={(v) => setDef(v.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Txt className="text-muted text-[12px] mb-3 -mt-1">{t('admin.credits.defaultNote')}</Txt>
        <Button testID="credits-save" title={t('improve.submit')} onPress={saveDef} />
      </Card>
      <Card className="p-3">
        <Txt className="font-extrabold text-[17px] mb-3">{t('admin.credits.grant')}</Txt>
        <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('admin.credits.user')}</Txt>
        <View className="flex-row flex-wrap gap-2 mb-4">
          {users.map((u) => (
            <Pressable key={u.id} testID={`grant-user-${u.id}`} onPress={() => setUid(u.id)} className={`px-3.5 h-9 rounded-full justify-center ${uid === u.id ? 'bg-primary' : 'bg-surface2'}`}>
              <Txt className={`text-[13px] font-semibold ${uid === u.id ? 'text-onprimary' : ''}`}>{u.name || t('admin.enums.user')} · {u.credits}</Txt>
            </Pressable>
          ))}
        </View>
        <Input testID="credits-amount" label={t('admin.credits.amount')} value={amt} onChangeText={(v) => setAmt(v.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Button testID="credits-grant" title={t('admin.credits.grantBtn')} icon="plus" onPress={grant} />
      </Card>
    </AdminPage>
  );
}
