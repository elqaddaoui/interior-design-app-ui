import React from 'react';
import { View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { Field, type Ctx } from '@/components/admin/FormModal';
import { Label, OptionTiles } from '@/components/admin/promptcards/ui';
import { DEFAULT_MAX_MS, DEFAULT_MIN_MS } from '@/lib/chatPace';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import type { AssistantConfig } from '@/data/types';

/** Mode, welcome, personality and pace: everything about how the assistant talks, in one card. */
export function Behaviour({ c, setC }: { c: AssistantConfig; setC: (v: AssistantConfig) => void }) {
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const ctx: Ctx = { s, L, t };
  const mode = c.replyDelayMode ?? 'auto';
  const secs = (ms: number | undefined, d: number) => String(Math.round(((ms ?? d) / 1000) * 10) / 10);
  const setDelay = (key: 'replyDelayMinMs' | 'replyDelayMaxMs', text: string) => {
    const n = Number(text.replace(',', '.'));
    if (text === '' || !Number.isFinite(n)) return;
    setC({ ...c, [key]: Math.min(15000, Math.max(0, Math.round(n * 1000))) });
  };
  return (
    <View style={{ gap: 12 }} testID="asx-panel-behaviour">
      <Card className="p-3">
        <Label>{t('asx.b.mode')}</Label>
        <OptionTiles testID="asst-type" value={c.type} onChange={(v) => setC({ ...c, type: v })}
          options={[{ key: 'ai', label: t('asx.b.modeAi'), sub: t('asx.b.modeAiSub'), icon: 'robot-outline' }, { key: 'whatsapp', label: t('asx.b.modeWa'), sub: t('asx.b.modeWaSub'), icon: 'whatsapp' }]} />
        {c.type === 'whatsapp' ? <View className="mt-3"><Input testID="asst-number" label={t('asx.b.number')} value={c.whatsappNumber} onChangeText={(v) => setC({ ...c, whatsappNumber: v })} keyboardType="phone-pad" placeholder="+212…" /></View> : null}
      </Card>
      <Card className="p-3">
        <Label hint={t('asx.b.welcomeHint')}>{t('asx.b.welcome')}</Label>
        <Field ctx={ctx} f={{ kind: 'ltext', key: 'welcome', label: '', multiline: true }} value={c.welcome} onChange={(v) => setC({ ...c, welcome: v })} />
      </Card>
      {c.type === 'ai' ? (<>
        <Card className="p-3">
          <Label hint={t('asx.b.promptHint')}>{t('asx.b.prompt')}</Label>
          <Input tight testID="asst-prompt" value={c.systemPrompt} onChangeText={(v) => setC({ ...c, systemPrompt: v })} multiline style={{ minHeight: 120, textAlignVertical: 'top', paddingTop: 12 }} />
        </Card>
        <Card className="p-3" testID="asst-pace">
          <Label hint={t('admin.assistant.delayHint')}>{t('asx.b.pace')}</Label>
          <Segmented testID="asst-delay" optionPrefix="asst-delay" value={mode} onChange={(v) => setC({ ...c, replyDelayMode: v })}
            options={[{ key: 'off', label: t('admin.assistant.delayOff') }, { key: 'auto', label: t('admin.assistant.delayAuto') }, { key: 'custom', label: t('admin.assistant.delayCustom') }]} />
          {mode === 'custom' ? (
            <View className="flex-row gap-3 mt-3">
              <View className="flex-1"><Input tight label={t('admin.assistant.delayMin')} testID="asst-delay-min" keyboardType="decimal-pad" defaultValue={secs(c.replyDelayMinMs, DEFAULT_MIN_MS)} onEndEditing={(e) => setDelay('replyDelayMinMs', e.nativeEvent.text)} onChangeText={(v) => setDelay('replyDelayMinMs', v)} /></View>
              <View className="flex-1"><Input tight label={t('admin.assistant.delayMax')} testID="asst-delay-max" keyboardType="decimal-pad" defaultValue={secs(c.replyDelayMaxMs, DEFAULT_MAX_MS)} onEndEditing={(e) => setDelay('replyDelayMaxMs', e.nativeEvent.text)} onChangeText={(v) => setDelay('replyDelayMaxMs', v)} /></View>
            </View>
          ) : null}
          {mode !== 'off' ? (
            <View className="flex-row items-center justify-between mt-3">
              <Txt className="flex-1 font-semibold me-3">{t('admin.assistant.typewriter')}</Txt>
              <Toggle testID="asst-typewriter" value={c.typewriter !== false} onValueChange={(v) => setC({ ...c, typewriter: v })} label={t('admin.assistant.typewriter')} />
            </View>
          ) : null}
        </Card>
      </>) : null}
    </View>
  );
}
