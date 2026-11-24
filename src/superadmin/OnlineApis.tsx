/**
 * Super admin > APIs > Online APIs. The API finder's screen (server/apifinder.js): the best free interior-design image API right now,
 * every candidate with the reasons behind its score, the health of each source, and the switches (automatic scan, Autopilot).
 * Nothing on this screen ever holds a key: a key typed in "Connect" goes straight to the API manager and is never shown again.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { FinderCandidate, FinderReason, FinderSource, FinderStatus, FinderView } from '@/superadmin/types';
import { Badge, Btn, Card, Empty, ErrorLine, Field, Heading, Hint, ListRow, Loading, Notice, Row, Segmented, Sheet, Stat, T, ago, openUrl, useLoad } from '@/superadmin/ui';

/* i18n-map:start */
const STATUS_LABEL: Record<FinderStatus, string> = { verified: 'Working', unverified: 'Not tested yet', needs_key: 'Needs a free key', failing: 'Not working' };
const REASON: Record<string, string> = {
  photo: 'Edits a photo (what this app needs)', textOnly: 'Text-to-image only', editFailed: 'Photo edit tested and failed', quality: 'Quality of the model family',
  free: 'Completely free', freeTier: 'Free tier', health: 'Provider success rate {value} %', healthUnknown: 'Provider success rate unknown',
  proof: 'Real picture generated in {s} s', editProof: 'Real photo edit worked in {s} s', stability: 'Stable over past tests ({value} %)',
  stabilityNew: 'Too few tests to judge stability yet', failing: 'Last test failed', stale: 'The last test is old: test again',
};
const PROBLEM: Record<string, string> = {
  rate_limited: 'Rate limited right now', key_rejected: 'The key was rejected', no_credit: 'No credit left on the key', unsupported: 'Not supported',
  server_error: 'Provider error', error: 'Error', timeout: 'Too slow (timeout)', unreachable: 'Cannot be reached', blank: 'Returned a blank picture',
  not_an_image: 'Did not return a picture', too_small: 'Picture too small', unchanged: 'Edit returned the same picture', empty: 'Empty answer',
};
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'verified', label: 'Working' }, { value: 'photo', label: 'Edit photos' }, { value: 'needs_key', label: 'Needs key' }, { value: 'failing', label: 'Not working' },
];
/* i18n-map:end */
type Filter = 'all' | 'verified' | 'photo' | 'needs_key' | 'failing';

const seconds = (ms: number | null | undefined) => (ms == null ? '' : `${(ms / 1000).toFixed(1)}`);
const problem = (code: string) => (code.startsWith('http_') ? tr('Answered with error {code}', { code: code.slice(5) }) : tr(PROBLEM[code] || 'Error'));
const tone = (status: FinderStatus) => (status === 'verified' ? 'ok' : status === 'failing' ? 'danger' : status === 'needs_key' ? 'warn' : 'muted') as 'ok' | 'danger' | 'warn' | 'muted';
const scoreTone = (n: number) => (n >= 75 ? 'ok' : n >= 50 ? 'accent' : 'muted') as 'ok' | 'accent' | 'muted';

function reasonText(r: FinderReason) {
  const base = tr(REASON[r.code] || r.code, { value: r.value ?? '', s: seconds(r.ms) });
  return r.code === 'failing' && r.error ? `${base}: ${problem(r.error)}` : r.code === 'editFailed' && r.error ? `${base}: ${problem(r.error)}` : base;
}

