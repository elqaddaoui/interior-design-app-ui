import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { Note, Tabs } from '@/components/admin/promptcards/ui';
import { Automations, useAutomations } from '@/components/admin/assistant/Automations';
import { Behaviour } from '@/components/admin/assistant/Behaviour';
import { Knowledge } from '@/components/admin/assistant/Knowledge';
import { Providers, useProviders } from '@/components/admin/assistant/Providers';
import { backendEnabled } from '@/lib/backend';
import { router, useBackCheckpoint, useLeaveGuard } from '@/hooks/useLeaveGuard';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { useT } from '@/i18n';
import { toast } from '@/store/useToast';

type TabKey = 'behaviour' | 'providers' | 'knowledge' | 'automations';
const TAB_ICON: Record<TabKey, string> = { behaviour: 'tune-variant', providers: 'server-network', knowledge: 'book-open-page-variant-outline', automations: 'lightning-bolt-outline' };

/** The three steps a customer message goes through, so the four tabs make sense at a glance. */
function Flow() {
  const { t } = useT();
  const steps = [['s1', 'lightning-bolt-outline'], ['s2', 'book-open-page-variant-outline'], ['s3', 'swap-horizontal']] as const;
  return (
    <Card testID="asx-flow" className="p-3 mb-3">
      <Txt className="text-[12.5px] font-extrabold text-muted mb-2">{t('asx.flow.title')}</Txt>
      <View className="flex-row gap-2">
        {steps.map(([k, icon], i) => (
          <View key={k} className="flex-1 bg-surface2 rounded-xl p-2.5 gap-1" style={{ minWidth: 0 }}>
            <View className="flex-row items-center gap-1.5">
              <View className="w-5 h-5 rounded-full bg-primary items-center justify-center"><Txt className="text-[10.5px] font-extrabold text-onprimary">{i + 1}</Txt></View>
              <Icon name={icon} size={16} tone="primary" />
            </View>
            <Txt className="text-[12.5px] font-extrabold" numberOfLines={2}>{t(`asx.flow.${k}`)}</Txt>
            <Txt className="text-[11px] text-muted" numberOfLines={4}>{t(`asx.flow.${k}d`)}</Txt>
          </View>
        ))}
      </View>
    </Card>
  );
}

export default function AssistantAdmin() {
  const { t } = useT();
  const doc = useDraftDoc('assistant');
  const prov = useProviders();
  const auto = useAutomations();
  const [tab, setTab] = useState<TabKey>('behaviour');
  const [saving, setSaving] = useState(false);
  const c = doc.draft;

  // The content doc has its own guard (useDraftDoc); providers and automations share this one.
  const extraDirty = prov.dirty || auto.dirty;
  const dirty = doc.dirty || extraDirty;
  const blocked = prov.invalid;
  const saveExtra = async () => {
    if (prov.invalid) { toast(t('asx.saveFail')); return false; }
    const a = prov.dirty ? await prov.save() : true;
    const b = auto.dirty ? await auto.save() : true;
    return a && b;
  };
  const discardExtra = () => { prov.discard(); auto.discard(); };
  useLeaveGuard(extraDirty, saveExtra, discardExtra);
  useBackCheckpoint(extraDirty && !doc.dirty, () => router.back());

  const save = async () => {
    if (blocked) { setTab('providers'); toast(t('asx.saveFail')); return; }
    setSaving(true);
    try {
      const ok = (doc.dirty ? await doc.save() : true) && (extraDirty ? await saveExtra() : true);
      toast(t(ok ? 'asx.saved' : 'asx.saveFail'));
    } finally { setSaving(false); }
  };
  const discard = () => { doc.discard(); discardExtra(); };

  const live = backendEnabled && c.type === 'ai';
  const tabs: { key: TabKey; label: string; icon: string; dot: boolean }[] = [
    { key: 'behaviour', label: t('asx.tabs.behaviour'), icon: TAB_ICON.behaviour, dot: doc.dirty && tab !== 'knowledge' },
    ...(live ? [
      { key: 'providers' as TabKey, label: t('asx.tabs.providers'), icon: TAB_ICON.providers, dot: prov.dirty },
      { key: 'knowledge' as TabKey, label: t('asx.tabs.knowledge'), icon: TAB_ICON.knowledge, dot: false },
      { key: 'automations' as TabKey, label: t('asx.tabs.automations'), icon: TAB_ICON.automations, dot: auto.dirty },
    ] : []),
  ];
  const current: TabKey = tabs.some((x) => x.key === tab) ? tab : 'behaviour';

  const bar = dirty ? (
    <Card testID="asx-savebar" className="p-3 flex-row items-center gap-2 flex-wrap" style={Platform.OS === 'web' ? ({ boxShadow: '0 8px 28px rgba(0,0,0,0.18)' } as object) : undefined}>
      <Icon name="alert-circle-outline" size={18} tone="primary" />
      <Txt className="font-bold flex-1" style={{ minWidth: 120 }}>{t('asx.unsaved')}</Txt>
      <Button testID="asx-discard" size="sm" variant="ghost" title={t('asx.discard')} onPress={discard} disabled={saving} />
      <Button testID="asst-save" size="sm" icon="content-save-outline" title={t('asx.save')} onPress={save} loading={saving} />
    </Card>
  ) : null;

  return (
    <AdminPage title={t('asx.title')} max={820} floating={bar}>
      <Txt className="text-[13px] text-muted mb-3">{t('asx.intro')}</Txt>
      {live ? <Flow /> : null}
      {!backendEnabled ? <Note tone="info" testID="asx-offline" text={t('asx.offline')} /> : null}
      {tabs.length > 1 ? <Tabs prefix="asx" value={current} onChange={setTab} options={tabs} /> : null}
      <View className="mt-3">
        {current === 'behaviour' ? <Behaviour c={c} setC={doc.set} /> : null}
        {current === 'providers' ? <Providers api={prov} totals={auto.info?.totals} /> : null}
        {current === 'knowledge' ? <Knowledge c={c} setC={doc.set} /> : null}
        {current === 'automations' ? <Automations api={auto} /> : null}
      </View>
    </AdminPage>
  );
}
