import React from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, Icon, Input, Txt } from '@/components/ui';
import { AdminPage } from '@/components/admin/AdminShell';
import { Field, type Ctx } from '@/components/admin/FormModal';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import type { AssistantConfig } from '@/data/types';

export default function AssistantAdmin() {
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const { draft: c, set: setC, save: submitDraft } = useDraftDoc('assistant');
  const ctx: Ctx = { s, L, t };
  const save = async () => { if (await submitDraft()) toast(t('admin.crud.saved')); };
  const types: AssistantConfig['type'][] = ['ai', 'whatsapp'];
  return (
    <AdminPage title={t('admin.nav.assistant')} max={760}>
      <Card className="p-3">
        <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('admin.assistant.type')}</Txt>
        <View className="flex-row gap-3 mb-3">
          {types.map((k) => (
            <Pressable key={k} testID={`asst-${k}`} onPress={() => setC({ ...c, type: k })} className={`flex-1 h-14 rounded-2xl flex-row items-center justify-center gap-2 ${c.type === k ? 'bg-primary' : 'bg-surface2'}`}>
              <Icon name={k === 'ai' ? 'robot-outline' : 'whatsapp'} size={22} tone={c.type === k ? 'onprimary' : 'fg'} />
              <Txt className={`font-bold ${c.type === k ? 'text-onprimary' : ''}`}>{t(`admin.assistant.${k}`)}</Txt>
            </Pressable>
          ))}
        </View>
        {c.type === 'ai' ? (<>
          <Field ctx={ctx} f={{ kind: 'select', key: 'modelId', label: t('admin.assistant.model'), options: (x) => x.s.models.filter((m) => m.enabled).map((m) => ({ value: m.id, label: m.name })) }} value={c.modelId} onChange={(v) => setC({ ...c, modelId: v })} />
          <Input testID="asst-prompt" label={t('admin.assistant.prompt')} value={c.systemPrompt} onChangeText={(v) => setC({ ...c, systemPrompt: v })} multiline style={{ minHeight: 120, textAlignVertical: 'top', paddingTop: 12 }} />
        </>) : (
          <Input testID="asst-number" label={t('admin.assistant.number')} value={c.whatsappNumber} onChangeText={(v) => setC({ ...c, whatsappNumber: v })} keyboardType="phone-pad" placeholder="+212…" />
        )}
        <Field ctx={ctx} f={{ kind: 'ltext', key: 'welcome', label: t('admin.assistant.welcome'), multiline: true }} value={c.welcome} onChange={(v) => setC({ ...c, welcome: v })} />
        <Button testID="asst-save" title="Submit" onPress={save} className="mt-2" />
      </Card>
    </AdminPage>
  );
}
