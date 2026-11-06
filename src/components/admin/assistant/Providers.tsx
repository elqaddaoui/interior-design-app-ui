import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { ConfirmSheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { Chips, Label, Note, OptionTiles } from '@/components/admin/promptcards/ui';
import { StateBadge } from './ui';
import { api, backendEnabled } from '@/lib/backend';
import { useT } from '@/i18n';
import { toast } from '@/store/useToast';
import { MAX_PAID, canEnable, clone, configBody, configDirty, configOf, newPaid, orderedChain, paidErrors, type AutomationsInfo, type ChatStatus, type PaidDraft, type ProvConfig } from '@/lib/assistantAdmin';

/** Provider status (read from the server) and the owner's draft of the config; saved as a whole by the page's save bar. */
export function useProviders() {
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [saved, setSaved] = useState<ProvConfig | null>(null);
  const [cfg, setCfg] = useState<ProvConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async (keepDraft = false) => {
    if (!backendEnabled) return;
    try {
      const s = await api<ChatStatus>('/admin/chat/status');
      setStatus(s); setFailed(false);
      const next = configOf(s);
      setSaved(next);
      if (!keepDraft) setCfg(clone(next));
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const dirty = !!cfg && !!saved && configDirty(cfg, saved);
  const invalid = !!cfg && cfg.paid.some((p) => paidErrors(p).length > 0);
  const save = async () => {
    if (!cfg) return true;
    try {
      const s = await api<ChatStatus>('/admin/chat/config', { method: 'PUT', body: configBody(cfg) });
      setStatus(s); const next = configOf(s); setSaved(next); setCfg(clone(next));
      return true;
    } catch { return false; }
  };
  const discard = () => { if (saved) setCfg(clone(saved)); };
  return { status, cfg, setCfg, dirty, invalid, save, discard, load, failed };
}
export type ProvidersApi = ReturnType<typeof useProviders>;

function Reason({ last }: { last: { ok: boolean; reason: string; model: string } | null }) {
  const { t } = useT();
  if (!last) return null;
  return <Txt className={`text-[12px] ${last.ok ? 'text-muted' : 'text-danger'}`}>{last.ok ? t('asx.p.lastOk') : `${t('asx.p.lastFail')} · ${t(`asx.p.reason.${last.reason}`)}`}{last.model ? ` · ${last.model}` : ''}</Txt>;
}

function FreeCard({ p, off, onToggle, reload }: { p: ChatStatus['free'][number]; off: boolean; onToggle: (on: boolean) => void; reload: () => void }) {
  const { t } = useT();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const write = async (value: string) => {
    setBusy(true);
    try {
      await api('/admin/chat/keys', { method: 'PATCH', body: { [p.id]: value } });
      setKey(''); toast(t(value ? 'asx.p.keySaved' : 'asx.p.keyRemoved')); reload();
    } catch { toast(t('asx.p.keyInvalid')); }
    setBusy(false);
  };
  const usable = p.configured || !p.needsKey;
  return (
    <Card testID={`asst-prov-${p.id}`} className="p-3">
      <View className="flex-row items-center gap-2">
        <View className="w-7 h-7 rounded-full bg-surface2 items-center justify-center"><Txt className="text-[12px] font-extrabold">{p.rank}</Txt></View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt className="font-extrabold text-[15px]" numberOfLines={1}>{p.label}</Txt>
          <Txt className="text-[12px] text-muted">{t(`asx.p.why.${p.id}`)}</Txt>
        </View>
        <Toggle testID={`asst-prov-${p.id}-on`} value={!off && usable} disabled={!usable} onValueChange={onToggle} label={p.label} />
      </View>
      <View className="flex-row items-center gap-2 flex-wrap mt-2">
        <StateBadge testID={`asst-prov-${p.id}-state`} state={off && usable ? 'off' : p.state} />
        <Txt className="text-[12px] text-muted">{!p.needsKey ? t('asx.p.noKeyNeeded') : p.source === 'env' ? t('asx.p.keyEnv') : p.configured ? t('asx.p.keyHas') : t('asx.p.keyNone')}</Txt>
      </View>
      <View className="mt-1"><Reason last={p.last} /></View>
      {p.needsKey && p.source !== 'env' ? (
        <View className="flex-row items-center gap-2 mt-2">
          <View className="flex-1"><Input tight testID={`asst-key-${p.id}`} value={key} onChangeText={(v) => setKey(v.trim())} placeholder={t('asx.p.keyPlaceholder')} autoCapitalize="none" autoCorrect={false} secureTextEntry /></View>
          <Button testID={`asst-key-save-${p.id}`} size="sm" title={t('asx.p.keySave')} disabled={!key || busy} loading={busy} onPress={() => write(key)} />
          {p.configured ? <Button testID={`asst-key-remove-${p.id}`} size="sm" variant="ghost" title={t('asx.p.keyRemove')} disabled={busy} onPress={() => write('')} /> : null}
        </View>
      ) : null}
      {p.models.length ? <Txt className="text-[11.5px] text-muted mt-2" numberOfLines={2}>{t('asx.p.models')} : {p.models.join(' · ')}</Txt> : null}
    </Card>
  );
}

function PaidCard({ p, status, onChange, onDelete }: { p: PaidDraft; status: ChatStatus; onChange: (v: PaidDraft) => void; onDelete: () => void }) {
  const { t } = useT();
  const live = status.paid.providers.find((x) => x.id === p.id);
  const errs = paidErrors(p);
  const ready = canEnable(p);
  const [ask, setAsk] = useState(false);
  const presets = Object.keys(status.presets);
  return (
    <Card testID={`asst-paid-${p.id}`} className="p-3">
      <View className="flex-row items-center gap-2 mb-2">
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt className="font-extrabold text-[15px]" numberOfLines={1}>{p.label || t(`asx.p.presets.${p.preset}`)}</Txt>
          <View className="flex-row items-center gap-2 mt-1 flex-wrap">
            <StateBadge testID={`asst-paid-${p.id}-state`} state={!p.enabled || !ready ? 'off' : live?.state ?? 'ready'} />
            {live ? <Reason last={live.last} /> : null}
          </View>
        </View>
        <View className="items-end gap-1">
          <Toggle testID={`asst-paid-${p.id}-on`} value={p.enabled && ready} disabled={!ready} onValueChange={(v) => onChange({ ...p, enabled: v })} label={t('asx.p.enable')} />
          {!ready ? <Txt className="text-[11px] text-muted">{t('asx.p.enableLocked')}</Txt> : null}
        </View>
      </View>
      <Label>{t('asx.p.preset')}</Label>
      <Chips testID={`asst-paid-${p.id}-preset`} value={p.preset} onChange={(v) => onChange({ ...p, preset: v, label: p.label && p.label !== t(`asx.p.presets.${p.preset}`) ? p.label : t(`asx.p.presets.${v}`), model: status.presets[v]?.model ?? p.model })} options={presets.map((k) => ({ key: k, label: t(`asx.p.presets.${k}`) }))} />
      <View style={{ gap: 8 }} className="mt-3">
        <Input tight label={t('asx.p.label')} testID={`asst-paid-${p.id}-label`} value={p.label} onChangeText={(v) => onChange({ ...p, label: v })} maxLength={40} />
        {p.preset === 'custom' ? <>
          <Input tight label={t('asx.p.baseUrl')} testID={`asst-paid-${p.id}-url`} value={p.baseUrl} onChangeText={(v) => onChange({ ...p, baseUrl: v.trim() })} autoCapitalize="none" autoCorrect={false} placeholder="https://…/v1/chat/completions" invalid={errs.includes('url')} />
          <Txt className="text-[11.5px] text-muted -mt-1">{t('asx.p.baseUrlHint')}</Txt>
          {errs.includes('url') ? <Txt testID={`asst-paid-${p.id}-url-err`} className="text-danger text-[12px]">{t('asx.p.errUrl')}</Txt> : null}
        </> : null}
        <Input tight label={t('asx.p.model')} testID={`asst-paid-${p.id}-model`} value={p.model} onChangeText={(v) => onChange({ ...p, model: v.trim() })} autoCapitalize="none" autoCorrect={false} invalid={errs.includes('model')} />
        <View>
          <Input tight label={t('asx.p.key')} testID={`asst-paid-${p.id}-key`} value={p.key ?? ''} onChangeText={(v) => onChange({ ...p, key: v.trim() })} placeholder={p.hasKey && p.key === undefined ? t('asx.p.keyKeep') : t('asx.p.keyPlaceholder')} autoCapitalize="none" autoCorrect={false} secureTextEntry invalid={errs.includes('key')} />
          {errs.includes('key') ? <Txt className="text-danger text-[12px] mt-1">{t('asx.p.errKey')}</Txt> : null}
        </View>
      </View>
      <View className="flex-row items-center justify-end gap-2 mt-3">
        {p.hasKey && p.key === undefined ? <Button testID={`asst-paid-${p.id}-key-remove`} size="sm" variant="soft" title={t('asx.p.keyRemove')} onPress={() => onChange({ ...p, key: '', enabled: false })} /> : null}
        <Button testID={`asst-paid-${p.id}-delete`} size="sm" variant="danger" icon="trash-can-outline" title={t('asx.p.remove')} onPress={() => setAsk(true)} />
      </View>
      <ConfirmSheet visible={ask} onClose={() => setAsk(false)} onConfirm={() => { setAsk(false); onDelete(); }} message={t('asx.p.removeConfirm')} confirmLabel={t('asx.p.remove')} cancelLabel={t('asx.discard')} />
    </Card>
  );
}

export function Providers({ api: pv, totals }: { api: ProvidersApi; totals?: AutomationsInfo['totals'] }) {
  const { t } = useT();
  const { status, cfg, setCfg, failed, load } = pv;
  if (failed && !status) return <Card className="p-4 items-center gap-3"><Txt testID="asst-prov-error" className="text-danger">{t('asx.loadFail')}</Txt><Button size="sm" title={t('asx.retry')} onPress={() => load()} /></Card>;
  if (!status || !cfg) return <AdminLoading testID="asst-loading" />;
  const chain = orderedChain(status, cfg);
  const noKey = !status.free.some((p) => p.needsKey && p.configured);
  const full = cfg.paid.length >= Math.min(MAX_PAID, status.maxPaid);
  const setPaid = (id: string, v: PaidDraft) => setCfg({ ...cfg, paid: cfg.paid.map((x) => (x.id === id ? v : x)) });
  return (
    <View style={{ gap: 12 }} testID="asst-providers">
      <View>
        <Txt className="text-[15px] font-extrabold">{t('asx.p.freeTitle')}</Txt>
        <Txt className="text-[12px] text-muted mt-0.5">{t('asx.p.freeHint')}</Txt>
      </View>
      {noKey ? <Note testID="asst-no-provider" tone="warn" text={t('asx.p.noFree')} /> : null}
      {status.free.map((p) => <FreeCard key={p.id} p={p} off={cfg.freeOff.includes(p.id)} reload={() => load(true)} onToggle={(on) => setCfg({ ...cfg, freeOff: on ? cfg.freeOff.filter((x) => x !== p.id) : [...cfg.freeOff, p.id] })} />)}

      <View className="mt-2">
        <Txt className="text-[15px] font-extrabold">{t('asx.p.paidTitle')}</Txt>
        <Txt className="text-[12px] text-muted mt-0.5">{t('asx.p.paidHint')}</Txt>
      </View>
      <Card className="p-3">
        <Label>{t('asx.p.position')}</Label>
        <OptionTiles testID="asst-position" value={cfg.position} onChange={(v) => setCfg({ ...cfg, position: v })}
          options={[{ key: 'before', label: t('asx.p.before'), sub: t('asx.p.beforeSub'), icon: 'arrow-collapse-up' }, { key: 'after', label: t('asx.p.after'), sub: t('asx.p.afterSub'), icon: 'arrow-collapse-down' }]} />
      </Card>
      {cfg.paid.map((p) => <PaidCard key={p.id} p={p} status={status} onChange={(v) => setPaid(p.id, v)} onDelete={() => setCfg({ ...cfg, paid: cfg.paid.filter((x) => x.id !== p.id) })} />)}
      <Button testID="asst-paid-add" variant="soft" icon="plus" title={full ? t('asx.p.maxPaid') : t('asx.p.add')} disabled={full} onPress={() => setCfg({ ...cfg, paid: [...cfg.paid, newPaid('openai', status.presets)] })} />

      <Card className="p-3" testID="asst-chain">
        <Label>{t('asx.p.chainTitle')}</Label>
        {chain.length ? (
          <View className="flex-row flex-wrap items-center gap-1.5">
            {chain.map((c, i) => (
              <View key={c.id} className="flex-row items-center gap-1.5">
                {i ? <Txt className="text-muted">›</Txt> : null}
                <View className={`px-2.5 h-7 rounded-full items-center justify-center ${c.paid ? 'bg-primary' : 'bg-surface2'}`}><Txt className={`text-[12px] font-bold ${c.paid ? 'text-onprimary' : ''}`}>{c.label}</Txt></View>
              </View>
            ))}
          </View>
        ) : <Txt className="text-[12px] text-danger">{t('asx.p.chainEmpty')}</Txt>}
      </Card>

      {totals ? (
        <Card className="p-3" testID="asst-stats">
          <Label>{t('asx.p.stats')}</Label>
          <View className="flex-row gap-2">
            {([['statAi', totals.ai], ['statAuto', totals.automations], ['statFail', totals.failed]] as const).map(([k, n]) => (
              <View key={k} className="flex-1 bg-surface2 rounded-xl p-2.5"><Txt className="text-[20px] font-extrabold">{n}</Txt><Txt className="text-[11.5px] text-muted" numberOfLines={2}>{t(`asx.p.${k}`)}</Txt></View>
            ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
}
