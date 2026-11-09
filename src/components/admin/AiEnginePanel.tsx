import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { api, backendEnabled } from '@/lib/backend';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { SettingAnchor } from '@/components/admin/AudienceBadge';

type Engine = { label: string; configured: boolean; source: 'env' | 'db' | 'model' | 'none' };
type Rotation = { on: boolean; ids: string[]; pool: { id: string; name: string; engine: string; modelName: string }[]; next: string; active: boolean };
type Status = { engines: Record<string, Engine>; live: boolean; chainI2I: string[]; chainT2I: string[]; rotation?: Rotation };
const NAMES = ['pollinations', 'openai'] as const;

/**
 * Rotation: ONE switch and a checklist of the models that take turns (each new creation uses the next one; a model without key or
 * resting is skipped by the server). The switch and the list are part of the settings draft (saved with the page's Save); "next" is
 * what the server will use for the next creation.
 */
function RotationBox({ status }: { status: Status | null }) {
  const { t } = useT();
  const models = useStore((s) => s.models);
  const rotation = useStore((s) => s.doc.settings.aiRotation);
  const { patch } = useDraftDoc('settings');
  const on = rotation?.on === true;
  const ids = rotation?.ids ?? [];
  // Only models that can run on an engine can take part, in the admin's order.
  const eligible = [...models].filter((m) => m.engine && m.modelName && m.enabled !== false && m.visible !== false).sort((a, b) => a.order - b.order);
  const chosen = eligible.filter((m) => ids.includes(m.id));
  const set = (next: string[]) => patch({ aiRotation: { on, ids: next } });
  const toggle = (id: string) => set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const next = status?.rotation?.active ? status.rotation.next : '';
  return (
    <SettingAnchor id="modelRotation"><View testID="ai-rotation" className="pt-3 mt-1 border-t border-line" style={{ gap: 10 }}>
      <View className="flex-row items-center gap-3">
        <View className="w-10 h-10 rounded-2xl bg-soft items-center justify-center"><Icon name="autorenew" size={22} tone="primary" /></View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt className="font-bold text-[14px]">{t('admin.ai.rot.title')}</Txt>
          <Txt className="text-muted text-[12px] mt-0.5">{t('admin.ai.rot.desc')}</Txt>
        </View>
        <Toggle testID="ai-rotation-toggle" label={t('admin.ai.rot.on')} value={on} onValueChange={(v) => patch({ aiRotation: { on: v, ids } })} />
      </View>
      {on ? (
        eligible.length === 0 ? <Txt testID="ai-rotation-none" className="text-[12.5px] text-danger">{t('admin.ai.rot.none')}</Txt> : (
          <View style={{ gap: 8 }}>
            <View className="flex-row items-center gap-2">
              <Txt className="text-[12.5px] font-bold text-muted flex-1">{t('admin.ai.rot.pick')}</Txt>
              <Pressable testID="ai-rotation-all" accessibilityRole="button" onPress={() => set(eligible.map((m) => m.id))} hitSlop={6} className="px-2.5 h-8 rounded-full bg-surface2 items-center justify-center active:opacity-70"><Txt className="text-[12px] font-bold">{t('admin.ai.rot.selectAll')}</Txt></Pressable>
              <Pressable testID="ai-rotation-none-btn" accessibilityRole="button" onPress={() => set([])} hitSlop={6} className="px-2.5 h-8 rounded-full bg-surface2 items-center justify-center active:opacity-70"><Txt className="text-[12px] font-bold">{t('admin.ai.rot.selectNone')}</Txt></Pressable>
            </View>
            {eligible.map((m) => {
              const picked = ids.includes(m.id);
              const place = chosen.findIndex((x) => x.id === m.id) + 1;
              return (
                <Pressable key={m.id} testID={`ai-rotation-${m.id}`} accessibilityRole="checkbox" accessibilityState={{ checked: picked }} onPress={() => toggle(m.id)}
                  className={`flex-row items-center rounded-2xl border px-3 min-h-[52px] active:opacity-80 ${picked ? 'border-primary bg-soft' : 'border-line bg-surface'}`} style={{ gap: 10 }}>
                  <View className={`w-6 h-6 rounded-md items-center justify-center border ${picked ? 'bg-primary border-primary' : 'border-line bg-surface2'}`}>{picked ? <Icon name="check" size={16} tone="onprimary" /> : null}</View>
                  <View className="flex-1" style={{ minWidth: 0 }}>
                    <Txt className="text-[14px] font-bold" numberOfLines={1}>{m.name}</Txt>
                    <Txt className="text-muted text-[11.5px]" numberOfLines={1}>{m.engine} · {m.modelName}</Txt>
                  </View>
                  {picked && next === m.id ? <View testID="ai-rotation-next" className="flex-row items-center rounded-full bg-primary px-2.5 h-7" style={{ gap: 4 }}><Icon name="arrow-right" size={13} tone="onprimary" flip /><Txt className="text-onprimary text-[11.5px] font-extrabold">{t('admin.ai.rot.next')}</Txt></View>
                    : picked ? <View className="rounded-full bg-surface2 px-2.5 h-7 items-center justify-center"><Txt className="text-muted text-[11.5px] font-bold">{place}</Txt></View> : null}
                </Pressable>
              );
            })}
            <Txt testID="ai-rotation-state" className={`text-[12px] ${chosen.length < 2 ? 'text-danger' : 'text-muted'}`}>{chosen.length < 2 ? t('admin.ai.rot.need') : status?.rotation && !status.rotation.active ? t('admin.ai.rot.idle') : t('admin.ai.rot.count', { n: chosen.length })}</Txt>
          </View>
        )
      ) : null}
    </View></SettingAnchor>
  );
}

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
  const [settled, setSettled] = useState(false);
  const load = useCallback(() => { api<Status>('/admin/ai/status').then(setStatus).catch(() => setStatus(null)).finally(() => setSettled(true)); }, []);
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
      {!settled ? <AdminLoading testID="ai-loading" /> : null}
      {status && !status.live ? <Txt testID="ai-no-engine" className="text-[12px] text-danger mb-3">{t('admin.ai.noEngine')}</Txt> : null}
      {settled ? NAMES.map((name) => {
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
      }) : null}
      {status?.chainI2I.length ? <Txt className="text-[12px] text-muted mb-1">{t('admin.ai.chainPhoto')}: {status.chainI2I.join(' → ')}</Txt> : null}
      {status?.chainT2I.length ? <Txt className="text-[12px] text-muted mb-3">{t('admin.ai.chainText')}: {status.chainT2I.join(' → ')}</Txt> : null}
      <RotationBox status={status} />
      <SettingAnchor id="modelPicker"><View className="flex-row items-center gap-3 pt-3 mt-3 border-t border-line">
        <View className="flex-1">
          <Txt className="font-bold text-[14px]">{t('admin.ai.picker')}</Txt>
          <Txt className="text-muted text-[12px] mt-0.5">{t('admin.ai.pickerDesc')}</Txt>
        </View>
        <Toggle testID="ai-model-picker" label={t('admin.ai.picker')} value={picker} onValueChange={(v) => patch({ aiModelPicker: v })} />
      </View></SettingAnchor>
    </Card>
  );
}