/** Why a model got its score: every point is explained. */
function Detail({ c, onClose }: { c: FinderCandidate; onClose: () => void }) {
  return (
    <Sheet title={c.title} onClose={onClose} testID="sa-finder-detail">
      <Row style={{ marginBottom: SA.space.md }}>
        <Badge label={tr('Score {n}', { n: c.score })} tone={scoreTone(c.score)} />
        <Badge label={tr(STATUS_LABEL[c.status])} tone={tone(c.status)} />
        <Badge label={c.tier === 'free' ? tr('Free') : tr('Free tier')} tone="muted" />
      </Row>
      <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.md }}>{`${c.sourceLabel} · ${c.model}`}</T>
      {c.note ? <Hint>{c.note}</Hint> : null}
      {c.reasons.map((r, i) => (
        <Row key={`${r.code}${i}`} style={{ justifyContent: 'space-between', flexWrap: 'nowrap', paddingVertical: 4 }}>
          <T size="sm" style={{ flexShrink: 1 }}>{reasonText(r)}</T>
          <T size="sm" weight="bold" color={r.code === 'failing' || r.code === 'editFailed' ? SA.color.danger : SA.color.muted}>{r.points > 0 ? `+${r.points}` : '0'}</T>
        </Row>
      ))}
      <Row style={{ marginTop: SA.space.lg }}>
        {c.docs ? <Btn small kind="ghost" label={tr('Open the source')} onPress={() => openUrl(c.docs)} /> : null}
        {c.keyUrl && c.needsKey ? <Btn small kind="ghost" label={tr('Get a free key')} onPress={() => openUrl(c.keyUrl)} /> : null}
      </Row>
    </Sheet>
  );
}

/** Connect: the key goes to the API manager (write-only). Only engines the app can already call are connectable. */
function Connect({ c, onClose, onDone }: { c: FinderCandidate; onClose: () => void; onDone: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await sa('/finder/add', { method: 'POST', body: { id: c.id, apiKey: apiKey.trim() } }); onDone(); onClose(); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={tr('Connect {name}', { name: c.sourceLabel })} onClose={onClose} testID="sa-finder-connect">
      <Hint>{tr('Paste your free key. It is stored in the API manager on the server and can never be read back. The finder then tests every model with it.')}</Hint>
      {c.keyUrl ? <Btn small kind="ghost" label={tr('Get a free key')} onPress={() => openUrl(c.keyUrl)} /> : null}
      <View style={{ height: SA.space.md }} />
      <Field label={tr('API key')} value={apiKey} onChangeText={setApiKey} secureTextEntry {...({ testID: 'sa-finder-key' } as object)} />
      <ErrorLine error={error} />
      <Btn testID="sa-finder-connect-save" label={tr('Connect')} onPress={submit} busy={busy} disabled={apiKey.trim().length < 12} />
    </Sheet>
  );
}

function SourceRow({ s }: { s: FinderSource }) {
  const state = s.ok === null ? <Badge label={tr('not scanned')} tone="muted" /> : s.ok ? <Badge label={tr('online')} tone="ok" /> : <Badge label={tr('unreachable')} tone="danger" />;
  const sub = s.ok === null ? tr('Run a scan to check this source.')
    : s.ok ? tr('{n} free models · {paid} paid ignored · answered in {ms} ms', { n: s.count, paid: s.paid, ms: s.ms }) : `${problem(s.error)} · ${tr('its models keep their last result')}`;
  return <ListRow title={s.label} meta={state} sub={sub} testID="sa-finder-source" right={s.docs ? <Btn small kind="ghost" label={tr('Open the source')} onPress={() => openUrl(s.docs)} /> : null} />;
}

