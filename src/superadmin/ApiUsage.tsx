import React, { useState } from 'react';
import { View } from 'react-native';
import { sa } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { ApiKind, UsageRange, UsageReport } from '@/superadmin/types';
import { Badge, Card, Empty, ErrorLine, Heading, Loading, Row, Segmented, Stat, T, Toolbar, useLoad } from '@/superadmin/ui';

const KIND_NAME: Record<ApiKind, string> = { image: 'Images', text: 'Text / chat', other: 'Other' };
const KIND_COLOR: Record<ApiKind, string> = { image: '#6C63FF', text: '#2EA66B', other: '#E0A030' };
const MODE_NAME = { own: 'Store keys', platform: 'Managed by me' } as const;

const num = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));

/** One bar per time step, stacked by modality: the shape of the traffic at a glance. */
function Bars({ report }: { report: UsageReport }) {
  const max = Math.max(1, ...report.series.map(p => p.image + p.text + p.other));
  const day = report.range !== '24h';
  return (
    <View testID="sa-usage-bars">
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 2 }}>
        {report.series.map(p => {
          const total = p.image + p.text + p.other;
          return (
            <View key={p.t} accessibilityLabel={`${new Date(p.t).toLocaleString()}: ${total}`} style={{ flex: 1, height: 90, justifyContent: 'flex-end' }}>
              {(['other', 'text', 'image'] as ApiKind[]).map(k => (p[k] ? <View key={k} style={{ height: Math.max(2, (p[k] / max) * 90), backgroundColor: KIND_COLOR[k] }} /> : null))}
            </View>
          );
        })}
      </View>
      <Row style={{ marginTop: SA.space.sm, gap: SA.space.md }}>
        {(['image', 'text', 'other'] as ApiKind[]).map(k => (
          <Row key={k} style={{ gap: 4 }}><View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: KIND_COLOR[k] }} /><T size="xs" color={SA.color.muted}>{tr(KIND_NAME[k])}</T></Row>
        ))}
        <T size="xs" color={SA.color.muted}>{day ? tr('One bar per day') : tr('One bar per hour')}</T>
      </Row>
    </View>
  );
}

function Line({ label, c, sub }: { label: string; c: { calls: number; errors: number; blocked: number }; sub?: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderColor: SA.color.line, flexWrap: 'nowrap' }}>
      <View style={{ flexShrink: 1 }}>
        <T size="sm" weight="bold" numberOfLines={1}>{label}</T>
        {sub ? <T size="xs" color={SA.color.muted} numberOfLines={1}>{sub}</T> : null}
      </View>
      <Row style={{ gap: 6, flexWrap: 'nowrap' }}>
        {c.errors ? <Badge label={tr('{n} failed', { n: c.errors })} tone="warn" /> : null}
        {c.blocked ? <Badge label={tr('{n} refused', { n: c.blocked })} tone="muted" /> : null}
        <T size="sm" weight="bold">{num(c.calls)}</T>
      </Row>
    </Row>
  );
}

function Block({ title, children, empty }: { title: string; children: React.ReactNode; empty: boolean }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: 300, minWidth: 260 }}>
      <T size="xs" weight="bold" color={SA.color.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SA.space.sm }}>{title}</T>
      {empty ? <Empty>{tr('No calls in this period.')}</Empty> : children}
    </Card>
  );
}

/** API consumption of every store and demo, whichever side holds the key. */
export function ApiUsage() {
  const [range, setRange] = useState<UsageRange>('24h');
  const [kind, setKind] = useState<'all' | ApiKind>('all');
  const [mode, setMode] = useState<'all' | 'own' | 'platform'>('all');
  const { data, error, loading } = useLoad(
    () => sa<UsageReport>(`/usage?range=${range}${kind !== 'all' ? `&kind=${kind}` : ''}${mode !== 'all' ? `&mode=${mode}` : ''}`),
    [range, kind, mode],
  );
  return (
    <View testID="sa-usage">
      <Heading title={tr('API consumption')} hint={tr('Every call made for a store or a demo: pictures, texts and anything else, whether the store uses its own keys or yours.')} />
      <Toolbar>
        <Segmented value={range} onChange={setRange} options={[{ value: '24h', label: tr('24 hours') }, { value: '7d', label: tr('7 days') }, { value: '30d', label: tr('30 days') }]} />
        <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: tr('All kinds') }, { value: 'image', label: tr(KIND_NAME.image) }, { value: 'text', label: tr(KIND_NAME.text) }, { value: 'other', label: tr(KIND_NAME.other) }]} />
        <Segmented value={mode} onChange={setMode} options={[{ value: 'all', label: tr('Any keys') }, { value: 'platform', label: tr(MODE_NAME.platform) }, { value: 'own', label: tr(MODE_NAME.own) }]} />
      </Toolbar>
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : data ? (
        <View>
          <Row style={{ alignItems: 'stretch', marginBottom: SA.space.md }}>
            <Stat testID="sa-usage-calls" label={tr('Calls')} value={num(data.totals.calls)} />
            <Stat label={tr('Failed')} value={num(data.totals.errors)} hint={data.totals.calls ? `${Math.round((data.totals.errors / data.totals.calls) * 100)}%` : undefined} />
            <Stat label={tr('Refused')} value={num(data.totals.blocked)} hint={tr('demo off or store paused')} />
            <Stat label={tr('Units')} value={num(data.totals.units)} hint={tr('pictures, texts…')} />
          </Row>
          <Card><Bars report={data} /></Card>
          <Row style={{ alignItems: 'stretch', gap: SA.space.md }}>
            <Block title={tr('By kind')} empty={!data.byKind.length}>
              {data.byKind.map(r => <Line key={r.kind} label={tr(KIND_NAME[r.kind])} c={r} />)}
            </Block>
            <Block title={tr('By provider')} empty={!data.byProvider.length}>
              {data.byProvider.map(r => <Line key={`${r.kind}${r.provider}${r.mode}`} label={r.provider} c={r} sub={`${tr(KIND_NAME[r.kind])} · ${tr(MODE_NAME[r.mode])}`} />)}
            </Block>
            <Block title={tr('By operation')} empty={!data.byOp.length}>
              {data.byOp.map(r => <Line key={`${r.kind}${r.op}`} label={r.op} c={r} sub={tr(KIND_NAME[r.kind])} />)}
            </Block>
          </Row>
          <Card style={{ marginTop: SA.space.md }}>
            <T size="xs" weight="bold" color={SA.color.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SA.space.sm }}>{tr('Busiest stores')}</T>
            {data.stores.length ? data.stores.map(s => (
              <View key={s.tenantId} testID="sa-usage-store">
                <Line label={s.name} c={s}
                  sub={`${s.storeKind === 'demo' ? tr('Demo') : tr('Store')} · ${tr(MODE_NAME[s.mode])} · ${tr('{image} pictures · {text} texts · {other} other', { image: s.image, text: s.text, other: s.other })}${s.paused ? ` · ${tr('API paused')}` : ''}`} />
              </View>
            )) : <Empty>{tr('No calls in this period.')}</Empty>}
          </Card>
        </View>
      ) : null}
    </View>
  );
}
