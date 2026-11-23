import React, { useState } from 'react';
import { View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { AbuseAlert, AbuseSettings, AlertConfig, ApiKind } from '@/superadmin/types';
import { BrowserNotifyCard } from '@/superadmin/NoticeCenter';
import { Badge, Btn, Card, Empty, ErrorLine, Field, Heading, Hint, ListRow, Loading, Notice, Row, Segmented, T, ago, useLoad } from '@/superadmin/ui';

const RULE_NAME: Record<string, string> = {
  burst: 'Burst of API calls',
  daily: 'Daily API cap reached',
  spike: 'Usage spike',
  failures: 'Many failing API calls',
  probe: 'Repeated attempts while AI is switched off',
};
const KIND_NAME: Record<ApiKind, string> = { image: 'Images', text: 'Text / chat', other: 'Other' };
const SEVERITY_TONE = { medium: 'warn', high: 'danger', critical: 'danger' } as const;

function AlertRow({ alert, onChanged }: { alert: AbuseAlert; onChanged: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const act = async (work: () => Promise<unknown>) => { setError(null); try { await work(); onChanged(); } catch (e) { setError(saMessage(e)); } };
  const d = alert.detail;
  const what = alert.title === 'failures'
    ? tr('{value} % of calls failed (alert level {limit} %)', { value: d.value, limit: d.limit })
    : tr('{value} calls in about {min} min (alert level {limit})', { value: d.value, min: d.windowMin, limit: d.limit });
  const open = alert.status === 'open';
  return (
    <View testID="sa-alert-row">
      <ListRow title={`${tr(RULE_NAME[alert.title] || 'API warning')} · ${alert.store}`}
        meta={<Row style={{ gap: 4 }}><Badge label={tr(alert.severity === 'medium' ? 'medium' : alert.severity === 'high' ? 'high' : 'critical')} tone={SEVERITY_TONE[alert.severity]} />{alert.action === 'paused' ? <Badge label={tr('API paused')} tone="warn" /> : null}{!open ? <Badge label={tr('resolved')} tone="ok" /> : null}</Row>}
        sub={`${ago(alert.at)} · ${alert.storeKind === 'demo' ? tr('Demo') : tr('Store')} · ${d.kind ? tr(KIND_NAME[d.kind]) : ''} · ${what}`}
        right={open ? (
          <Row>
            {alert.action === 'paused' ? <Btn small kind="ghost" label={tr('Resume API')} onPress={() => act(() => sa(`/tenants/${alert.tenantId}/ai-pause`, { method: 'POST', body: { paused: false } }))} /> : null}
            <Btn small kind="ghost" label={tr('Mark as reviewed')} onPress={() => act(() => sa(`/alerts/${alert.id}/resolve`, { method: 'POST', body: {} }))} />
          </Row>
        ) : undefined} />
      <ErrorLine error={error} />
    </View>
  );
}

const NUM_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'burst.image', label: 'Pictures per 10 minutes' },
  { key: 'burst.text', label: 'Texts per 10 minutes' },
  { key: 'burst.other', label: 'Other calls per 10 minutes' },
  { key: 'demoBurst', label: 'Any call per 10 minutes, demos' },
  { key: 'daily.image', label: 'Pictures per day' },
  { key: 'daily.text', label: 'Texts per day' },
  { key: 'daily.other', label: 'Other calls per day' },
  { key: 'spikeFactor', label: 'Spike: times the usual hourly use' },
  { key: 'minSpike', label: 'Spike: ignore below this many calls' },
  { key: 'failureRate', label: 'Failing calls (%)' },
  { key: 'probe', label: 'Refused attempts per 10 minutes' },
];
const read = (s: AbuseSettings, key: string): number => { const [a, b] = key.split('.'); const v = b ? (s as unknown as Record<string, Record<string, number>>)[a][b] : (s as unknown as Record<string, number>)[a]; return Number(v); };
const write = (s: AbuseSettings, key: string, value: number): AbuseSettings => {
  const [a, b] = key.split('.');
  const copy = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  if (b) (copy[a] as Record<string, number>)[b] = value; else copy[a] = value;
  return copy as unknown as AbuseSettings;
};

