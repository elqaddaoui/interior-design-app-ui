import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Toggle } from '@/components/ui/Toggle';
import { api, backendEnabled } from '@/lib/backend';
import { DEFAULT_MAX_MS, DEFAULT_MIN_MS } from '@/lib/chatPace';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { Field, type Ctx } from '@/components/admin/FormModal';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import type { AssistantConfig } from '@/data/types';

type Provider = { label: string; configured: boolean; source: 'env' | 'db' | 'none'; cooling?: boolean };
type Status = Record<string, Provider>;
const KEYED = ['gemini', 'groq', 'openrouter'] as const;

/** Free AI providers, tried in order. Keys are write-only: the server never sends them back. */
function Providers() {
  const { t } = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [settled, setSettled] = useState(false);
  const load = useCallback(() => { api<Status>('/admin/chat/status').then(setStatus).catch(() => setStatus(null)).finally(() => setSettled(true)); }, []);
  useEffect(() => { if (backendEnabled) load(); }, [load]);
  if (!backendEnabled) return null;
  const write = async (name: string, value: string) => {
    setBusy(name);
    try {
      await api('/admin/chat/keys', { method: 'PATCH', body: { [name]: value } });
      setKeys((k) => ({ ...k, [name]: '' }));
      toast(t(value ? 'admin.assistant.keySaved' : 'admin.assistant.keyRemoved'));
      load();
    } catch (e) { toast(t((e as { code?: string })?.code === 'INVALID_KEY' || (e as { status?: number })?.status === 400 ? 'admin.assistant.keyInvalid' : 'common.error')); }
    setBusy('');
  };
  const any = status ? [...KEYED].some((k) => status[k]?.configured) : true;
  return (
    <Card className="p-3 mt-3" testID="asst-providers">
      <Txt className="text-[15px] font-extrabold">{t('admin.assistant.providersTitle')}</Txt>
      <Txt className="text-[12px] text-muted mt-0.5 mb-3">{t('admin.assistant.providersHint')}</Txt>
      {!settled ? <AdminLoading testID="asst-loading" /> : null}
      {!any ? <Txt testID="asst-no-provider" className="text-[12px] text-danger mb-3">{t('admin.assistant.noProvider')}</Txt> : null}
      {settled ? KEYED.map((name) => {
        const p = status?.[name];
        const state = !p?.configured ? 'provOff' : p.cooling ? 'provCooling' : 'provOn';
        return (
          <View key={name} className="mb-3">
            <View className="flex-row items-center gap-2 mb-1.5">
              <View className={`w-2 h-2 rounded-full ${p?.configured && !p.cooling ? 'bg-success' : p?.cooling ? '' : 'bg-muted'}`} style={p?.cooling ? { backgroundColor: '#d97706' } : undefined} />
              <Txt className="font-bold flex-1">{t(`admin.assistant.prov${name[0].toUpperCase()}${name.slice(1)}`)}</Txt>
              <Txt testID={`asst-prov-${name}`} className="text-[12px] text-muted">{t(`admin.assistant.${state}`)}{p?.configured ? ` · ${t(p.source === 'env' ? 'admin.assistant.srcEnv' : 'admin.assistant.srcDb')}` : ''}</Txt>
            </View>
            {p?.source === 'env' ? <Txt className="text-[12px] text-muted">{t('admin.assistant.keyEnv')}</Txt> : (
              <View className="flex-row items-center gap-2">
                <View className="flex-1"><Input tight testID={`asst-key-${name}`} value={keys[name] ?? ''} onChangeText={(v) => setKeys((k) => ({ ...k, [name]: v.trim() }))} placeholder={t('admin.assistant.keyPlaceholder')} autoCapitalize="none" autoCorrect={false} secureTextEntry /></View>
                <Button testID={`asst-key-save-${name}`} size="sm" title={t('admin.assistant.keySave')} disabled={!keys[name] || busy === name} loading={busy === name} onPress={() => write(name, keys[name])} />
                {p?.configured ? <Button testID={`asst-key-remove-${name}`} size="sm" variant="ghost" title={t('admin.assistant.keyRemove')} disabled={busy === name} onPress={() => write(name, '')} /> : null}
              </View>
            )}
          </View>
        );
      }) : null}
      <Txt className="text-[12px] text-muted">{t('admin.assistant.provPollinations')}: {t(status?.pollinations ? 'admin.assistant.provOn' : 'admin.assistant.provOff')}</Txt>
    </Card>
  );
}

/** How fast the assistant answers: instant, natural (scaled to length) or the admin's own bounds. */
function Pace({ c, setC }: { c: AssistantConfig; setC: (v: AssistantConfig) => void }) {
  const { t } = useT();
  const mode = c.replyDelayMode ?? 'auto';
  const secs = (ms: number | undefined, d: number) => String(Math.round(((ms ?? d) / 1000) * 10) / 10);
  const set = (key: 'replyDelayMinMs' | 'replyDelayMaxMs', text: string) => {
    const n = Number(text.replace(',', '.'));
    if (text === '' || !Number.isFinite(n)) return;
    setC({ ...c, [key]: Math.min(15000, Math.max(0, Math.round(n * 1000))) });
  };
  return (
    <Card className="p-3 mt-3" testID="asst-pace">
      <Txt className="text-[15px] font-extrabold">{t('admin.assistant.delayTitle')}</Txt>
      <Txt className="text-[12px] text-muted mt-0.5 mb-3">{t('admin.assistant.delayHint')}</Txt>
      <Segmented testID="asst-delay" optionPrefix="asst-delay" value={mode} onChange={(v) => setC({ ...c, replyDelayMode: v })}
        options={[{ key: 'off', label: t('admin.assistant.delayOff') }, { key: 'auto', label: t('admin.assistant.delayAuto') }, { key: 'custom', label: t('admin.assistant.delayCustom') }]} />
      {mode === 'custom' ? (
        <View className="flex-row gap-3 mt-3">
          <View className="flex-1"><Input tight label={t('admin.assistant.delayMin')} testID="asst-delay-min" keyboardType="decimal-pad" defaultValue={secs(c.replyDelayMinMs, DEFAULT_MIN_MS)} onEndEditing={(e) => set('replyDelayMinMs', e.nativeEvent.text)} onChangeText={(v) => set('replyDelayMinMs', v)} /></View>
          <View className="flex-1"><Input tight label={t('admin.assistant.delayMax')} testID="asst-delay-max" keyboardType="decimal-pad" defaultValue={secs(c.replyDelayMaxMs, DEFAULT_MAX_MS)} onEndEditing={(e) => set('replyDelayMaxMs', e.nativeEvent.text)} onChangeText={(v) => set('replyDelayMaxMs', v)} /></View>
        </View>
      ) : null}
      {mode !== 'off' ? (
        <View className="flex-row items-center justify-between mt-3">
          <Txt className="flex-1 font-semibold me-3">{t('admin.assistant.typewriter')}</Txt>
          <Toggle testID="asst-typewriter" value={c.typewriter !== false} onValueChange={(v) => setC({ ...c, typewriter: v })} label={t('admin.assistant.typewriter')} />
        </View>
      ) : null}
    </Card>
  );
}

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
        <Button testID="asst-save" title={t('improve.submit')} onPress={save} className="mt-2" />
      </Card>
      {c.type === 'ai' ? (<><Pace c={c} setC={setC} /><Providers /></>) : null}
    </AdminPage>
  );
}