function Candidate({ c, onOpen, onConnect, onChanged, setIssue }: { c: FinderCandidate; onOpen: () => void; onConnect: () => void; onChanged: () => void; setIssue: (e: unknown) => void }) {
  const [busy, setBusy] = useState('');
  const run = async (name: string, work: () => Promise<unknown>) => { setBusy(name); setIssue(null); try { await work(); onChanged(); } catch (e) { setIssue(saMessage(e)); } finally { setBusy(''); } };
  const parts = [`${c.sourceLabel}`, c.i2i ? (c.i2iProven === true ? tr('edits photos (proven)') : c.i2iProven === false ? tr('photo edit failed') : tr('edits photos (not proven)')) : tr('text-to-image'),
    c.latencyMs != null ? tr('{s} s', { s: seconds(c.latencyMs) }) : '', c.lastError ? problem(c.lastError) : '', c.probedAt ? tr('tested {when}', { when: ago(c.probedAt) }) : ''].filter(Boolean);
  return (
    <ListRow title={c.title} testID="sa-finder-row" onPress={onOpen}
      meta={<Row style={{ gap: 4, flexWrap: 'nowrap' }}><Badge label={String(c.score)} tone={scoreTone(c.score)} /><Badge label={tr(STATUS_LABEL[c.status])} tone={tone(c.status)} />{c.banned ? <Badge label={tr('excluded')} tone="danger" /> : null}</Row>}
      sub={parts.join(' · ')}
      right={
        <Row>
          {c.testable ? <Btn small kind="ghost" label={tr('Test now')} busy={busy === 'test'} onPress={() => run('test', () => sa('/finder/test', { method: 'POST', body: { id: c.id } }))} /> : null}
          {c.connectable && c.needsKey ? <Btn small label={tr('Connect')} onPress={onConnect} /> : null}
          {!c.connectable && c.keyUrl && c.needsKey ? <Btn small kind="ghost" label={tr('Get a free key')} onPress={() => openUrl(c.keyUrl)} /> : null}
          <Btn small kind="ghost" label={c.banned ? tr('Include again') : tr('Exclude')} busy={busy === 'ban'} onPress={() => run('ban', async () => {
            const view = await sa<FinderView>('/finder');
            const banned = new Set(view.settings.banned);
            if (c.banned) banned.delete(c.id); else banned.add(c.id);
            await sa('/finder/settings', { method: 'PATCH', body: { banned: [...banned] } });
          })} />
        </Row>
      } />
  );
}

