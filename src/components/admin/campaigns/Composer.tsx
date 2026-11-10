import React from 'react';
import { Pressable, View } from 'react-native';
import { usePopupHistory } from '@/hooks/usePopupHistory';
import { PopupHistoryButtons } from '@/components/admin/PopupHistoryButtons';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Sheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { LangField } from '@/components/admin/LangField';
import { Chip, NotificationPreview, Section, useCampaignError } from '@/components/admin/campaigns/parts';
import type { Lang, LText } from '@/data/types';
import { useT } from '@/i18n';
import { api, BackendError } from '@/lib/backend';
import { atDay, dateInput, isTime, parseWhen, timeInput } from '@/lib/campaignTime';
import { SEGMENTS, useAdminCampaigns, type Campaign, type CampaignInput, type Freq, type Person, type Segment, type SegmentCount, type TriggerEvent } from '@/store/useAdminCampaigns';
import { toast } from '@/store/useToast';

const LINKS = ['/', '/explore', '/assistant', '/history', '/pro', '/settings'];
const EVENTS: TriggerEvent[] = ['signup', 'first_design', 'no_design', 'inactive'];
const FREQS: Freq[] = ['daily', 'weekly', 'monthly'];
const EMPTY: LText = { dar: '', ar: '', fr: '' };
const MAX_TITLE = 60, MAX_BODY = 140;
const SEG_ICON: Record<Segment, string> = { all: 'account-group-outline', new: 'account-plus-outline', existing: 'account-check-outline', inactive: 'sleep', image_users: 'image-auto-adjust', no_image: 'image-off-outline' };
const EVENT_ICON: Record<TriggerEvent, string> = { signup: 'hand-wave-outline', first_design: 'party-popper', no_design: 'image-plus', inactive: 'account-clock-outline' };
type When = 'now' | 'later' | 'repeat';
const num = (v: string, fallback: number) => { const n = parseInt(v.replace(/[^0-9]/g, ''), 10); return Number.isFinite(n) ? n : fallback; };
const len = (v: string) => Array.from(v).length;

function NumberInput({ label, value, onChange, testID, suffix }: { label: string; value: number; onChange: (n: number) => void; testID: string; suffix?: string }) {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => { setText(String(value)); }, [value]);
  return (
    <View className="flex-1" style={{ minWidth: 140 }}>
      <Txt className="text-[12px] font-semibold text-muted mb-1" numberOfLines={2}>{label}</Txt>
      <View className="flex-row items-center gap-2">
        <View className="flex-1"><Input tight testID={testID} keyboardType="number-pad" value={text} onChangeText={v => { setText(v); onChange(num(v, 0)); }} /></View>
        {suffix ? <Txt className="text-muted text-[12px]">{suffix}</Txt> : null}
      </View>
    </View>
  );
}