function Settings({ config, onSaved }: { config: AlertConfig; onSaved: () => void }) {
  const [draft, setDraft] = useState<AbuseSettings>(config.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const save = async () => {
    setBusy(true); setError(null); setNote(null);
    try { await sa('/alert-settings', { method: 'PATCH', body: draft }); setNote({ tone: 'ok', text: tr('Saved.') }); onSaved(); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <T weight="bold" size="lg">{tr('Warning settings')}</T>
      <Hint>{tr('When a store or a demo uses the APIs in an unusual way, you get a notification. Demos and stores that use your keys are also paused automatically; stores with their own keys are only reported.')}</Hint>
      <Row style={{ marginBottom: SA.space.md }}>
        <T size="sm">{tr('Warnings')}</T>
        <Segmented value={draft.enabled ? 'on' : 'off'} onChange={v => setDraft({ ...draft, enabled: v === 'on' })} options={[{ value: 'on', label: tr('On') }, { value: 'off', label: tr('Off') }]} />
        <T size="sm">{tr('Pause automatically')}</T>
        <Segmented value={draft.autoPause ? 'on' : 'off'} onChange={v => setDraft({ ...draft, autoPause: v === 'on' })} options={[{ value: 'on', label: tr('On') }, { value: 'off', label: tr('Off') }]} />
      </Row>
      <Field label={tr('Same warning again after (minutes)')} value={String(draft.cooldownMin)} onChangeText={v => setDraft({ ...draft, cooldownMin: Number(v.replace(/\D/g, '')) || 0 })} keyboardType="number-pad" />
      <Btn small kind="ghost" label={advanced ? tr('Hide the thresholds') : tr('Edit the thresholds')} onPress={() => setAdvanced(!advanced)} />
      {advanced ? (
        <View style={{ marginTop: SA.space.md }}>
          {NUM_FIELDS.map(f => <Field key={f.key} label={tr(f.label)} value={String(read(draft, f.key))} onChangeText={v => setDraft(write(draft, f.key, Number(v.replace(/\D/g, '')) || 0))} keyboardType="number-pad" />)}
          <Btn small kind="ghost" label={tr('Back to the defaults')} onPress={() => setDraft({ ...config.defaults })} />
        </View>
      ) : null}
      <ErrorLine error={error} />
      {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}
      <Row style={{ marginTop: SA.space.md }}>
        <Btn testID="sa-alert-save" label={tr('Save')} onPress={save} busy={busy} />
      </Row>
    </Card>
  );
}

/** Abuse warnings: the open list, the pause switch of each flagged store and the e-mail settings. */
export function ApiAlerts() {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const list = useLoad(() => sa<{ alerts: AbuseAlert[]; open: number }>(`/alerts?status=${filter}`), [filter]);
  const conf = useLoad(() => sa<AlertConfig>('/alert-settings'));
  const [error, setError] = useState<unknown>(null);
  const resolveAll = async () => { setError(null); try { await sa('/alerts/resolve-all', { method: 'POST', body: {} }); list.reload(); } catch (e) { setError(saMessage(e)); } };
  return (
    <View testID="sa-alerts">
      <Heading title={tr('API warnings')} hint={tr('Unusual use of the APIs: bursts, daily excess, sudden spikes, many failures. Each one reaches you as a notification.')}
        right={list.data?.open ? <Btn small kind="ghost" label={tr('Mark all as reviewed')} onPress={resolveAll} /> : undefined} />
      <Segmented value={filter} onChange={setFilter} options={[{ value: 'open', label: tr('To review') }, { value: 'all', label: tr('History') }]} />
      <View style={{ height: SA.space.md }} />
      <BrowserNotifyCard />
      <ErrorLine error={list.error || error} />
      {list.loading && !list.data ? <Loading /> : list.data?.alerts.length ? list.data.alerts.map(a => <AlertRow key={a.id} alert={a} onChanged={list.reload} />) : <Empty>{filter === 'open' ? tr('Nothing unusual to review.') : tr('No warnings yet.')}</Empty>}
      <View style={{ height: SA.space.lg }} />
      {conf.data ? <Settings config={conf.data} onSaved={conf.reload} /> : conf.error ? <ErrorLine error={conf.error} /> : <Loading />}
    </View>
  );
}