export function OnlineApis() {
  const { data, error, loading, reload } = useLoad(() => sa<FinderView>('/finder'));
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState('');
  const [issue, setIssue] = useState<unknown>(null);
  const [open, setOpen] = useState<FinderCandidate | null>(null);
  const [connect, setConnect] = useState<FinderCandidate | null>(null);
  const scanning = busy === 'scan' || !!data?.scanning;
  const act = async (name: string, work: () => Promise<unknown>) => { setBusy(name); setIssue(null); try { await work(); reload(); } catch (e) { setIssue(saMessage(e)); } finally { setBusy(''); } };
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorLine error={error} />;
  const best = data.candidates.find(c => c.id === data.best) || null;
  const suggested = data.candidates.find(c => c.id === data.suggested) || null;
  const s = data.settings;
  const shown = data.candidates.filter(c => filter === 'all' ? true : filter === 'photo' ? c.i2iProven === true : c.status === filter);
  const set = (body: Record<string, unknown>) => act('settings', () => sa('/finder/settings', { method: 'PATCH', body }));
  return (
    <View testID="sa-finder">
      <Heading title={tr('Online APIs')}
        hint={tr('Finds the best free image APIs for interior design on the internet, tests each one with a real picture (and a real photo edit), and ranks them. Nothing is trusted until it has worked.')}
        right={<Btn testID="sa-finder-scan" label={scanning ? tr('Scanning…') : tr('Scan now')} onPress={() => act('scan', () => sa('/finder/scan', { method: 'POST', body: {} }))} busy={scanning} />} />
      <ErrorLine error={issue} />
      <Hint>{data.at ? tr('Last scan {when}.', { when: ago(data.at) }) : tr('Not scanned yet. Press “Scan now”.')}{s.autoScan && data.nextScanAt ? ` ${tr('Next automatic scan {when}.', { when: new Date(data.nextScanAt).toLocaleTimeString() })}` : ''}</Hint>

      {!data.keys.pollinations ? <Notice tone="warn" testID="sa-finder-nokey">{tr('No Pollinations key yet: only the no-key model can be tested. Add a free key (Connect on any Pollinations model, or in API manager) to test them all.')}</Notice> : null}

      {best ? (
        <Card style={{ borderColor: SA.color.accent }}>
          <View testID="sa-finder-best">
            <T size="xs" weight="bold" color={SA.color.accent} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>{tr('Best working API right now')}</T>
            <T size="xl" weight="bold" style={{ marginTop: 4 }}>{best.title}</T>
            <T size="sm" color={SA.color.muted} style={{ marginTop: 2 }}>
              {[best.sourceLabel, best.i2iProven ? tr('edits photos (proven)') : tr('text-to-image'), tr('{s} s', { s: seconds(best.latencyMs) }), tr('score {n}', { n: best.score })].join(' · ')}
            </T>
            <Row style={{ marginTop: SA.space.md }}><Btn small kind="ghost" label={tr('Why this one')} onPress={() => setOpen(best)} /></Row>
          </View>
        </Card>
      ) : <Notice tone="accent">{tr('No API has proven itself yet. Scan, and the best one appears here.')}</Notice>}

      {!data.bestUsable && suggested ? (
        <Notice tone="warn" testID="sa-finder-suggested">{tr('The app cannot call the best one above yet. Next step: connect {name} with a free key, it is the best photo editor found.', { name: suggested.title })}</Notice>
      ) : null}

      <Row style={{ alignItems: 'stretch', marginBottom: SA.space.lg }}>
        <Stat label={tr('Found')} value={data.totals.found} testID="sa-finder-found" />
        <Stat label={tr('Working')} value={data.totals.verified} testID="sa-finder-verified" />
        <Stat label={tr('Edit photos')} value={data.totals.editing} testID="sa-finder-editing" />
        <Stat label={tr('Need a key')} value={data.totals.needKey} />
      </Row>

      <Card>
        <T size="lg" weight="bold">{tr('Autopilot')}</T>
        <Hint>{tr('When on, the image generator tries the models that proved they work (last 48 hours) before its built-in list. A model that stops working is dropped by itself, a new good one is picked up by itself. The built-in list stays behind as a safety net.')}</Hint>
        <Segmented testID="sa-finder-autopilot" value={s.autopilot ? 'on' : 'off'} onChange={v => set({ autopilot: v === 'on' })}
          options={[{ value: 'on', label: tr('On'), testID: 'sa-finder-autopilot-on' }, { value: 'off', label: tr('Off'), testID: 'sa-finder-autopilot-off' }]} />
        <View style={{ height: SA.space.lg }} />
        <T size="sm" weight="bold">{tr('Automatic scan')}</T>
        <Hint>{tr('Scans by itself and re-tests the oldest results. Each scan makes a few real generations with your key.')}</Hint>
        <Row>
          <Segmented value={s.autoScan ? 'on' : 'off'} onChange={v => set({ autoScan: v === 'on' })} options={[{ value: 'on', label: tr('On') }, { value: 'off', label: tr('Off') }]} />
          <Segmented value={String(s.intervalHours)} onChange={v => set({ intervalHours: Number(v) })}
            options={['3', '6', '12', '24'].map(h => ({ value: h, label: tr('every {n} h', { n: h }) }))} />
        </Row>
        <View style={{ height: SA.space.md }} />
        <T size="sm" weight="bold">{tr('Tests per scan')}</T>
        <Segmented value={String(s.probeMax)} onChange={v => set({ probeMax: Number(v) })} options={['2', '4', '6', '8'].map(n => ({ value: n, label: n }))} />
      </Card>
      <View style={{ height: SA.space.lg }} />

      <T size="lg" weight="bold" style={{ marginBottom: SA.space.sm }}>{tr('Sources')}</T>
      {data.sources.map(src => <SourceRow key={src.id} s={src} />)}
      <View style={{ height: SA.space.lg }} />

      <T size="lg" weight="bold" style={{ marginBottom: SA.space.sm }}>{tr('Everything found')}</T>
      <View style={{ marginBottom: SA.space.md }}>
        <Segmented<Filter> value={filter} onChange={setFilter} options={FILTERS.map(f => ({ value: f.value, label: tr(f.label), testID: `sa-finder-filter-${f.value}` }))} />
      </View>
      {shown.length ? shown.map(c => <Candidate key={c.id} c={c} onOpen={() => setOpen(c)} onConnect={() => setConnect(c)} onChanged={reload} setIssue={setIssue} />) : <Empty>{data.candidates.length ? tr('Nothing in this filter.') : tr('Nothing found yet. Press “Scan now”.')}</Empty>}
      {open ? <Detail c={open} onClose={() => setOpen(null)} /> : null}
      {connect ? <Connect c={connect} onClose={() => setConnect(null)} onDone={reload} /> : null}
    </View>
  );
}
