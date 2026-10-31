import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { api, backendEnabled } from '@/lib/backend';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import { useDraftDoc } from '@/hooks/useDraftDoc';

type Engine = { label: string; configured: boolean; source: 'env' | 'db' | 'model' | 'none' };
type Status = { engines: Record<string, Engine>; live: boolean; chainI2I: string[]; chainT2I: string[] };
const NAMES = ['pollinations', 'openai'] as const;

/**
 * Admin > AI models: which image engines have a key (write-only, never shown again), and whether clients may switch models.
 * Free default: Pollinations (one free key from enter.pollinations.ai). Any OpenAI-compatible images API can be added as well.
 */
export function AiEnginePanel() {
  const { t } = useT();
  const { patch } = useDraftDoc('settings');
  const picker = useStore((s) => s.doc.settings.aiModelPicker) === true;
  const [status, setStatus] = useState<Status | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const load = useCallback(() => { api<Status>('/admin/ai/status').then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => { if (backendEnabled) load(); }, [load]);
  if (!backendEnabled) return null;
  const write = async (name: string, value: string) => {
    setBusy(name);
    try {
      await api('/admin/ai/keys', { method: 'PATCH', body: { [name]: value } });
      setKeys((k) => ({ ...k, [name]: '' }));
      toast(t(value ? 'admin.assistant.keySaved' : 'admin.assistant.keyRemoved'));
      load();
    } catch (e) { toast(t((e as { status?: number })?.status === 400 ? 'admin.assistant.keyInvalid' : 'common.error')); }
    setBusy('');
  };
  return (
    <Card className="p-3 mb-3" testID="ai-engines">
      <Txt className="text-[15px] font-extrabold">{t('admin.ai.title')}</Txt>
      <Txt className="text-[12px] text-muted mt-0.5 mb-3">{t('admin.ai.hint')}</Txt>
      {status && !status.live ? <Txt testID="ai-no-engine" className="text-[12px] text-danger mb-3">{t('admin.ai.noEngine')}</Txt> : null}
      {NAMES.map((name) => {
        const e = status?.engines[name];
        return (
          <View key={name} className="mb-3">
            <View className="flex-row items-center gap-2 mb-1.5">
              <View className={`w-2 h-2 rounded-full ${e?.configured ? 'bg-success' : 'bg-muted'}`} />
              <Txt className="font-bold flex-1">{t(`admin.ai.${name}`)}</Txt>
              <Txt testID={`ai-engine-${name}`} className="text-[12px] text-muted">{t(e?.configured ? 'admin.assistant.provOn' : 'admin.assistant.provOff')}{e?.configured ? ` · ${t(e.source === 'env' ? 'admin.assistant.srcEnv' : 'admin.assistant.srcDb')}` : ''}</Txt>
            </View>
            {e?.source === 'env' ? <Txt className="text-[12px] text-muted">{t('admin.assistant.keyEnv')}</Txt> : (
              <View className="flex-row items-center gap-2">
                <View className="flex-1"><Input tight testID={`ai-key-${name}`} value={keys[name] ?? ''} onChangeText={(v) => setKeys((k) => ({ ...k, [name]: v.trim() }))} placeholder={t('admin.assistant.keyPlaceholder')} autoCapitalize="none" autoCorrect={false} secureTextEntry /></View>
                <Button testID={`ai-key-save-${name}`} size="sm" title={t('admin.assistant.keySave')} disabled={!keys[name] || busy === name} loading={busy === name} onPress={() => write(name, keys[name])} />
                {e?.configured ? <Button testID={`ai-key-remove-${name}`} size="sm" variant="ghost" title={t('admin.assistant.keyRemove')} disabled={busy === name} onPress={() => write(name, '')} /> : null}
              </View>
            )}
          </View>
        );
      })}
      {status?.chainI2I.length ? <Txt className="text-[12px] text-muted mb-1">{t('admin.ai.chainPhoto')}: {status.chainI2I.join(' → ')}</Txt> : null}
      {status?.chainT2I.length ? <Txt className="text-[12px] text-muted mb-3">{t('admin.ai.chainText')}: {status.chainT2I.join(' → ')}</Txt> : null}
      <View className="flex-row items-center gap-3 pt-3 border-t border-line">
        <View className="flex-1">
          <Txt className="font-bold text-[14px]">{t('admin.ai.picker')}</Txt>
          <Txt className="text-muted text-[12px] mt-0.5">{t('admin.ai.pickerDesc')}</Txt>
        </View>
        <Toggle testID="ai-model-picker" label={t('admin.ai.picker')} value={picker} onValueChange={(v) => patch({ aiModelPicker: v })} />
      </View>
    </Card>
  );
}