/** Create / edit a campaign (one-time or repeating) or an automation. Everything the server needs lives in this one popup. */
export function Composer({ visible, onClose, mode, campaign }: { visible: boolean; onClose: () => void; mode: 'campaign' | 'automation'; campaign: Campaign | null }) {
  const { t, lang } = useT();
  const explain = useCampaignError();
  const store = useAdminCampaigns();
  const auto = mode === 'automation';
  const locked = !!campaign && campaign.kind === 'once' && ['sending', 'sent'].includes(campaign.status);
  const live = !!campaign && ['scheduled', 'active'].includes(campaign.status);

  const [name, setName] = React.useState('');
  const [title, setTitle] = React.useState<LText>(EMPTY);
  const [body, setBody] = React.useState<LText>(EMPTY);
  const [url, setUrl] = React.useState('/');
  const [segments, setSegments] = React.useState<Segment[]>([]);
  const [clientIds, setClientIds] = React.useState<string[]>([]);
  const [newDays, setNewDays] = React.useState(7);
  const [inactiveDays, setInactiveDays] = React.useState(14);
  const [when, setWhen] = React.useState<When>('now');
  const [date, setDate] = React.useState('');
  const [time, setTime] = React.useState('09:00');
  const [freq, setFreq] = React.useState<Freq>('daily');
  const [days, setDays] = React.useState<number[]>([1]);
  const [dayOfMonth, setDayOfMonth] = React.useState(1);
  const [endDate, setEndDate] = React.useState('');
  const [event, setEvent] = React.useState<TriggerEvent>('signup');
  const [delayMinutes, setDelayMinutes] = React.useState(10);
  const [afterDays, setAfterDays] = React.useState(3);
  const [cooldownDays, setCooldownDays] = React.useState(30);
  const [includeExisting, setIncludeExisting] = React.useState(false);
  const [quiet, setQuiet] = React.useState(true);
  const [quietFrom, setQuietFrom] = React.useState('22:00');
  const [quietTo, setQuietTo] = React.useState('08:00');
  const [previewLang, setPreviewLang] = React.useState<Lang>(lang);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState<'' | 'save' | 'go' | 'test'>('');
  const [counts, setCounts] = React.useState<Record<Segment, SegmentCount> | null>(null);
  const [reach, setReach] = React.useState<{ reachable: number; reachableTotal: number } | null>(null);
  const [people, setPeople] = React.useState<Person[] | null>(null);
  const [pick, setPick] = React.useState(false);
  const [query, setQuery] = React.useState('');

  // (Re)load the form every time the popup opens.
  React.useEffect(() => {
    if (!visible) return;
    const c = campaign;
    setName(c?.name ?? ''); setTitle(c?.title ?? EMPTY); setBody(c?.body ?? EMPTY); setUrl(c?.url ?? '/');
    setSegments(c?.audience?.segments ?? []); setClientIds(c?.audience?.clientIds ?? []); setNewDays(c?.audience?.newDays ?? 7); setInactiveDays(c?.audience?.inactiveDays ?? 14);
    const s = c?.schedule;
    setWhen(c?.kind === 'recurring' ? 'repeat' : c?.kind === 'once' && s?.at ? 'later' : 'now');
    setDate(s?.at ? dateInput(s.at) : dateInput(atDay(1, 9))); setTime(s?.at ? timeInput(s.at) : '09:00');
    setFreq(s?.freq ?? 'daily'); setDays(s?.days?.length ? s.days : [1]); setDayOfMonth(s?.dayOfMonth ?? 1); setEndDate(s?.endAt ? dateInput(s.endAt) : '');
    if (c?.kind === 'recurring' && s?.time) setTime(s.time);
    const tr = c?.trigger;
    setEvent(tr?.event ?? 'signup'); setDelayMinutes(tr?.delayMinutes ?? 10); setAfterDays(tr?.afterDays ?? 3); setCooldownDays(tr?.cooldownDays ?? 30); setIncludeExisting(tr?.includeExisting ?? false);
    setQuiet(tr ? !!tr.quiet : true); setQuietFrom(tr?.quiet ?? '22:00'); setQuietTo(tr?.quietTo ?? '08:00');
    setPreviewLang(lang); setError(''); setPick(false); setQuery(''); setBusy('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, campaign?.id]);

  // Undo / redo: every editable field travels as ONE snapshot (header buttons + Ctrl+Z / Ctrl+Y while this popup is on top).
  const form = { name, title, body, url, segments, clientIds, newDays, inactiveDays, when, date, time, freq, days, dayOfMonth, endDate, event, delayMinutes, afterDays, cooldownDays, includeExisting, quiet, quietFrom, quietTo };
  const hist = usePopupHistory(form, (f) => {
    setName(f.name); setTitle(f.title); setBody(f.body); setUrl(f.url); setSegments(f.segments); setClientIds(f.clientIds); setNewDays(f.newDays); setInactiveDays(f.inactiveDays);
    setWhen(f.when); setDate(f.date); setTime(f.time); setFreq(f.freq); setDays(f.days); setDayOfMonth(f.dayOfMonth); setEndDate(f.endDate); setEvent(f.event);
    setDelayMinutes(f.delayMinutes); setAfterDays(f.afterDays); setCooldownDays(f.cooldownDays); setIncludeExisting(f.includeExisting); setQuiet(f.quiet); setQuietFrom(f.quietFrom); setQuietTo(f.quietTo);
  }, { active: visible, resetKey: campaign?.id ?? 'new' });

  // Segment sizes (also react to the "new / inactive" thresholds).
  React.useEffect(() => {
    if (!visible || auto) return;
    const timer = setTimeout(() => { api<Record<Segment, SegmentCount>>(`/admin/campaigns/segments?newDays=${newDays || 7}&inactiveDays=${inactiveDays || 14}`).then(setCounts).catch(() => setCounts(null)); }, 300);
    return () => clearTimeout(timer);
  }, [visible, auto, newDays, inactiveDays]);
  // Exact reach of the current selection.
  React.useEffect(() => {
    if (!visible || auto) return;
    if (!segments.length && !clientIds.length) { setReach(null); return; }
    const timer = setTimeout(() => { api<{ reachable: number; reachableTotal: number }>('/admin/campaigns/preview', { method: 'POST', body: { segments, clientIds, newDays: newDays || 7, inactiveDays: inactiveDays || 14 } }).then(setReach).catch(() => setReach(null)); }, 300);
    return () => clearTimeout(timer);
  }, [visible, auto, segments, clientIds, newDays, inactiveDays]);
  React.useEffect(() => {
    if (!visible || !pick || people) return;
    api<Person[]>('/admin/campaigns/people').then(setPeople).catch(() => setPeople([]));
  }, [visible, pick, people]);

  const toggleSeg = (s: Segment) => setSegments(old => (old.includes(s) ? old.filter(x => x !== s) : [...old, s]));
  const toggleDay = (d: number) => setDays(old => (old.includes(d) ? old.filter(x => x !== d) : [...old, d].sort()));
  const togglePerson = (id: string) => setClientIds(old => (old.includes(id) ? old.filter(x => x !== id) : [...old, id]));

  const kind = auto ? 'trigger' : when === 'repeat' ? 'recurring' : 'once';
  const input = (): CampaignInput | string => {
    const base = { name: name.trim(), title, body, url };
    if (kind === 'trigger') return { kind, ...base, trigger: { event, delayMinutes, afterDays, cooldownDays, includeExisting, quiet, quietFrom, quietTo } };
    const audience = { segments, clientIds, newDays: newDays || 7, inactiveDays: inactiveDays || 14 };
    if (kind === 'once') {
      if (when === 'later') { const at = parseWhen(date, time); if (!at) return 'INVALID_DATE'; return { kind, ...base, audience, schedule: { at } }; }
      return { kind, ...base, audience, schedule: { at: null } };
    }
    if (!isTime(time)) return 'INVALID_TIME';
    const end = endDate.trim() ? parseWhen(endDate, '23:59') : null;
    if (endDate.trim() && !end) return 'INVALID_DATE';
    return { kind, ...base, audience, schedule: { freq, time, days, dayOfMonth, startAt: campaign?.schedule?.startAt ?? null, endAt: end } };
  };

  const run = async (go: boolean) => {
    if (busy) return;
    const built = input();
    if (typeof built === 'string') { setError(t(`camp.err.${built}`)); return; }
    setError(''); setBusy(go ? 'go' : 'save');
    try {
      const saved = await store.save(campaign?.id ?? null, built);
      if (go && !live) {
        const done = await store.activate(saved.id);
        toast(t(auto ? 'camp.activated' : done.kind === 'once' ? (when === 'now' ? 'camp.launched' : 'camp.scheduledOk') : 'camp.activated'));
      } else toast(t('camp.saved'));
      onClose();
    } catch (e) { setError(explain(e)); }
    finally { setBusy(''); }
  };
  const test = async () => {
    if (busy) return;
    setBusy('test');
    try {
      const r = await api<{ ok: boolean }>('/admin/campaigns/test', { method: 'POST', body: { title, body, url } });
      toast(t(r.ok ? 'camp.testOk' : 'camp.testFail'));
    } catch (e) { toast(t(e instanceof BackendError && e.code === 'NO_SUBSCRIPTION' ? 'camp.testNone' : 'camp.testFail')); }
    finally { setBusy(''); }
  };

  const shown = (v: LText) => (v[previewLang] || v.dar || v.ar || v.fr || '').replace('{name}', t('camp.previewName'));
  const overTitle = Math.max(...Object.values(title).map(len)) > MAX_TITLE, overBody = Math.max(...Object.values(body).map(len)) > MAX_BODY;
  const q = query.trim().toLowerCase();
  const list = (people ?? []).filter(p => !q || p.name.toLowerCase().includes(q) || p.whatsapp.includes(q)).slice(0, 60);
  const heading = auto ? (campaign ? t('camp.titleEditA') : t('camp.titleNewA')) : campaign ? t('camp.titleEdit') : t('camp.titleNew');
  const primary = live ? t('camp.saveChanges') : auto ? t('camp.activateAuto') : when === 'now' ? t('camp.launch') : when === 'later' ? t('camp.schedule') : t('camp.activateRepeat');
  const whenOptions: { key: When; label: string }[] = campaign ? (campaign.kind === 'recurring' ? [{ key: 'repeat', label: t('camp.repeat') }] : [{ key: 'now', label: t('camp.now') }, { key: 'later', label: t('camp.later') }])
    : [{ key: 'now', label: t('camp.now') }, { key: 'later', label: t('camp.later') }, { key: 'repeat', label: t('camp.repeat') }];

  const footer = locked ? null : (
    <View className="flex-row flex-wrap items-center gap-2">
      <Button testID="camp-test" size="sm" variant="ghost" icon="bell-ring-outline" title={t('camp.sendTest')} loading={busy === 'test'} disabled={!!busy && busy !== 'test'} onPress={() => { void test(); }} />
      <View className="flex-1" />
      {!live ? <Button testID="camp-save" variant="outline" title={t('camp.saveDraft')} loading={busy === 'save'} disabled={!!busy && busy !== 'save'} onPress={() => { void run(false); }} /> : null}
      <Button testID="camp-go" title={primary} loading={busy === 'go' || (live && busy === 'save')} disabled={!!busy && busy !== 'go'} onPress={() => { void run(!live); }} />
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title={heading} wide footer={footer} headerRight={visible && !locked ? <PopupHistoryButtons api={hist} prefix="camp" /> : undefined}>
      {locked ? <View className="flex-row items-center gap-2 bg-surface2 rounded-xl p-3 mb-4"><Icon name="lock-outline" size={18} tone="muted" /><Txt className="flex-1 text-[13px]">{t('camp.locked')}</Txt></View> : null}
      <View pointerEvents={locked ? 'none' : 'auto'} style={{ opacity: locked ? 0.55 : 1 }}>
        <Section title={t('camp.name')} hint={t('camp.nameHint')}>
          <Input tight testID="camp-name" placeholder={t('camp.namePh')} value={name} onChangeText={setName} maxLength={80} />
        </Section>

        <Section title={t('camp.message')} hint={t('camp.tokenHint')}>
          <LangField label={t('camp.msgTitle')} fieldKey="camp-title" value={title} onChange={setTitle} />
          <Txt testID="camp-title-count" className={`text-[11px] self-end ${overTitle ? 'text-danger' : 'text-muted'}`}>{t('camp.chars', { n: Math.max(...Object.values(title).map(len)), max: MAX_TITLE })}</Txt>
          <LangField label={t('camp.msgBody')} fieldKey="camp-body" value={body} onChange={setBody} multiline />
          <Txt testID="camp-body-count" className={`text-[11px] self-end ${overBody ? 'text-danger' : 'text-muted'}`}>{t('camp.chars', { n: Math.max(...Object.values(body).map(len)), max: MAX_BODY })}</Txt>
          <View className="flex-row flex-wrap gap-2 items-center">
            <Txt className="text-[12px] font-semibold text-muted">{t('camp.link')}</Txt>
            {LINKS.map(l => <Chip key={l} testID={`camp-link-${l === '/' ? 'home' : l.slice(1)}`} label={t(`camp.links.${l}`)} on={url === l} onPress={() => setUrl(l)} />)}
          </View>
          <View className="gap-2">
            <Segmented compact value={previewLang} options={(['dar', 'ar', 'fr'] as Lang[]).map(l => ({ key: l, label: t(`admin.f.title_${l}`) }))} onChange={setPreviewLang} optionPrefix="camp-prev" />
            <NotificationPreview lang={previewLang} title={shown(title)} body={shown(body)} />
          </View>
        </Section>

        {auto ? (
          <>
            <Section title={t('camp.trigger')}>
              <View className="flex-row flex-wrap gap-2">
                {EVENTS.map(e => <Chip key={e} testID={`camp-event-${e}`} icon={EVENT_ICON[e]} label={t(`camp.events.${e}`)} on={event === e} onPress={() => setEvent(e)} />)}
              </View>
              <Txt className="text-muted text-[12px]">{t(`camp.eventHelp.${event}`)}</Txt>
              <View className="flex-row flex-wrap gap-3">
                {event === 'signup' || event === 'first_design' ? <NumberInput testID="camp-delay" label={t('camp.delayMin')} value={delayMinutes} onChange={setDelayMinutes} /> : null}
                {event === 'no_design' || event === 'inactive' ? <NumberInput testID="camp-after" label={t('camp.afterDays')} value={afterDays} onChange={setAfterDays} /> : null}
                {event === 'inactive' ? <NumberInput testID="camp-cooldown" label={t('camp.cooldown')} value={cooldownDays} onChange={setCooldownDays} /> : null}
              </View>
              {event === 'no_design' || event === 'inactive' ? (
                <View className="flex-row items-center gap-3"><Txt className="flex-1 text-[13px]">{t('camp.includeExisting')}</Txt><Toggle testID="camp-existing" label={t('camp.includeExisting')} value={includeExisting} onValueChange={setIncludeExisting} /></View>
              ) : null}
            </Section>
            <Section title={t('camp.quiet')} hint={t('camp.quietHelp')}>
              <View className="flex-row items-center gap-3"><Txt className="flex-1 text-[13px]">{t('camp.quiet')}</Txt><Toggle testID="camp-quiet" label={t('camp.quiet')} value={quiet} onValueChange={setQuiet} /></View>
              {quiet ? (
                <View className="flex-row gap-3">
                  <View className="flex-1"><Txt className="text-[12px] font-semibold text-muted mb-1">{t('camp.quietFrom')}</Txt><Input tight testID="camp-quiet-from" value={quietFrom} onChangeText={setQuietFrom} placeholder="22:00" /></View>
                  <View className="flex-1"><Txt className="text-[12px] font-semibold text-muted mb-1">{t('camp.quietTo')}</Txt><Input tight testID="camp-quiet-to" value={quietTo} onChangeText={setQuietTo} placeholder="08:00" /></View>
                </View>
              ) : null}
              <Txt className="text-muted text-[12px]">{t('camp.capNote', { h: 24 })}</Txt>
            </Section>
          </>
        ) : (
          <>
            <Section title={t('camp.audience')} hint={t('camp.reachNote')}>
              <View className="flex-row flex-wrap gap-2">
                {SEGMENTS.map(s => <Chip key={s} testID={`camp-seg-${s}`} icon={SEG_ICON[s]} label={t(`camp.seg.${s}`)} sub={counts ? String(counts[s].reachable) : undefined} on={segments.includes(s)} onPress={() => toggleSeg(s)} />)}
              </View>
              {segments.length === 1 ? <Txt className="text-muted text-[12px]">{t(`camp.segHelp.${segments[0]}`, { n: segments[0] === 'inactive' ? inactiveDays : newDays })}</Txt> : null}
              {segments.some(s => s === 'new' || s === 'existing') || segments.includes('inactive') ? (
                <View className="flex-row flex-wrap gap-3">
                  {segments.some(s => s === 'new' || s === 'existing') ? <NumberInput testID="camp-new-days" label={t('camp.newDays')} value={newDays} onChange={setNewDays} /> : null}
                  {segments.includes('inactive') ? <NumberInput testID="camp-inactive-days" label={t('camp.inactiveDays')} value={inactiveDays} onChange={setInactiveDays} /> : null}
                </View>
              ) : null}
              <Pressable testID="camp-pick" accessibilityRole="button" onPress={() => setPick(v => !v)} className="flex-row items-center gap-2 self-start rounded-full border border-line px-3 h-9">
                <Icon name="account-search-outline" size={16} tone="muted" />
                <Txt className="text-[13px] font-bold">{clientIds.length ? t('camp.pickedN', { n: clientIds.length }) : t('camp.pickPeople')}</Txt>
                <Icon name={pick ? 'chevron-up' : 'chevron-down'} size={16} tone="muted" />
              </Pressable>
              {pick ? (
                <View className="rounded-xl border border-line overflow-hidden">
                  <View className="p-2 border-b border-line"><Input tight safe testID="camp-people-search" placeholder={t('camp.searchPeople')} value={query} onChangeText={setQuery} /></View>
                  {list.length ? list.map((p, i) => (
                    <Pressable key={p.id} testID={`camp-person-${p.id}`} accessibilityRole="checkbox" accessibilityState={{ checked: clientIds.includes(p.id) }} onPress={() => togglePerson(p.id)} className={`flex-row items-center gap-3 px-3 py-2.5 ${i ? 'border-t border-line' : ''}`}>
                      <Icon name={clientIds.includes(p.id) ? 'checkbox-marked' : 'checkbox-blank-outline'} size={20} tone={clientIds.includes(p.id) ? 'primary' : 'muted'} />
                      <View className="flex-1"><Txt className="font-semibold text-[14px]" numberOfLines={1}>{p.name}</Txt><Txt className="text-muted text-[12px]" numberOfLines={1}>{p.whatsapp}</Txt></View>
                    </Pressable>
                  )) : <Txt className="text-muted text-[13px] p-3">{t('camp.noPeople')}</Txt>}
                </View>
              ) : null}
              <View className="flex-row items-center gap-2 bg-soft rounded-xl px-3 py-2.5">
                <Icon name="send-check-outline" size={18} tone="primary" />
                <Txt testID="camp-reach" className="flex-1 text-[13px] font-semibold">{reach ? t('camp.reach', { n: reach.reachable, total: reach.reachableTotal }) : t('camp.reachNone')}</Txt>
              </View>
            </Section>

            <Section title={t('camp.when')} hint={t('camp.zone')}>
              <Segmented value={when} options={whenOptions} onChange={setWhen} optionPrefix="camp-when" />
              {when === 'later' ? (
                <View className="gap-2.5">
                  <View className="flex-row gap-3">
                    <View className="flex-1"><Txt className="text-[12px] font-semibold text-muted mb-1">{t('camp.date')}</Txt><Input tight testID="camp-date" value={date} onChangeText={setDate} placeholder={t('camp.dateHint')} autoCapitalize="none" /></View>
                    <View style={{ width: 110 }}><Txt className="text-[12px] font-semibold text-muted mb-1">{t('camp.time')}</Txt><Input tight testID="camp-time" value={time} onChangeText={setTime} placeholder="09:00" /></View>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    <Chip testID="camp-preset-tonight" label={t('camp.tonight20')} on={false} onPress={() => { const at = atDay(0, 20); setDate(dateInput(at)); setTime('20:00'); }} />
                    <Chip testID="camp-preset-tomorrow" label={t('camp.tomorrow9')} on={false} onPress={() => { const at = atDay(1, 9); setDate(dateInput(at)); setTime('09:00'); }} />
                  </View>
                </View>
              ) : null}
              {when === 'repeat' ? (
                <View className="gap-2.5">
                  <View className="flex-row flex-wrap gap-2">{FREQS.map(f => <Chip key={f} testID={`camp-freq-${f}`} label={t(`camp.freq.${f}`)} on={freq === f} onPress={() => setFreq(f)} />)}</View>
                  {freq === 'weekly' ? <View className="flex-row flex-wrap gap-2">{(t('camp.days', { returnObjects: true }) as unknown as string[]).map((label, d) => <Chip key={d} testID={`camp-day-${d}`} label={label} on={days.includes(d)} onPress={() => toggleDay(d)} />)}</View> : null}
                  <View className="flex-row flex-wrap gap-3">
                    <View style={{ width: 110 }}><Txt className="text-[12px] font-semibold text-muted mb-1">{t('camp.time')}</Txt><Input tight testID="camp-rtime" value={time} onChangeText={setTime} placeholder="09:00" /></View>
                    {freq === 'monthly' ? <NumberInput testID="camp-dom" label={t('camp.dayOfMonth')} value={dayOfMonth} onChange={setDayOfMonth} /> : null}
                    <View className="flex-1" style={{ minWidth: 150 }}><Txt className="text-[12px] font-semibold text-muted mb-1">{t('camp.endAt')}</Txt><Input tight testID="camp-end" value={endDate} onChangeText={setEndDate} placeholder={t('camp.dateHint')} autoCapitalize="none" /></View>
                  </View>
                </View>
              ) : null}
            </Section>
          </>
        )}
        {error ? <Txt testID="camp-error" className="text-danger text-[13px] font-semibold mb-2">{error}</Txt> : null}
      </View>
    </Sheet>
  );
}
