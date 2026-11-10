import React, { useCallback, useEffect, useState } from 'react';
import { usePopupHistory } from '@/hooks/usePopupHistory';
import { PopupHistoryButtons } from '@/components/admin/PopupHistoryButtons';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { ConfirmSheet, Sheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { DragRow, useReorder } from '@/components/admin/DragReorder';
import { Chips, Label, Note, OptionTiles } from '@/components/admin/promptcards/ui';
import { StateBadge, dateOf } from './ui';
import { api, backendEnabled } from '@/lib/backend';
import { useT } from '@/i18n';
import {
  LANGS, MAX_AUTOMATIONS, REPLY_TYPES, TRIGGER_TYPES, VARS, automationErrors, blankAutomation, clone, dropAutomation, duplicateOf, insertVar, listDirty, moveAutomation, parseKeywords, starter, timeOk, triggerSummary, unknownVars,
  type Automation, type AutomationsInfo, type ReplyType, type StarterId, type TriggerType,
} from '@/lib/assistantAdmin';

const TRIGGER_ICON: Record<TriggerType, string> = { keyword: 'key-variant', intent: 'lightbulb-outline', first_visit: 'hand-wave-outline', schedule: 'clock-outline', button: 'gesture-tap-button' };
const REPLY_ICON: Record<ReplyType, string> = { fixed: 'text-box-outline', template: 'code-braces', ai: 'robot-outline' };

/** The owner's automations: server copy, the draft being edited, and the whole-list save used by the page's save bar. */
export function useAutomations() {
  const [info, setInfo] = useState<AutomationsInfo | null>(null);
  const [saved, setSaved] = useState<Automation[]>([]);
  const [list, setList] = useState<Automation[]>([]);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!backendEnabled) return;
    try { const r = await api<AutomationsInfo>('/admin/assistant/automations'); setInfo(r); setSaved(r.items); setList(clone(r.items)); setFailed(false); } catch { setFailed(true); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const dirty = listDirty(list, saved);
  const save = async () => {
    try { const r = await api<AutomationsInfo>('/admin/assistant/automations', { method: 'PUT', body: { items: list } }); setInfo(r); setSaved(r.items); setList(clone(r.items)); return true; } catch { return false; }
  };
  const discard = () => setList(clone(saved));
  return { info, list, setList, dirty, save, discard, load, failed, saved };
}
export type AutomationsApi = ReturnType<typeof useAutomations>;

/* ------------------------------------------------------------------ test box */
interface TestResult { ok: boolean; matches?: boolean; why?: string; unknownVars?: string[]; result?: { text: string; label?: string; model?: string; status: string; automationName?: string }; tried?: { label: string; reason: string }[] }

/** Type a customer message and see the real answer. With `automation`, previews that draft only. Nothing is counted. */
export function TestBox({ automation, idPrefix }: { automation?: Automation; idPrefix: string }) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [first, setFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<TestResult | null>(null);
  const [err, setErr] = useState(false);
  const run = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(false);
    try { setOut(await api<TestResult>('/admin/assistant/test', { method: 'POST', body: { text, first, ...(automation ? { automation } : {}) } })); } catch { setOut(null); setErr(true); }
    setBusy(false);
  };
  return (
    <View testID={`${idPrefix}-test`} className="bg-surface2 rounded-2xl p-3">
      <Txt className="text-[14px] font-extrabold">{t('asx.t.title')}</Txt>
      <Txt className="text-[12px] text-muted mt-0.5 mb-2">{t(automation ? 'asx.t.hintDraft' : 'asx.t.hintAll')}</Txt>
      <View className="flex-row items-center gap-2">
        <View className="flex-1"><Input tight testID={`${idPrefix}-test-text`} value={text} onChangeText={setText} placeholder={t('asx.t.placeholder')} onSubmitEditing={run} returnKeyType="send" maxLength={500} /></View>
        <Button testID={`${idPrefix}-test-run`} size="sm" icon="play" title={t('asx.t.run')} onPress={run} loading={busy} disabled={!text.trim()} />
      </View>
      <View className="flex-row items-center justify-between mt-2">
        <Txt className="text-[12.5px] font-semibold flex-1 me-3">{t('asx.t.first')}</Txt>
        <Toggle testID={`${idPrefix}-test-first`} value={first} onValueChange={setFirst} label={t('asx.t.first')} />
      </View>
      {err ? <Txt testID={`${idPrefix}-test-error`} className="text-danger text-[12px] mt-2">{t('asx.saveFail')}</Txt> : null}
      {out ? (
        <View testID={`${idPrefix}-test-out`} className="mt-3 gap-2">
          {automation ? (
            <View className="flex-row items-center gap-2 flex-wrap">
              <StateBadge testID={`${idPrefix}-test-match`} state={out.matches ? 'active' : 'off'} text={t(out.matches ? 'asx.t.matches' : 'asx.t.noMatch')} />
              {!out.matches && out.why ? <Txt className="text-[12px] text-muted flex-1" style={{ minWidth: 120 }}>{t(`asx.t.why.${out.why}`, { defaultValue: out.why })}</Txt> : null}
            </View>
          ) : null}
          {out.unknownVars?.length ? <Note tone="warn" text={t('asx.t.unknownVars', { names: out.unknownVars.map((n) => `{${n}}`).join(', ') })} /> : null}
          {out.ok && out.result ? (
            <View className="bg-surface rounded-xl border border-line p-3">
              <View className="flex-row items-center gap-2 flex-wrap mb-1.5">
                <StateBadge state={out.result.status as 'active'} text={t(`asx.m.status.${out.result.status}`, { defaultValue: out.result.status })} />
                <Txt className="text-[11.5px] text-muted">{out.result.automationName || [out.result.label, out.result.model].filter(Boolean).join(' · ')}</Txt>
              </View>
              <Txt testID={`${idPrefix}-test-reply`} className="text-[14px] leading-[20px]" selectable>{out.result.text}</Txt>
            </View>
          ) : null}
          {!out.ok ? (
            <View>
              <Txt testID={`${idPrefix}-test-failed`} className="text-danger text-[13px] font-bold">{t('asx.t.failed')}</Txt>
              {(out.tried ?? []).map((x, i) => <Txt key={i} className="text-[12px] text-muted">{x.label} · {t(`asx.p.reason.${x.reason}`, { defaultValue: x.reason })}</Txt>)}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ editor */
function Editor({ value, onChange, reveal }: { value: Automation; onChange: (v: Automation) => void; reveal: boolean }) {
  const { t } = useT();
  const errs = automationErrors(value);
  const [kw, setKw] = useState(value.trigger.keywords.join(', '));
  const [show, setShow] = useState(false);
  const tr = value.trigger, rp = value.reply, sc = tr.schedule;
  const setTr = (p: Partial<Automation['trigger']>) => onChange({ ...value, trigger: { ...tr, ...p } });
  const setRp = (p: Partial<Automation['reply']>) => onChange({ ...value, reply: { ...rp, ...p } });
  const bad = rp.type === 'template' ? unknownVars(rp.text) : [];
  const err = (code: string) => (show && errs.includes(code) ? <Txt testID={`asx-err-${code}`} className="text-danger text-[12px] mt-1">{t(`asx.a.err.${code}`)}</Txt> : null);
  // Errors stay hidden while the owner is still typing; pressing Save (reveal) or leaving the name field shows them.
  useEffect(() => { if (reveal) setShow(true); }, [reveal]);
  const toggleDay = (d: number) => setTr({ schedule: { ...sc, days: sc.days.includes(d) ? sc.days.filter((x) => x !== d) : [...sc.days, d].sort() } });
  const days = t('asx.a.day', { returnObjects: true }) as unknown as string[];
  return (
    <View style={{ gap: 14 }} testID="asx-editor">
      <View>
        <Input tight label={t('asx.a.name')} testID="asx-name" value={value.name} onChangeText={(v) => onChange({ ...value, name: v })} placeholder={t('asx.a.namePlaceholder')} maxLength={80} invalid={show && errs.includes('name')} onBlur={() => setShow(true)} />
        {err('name')}
      </View>

      <View>
        <Label>{t('asx.a.trigger')}</Label>
        <View className="flex-row flex-wrap gap-2">
          {TRIGGER_TYPES.map((k) => {
            const on = tr.type === k;
            return (
              <Pressable key={k} testID={`asx-trigger-${k}`} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange({ ...value, trigger: { ...tr, type: k }, oncePerChat: k === 'first_visit' || k === 'schedule' ? true : value.oncePerChat })} className={`rounded-xl border-2 px-2 py-2 items-center gap-0.5 ${on ? 'border-primary bg-surface2' : 'border-line bg-surface'}`} style={{ width: '31%', minWidth: 96, flexGrow: 1 }}>
                <Icon name={TRIGGER_ICON[k]} size={20} tone={on ? 'primary' : 'muted'} />
                <Txt className="text-[12.5px] font-extrabold text-center" numberOfLines={1}>{t(`asx.a.tt.${k}`)}</Txt>
                <Txt className="text-[10.5px] text-muted text-center" numberOfLines={2}>{t(`asx.a.tt.${k}Sub`)}</Txt>
              </Pressable>
            );
          })}
        </View>
      </View>

      {tr.type === 'keyword' ? (
        <View>
          <Input tight label={t('asx.a.keywords')} testID="asx-keywords" value={kw} onChangeText={(v) => { setKw(v); setTr({ keywords: parseKeywords(v) }); }} multiline autoCapitalize="none" invalid={show && errs.includes('keywords')} style={{ minHeight: 64, textAlignVertical: 'top', paddingTop: 10 }} />
          <Txt className="text-[11.5px] text-muted mt-1">{t('asx.a.keywordsHint')}</Txt>
          {err('keywords')}
        </View>
      ) : null}
      {tr.type === 'intent' ? (
        <View>
          <Label>{t('asx.a.intents')}</Label>
          <View className="flex-row flex-wrap gap-2" testID="asx-intents">
            {['greeting', 'thanks', 'goodbye', 'pricing', 'human', 'howto', 'problem'].map((k) => {
              const on = tr.intents.includes(k);
              return <Pressable key={k} testID={`asx-intent-${k}`} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setTr({ intents: on ? tr.intents.filter((x) => x !== k) : [...tr.intents, k] })} className={`px-3.5 h-9 rounded-full items-center justify-center border ${on ? 'bg-ink border-ink' : 'bg-surface border-line'}`}><Txt className={`text-[13px] font-bold ${on ? 'text-onink' : ''}`}>{t(`asx.a.intent.${k}`)}</Txt></Pressable>;
            })}
          </View>
          {err('intents')}
        </View>
      ) : null}
      {tr.type === 'button' ? (
        <View>
          <Input tight label={t('asx.a.buttonLabel')} testID="asx-button-label" value={tr.buttonLabel} onChangeText={(v) => setTr({ buttonLabel: v })} maxLength={40} invalid={show && errs.includes('buttonLabel')} />
          <Txt className="text-[11.5px] text-muted mt-1">{t('asx.a.buttonHint')}</Txt>
          {err('buttonLabel')}
        </View>
      ) : null}
      {tr.type === 'schedule' ? (
        <View style={{ gap: 10 }}>
          <View>
            <Label>{t('asx.a.days')}</Label>
            <View className="flex-row flex-wrap gap-1.5" testID="asx-days">
              <Pressable testID="asx-day-all" accessibilityRole="button" onPress={() => setTr({ schedule: { ...sc, days: [] } })} className={`px-3 h-9 rounded-full items-center justify-center border ${sc.days.length === 0 ? 'bg-ink border-ink' : 'bg-surface border-line'}`}><Txt className={`text-[12.5px] font-bold ${sc.days.length === 0 ? 'text-onink' : ''}`}>{t('asx.a.daysAll')}</Txt></Pressable>
              {days.map((d, i) => { const on = sc.days.includes(i); return <Pressable key={i} testID={`asx-day-${i}`} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggleDay(i)} className={`px-3 h-9 rounded-full items-center justify-center border ${on ? 'bg-ink border-ink' : 'bg-surface border-line'}`}><Txt className={`text-[12.5px] font-bold ${on ? 'text-onink' : ''}`}>{d}</Txt></Pressable>; })}
            </View>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1"><Input tight label={t('asx.a.from')} testID="asx-from" value={sc.from} onChangeText={(v) => setTr({ schedule: { ...sc, from: v } })} placeholder="18:00" invalid={!timeOk(sc.from)} maxLength={5} /></View>
            <View className="flex-1"><Input tight label={t('asx.a.to')} testID="asx-to" value={sc.to} onChangeText={(v) => setTr({ schedule: { ...sc, to: v } })} placeholder="09:00" invalid={!timeOk(sc.to)} maxLength={5} /></View>
          </View>
          <Txt className="text-[11.5px] text-muted">{t('asx.a.tz')}</Txt>
        </View>
      ) : null}

      <View>
        <Label>{t('asx.a.reply')}</Label>
        <OptionTiles testID="asx-reply" value={rp.type} onChange={(k) => setRp({ type: k })} options={REPLY_TYPES.map((k) => ({ key: k, label: t(`asx.a.rt.${k}`), sub: t(`asx.a.rt.${k}Sub`), icon: REPLY_ICON[k] }))} />
      </View>
      {rp.type === 'ai' ? (
        <View>
          <Input tight label={t('asx.a.instructions')} testID="asx-instructions" value={rp.instructions} onChangeText={(v) => setRp({ instructions: v })} multiline maxLength={1200} invalid={show && errs.includes('instructions')} placeholder={t('asx.a.instructionsHint')} style={{ minHeight: 100, textAlignVertical: 'top', paddingTop: 12 }} />
          {err('instructions')}
        </View>
      ) : (
        <View>
          <Input tight label={t('asx.a.text')} testID="asx-text" value={rp.text} onChangeText={(v) => setRp({ text: v })} multiline maxLength={1500} invalid={(show && errs.includes('text')) || bad.length > 0} style={{ minHeight: 100, textAlignVertical: 'top', paddingTop: 12 }} />
          {err('text')}
          {bad.length ? <Txt testID="asx-unknown-vars" className="text-danger text-[12px] mt-1">{t('asx.t.unknownVars', { names: bad.map((n) => `{${n}}`).join(', ') })}</Txt> : null}
          {rp.type === 'template' ? (
            <View className="mt-2">
              <Txt className="text-[12px] text-muted mb-1">{t('asx.a.vars')} · {t('asx.a.varsHint')}</Txt>
              <View className="flex-row flex-wrap gap-1.5">
                {VARS.map((n) => <Pressable key={n} testID={`asx-var-${n}`} accessibilityRole="button" accessibilityLabel={t(`asx.a.varName.${n}`)} onPress={() => setRp({ text: insertVar(rp.text, n) })} className="px-2.5 h-7 rounded-full bg-surface2 items-center justify-center"><Txt className="text-[12px] font-semibold">{`{${n}}`}</Txt></Pressable>)}
              </View>
            </View>
          ) : null}
        </View>
      )}

      <View>
        <Label hint={t(rp.type === 'ai' ? 'asx.a.langHintAi' : 'asx.a.langHintFixed')}>{t('asx.a.language')}</Label>
        <Chips testID="asx-lang" value={value.language} onChange={(v) => onChange({ ...value, language: v })} options={LANGS.map((k) => ({ key: k, label: t(`asx.a.lang.${k}`) }))} />
      </View>

      <View className="flex-row items-center justify-between">
        <View className="flex-1 me-3"><Txt className="font-semibold">{t('asx.a.once')}</Txt><Txt className="text-[11.5px] text-muted">{t('asx.a.onceHint')}</Txt></View>
        <Toggle testID="asx-once" value={value.oncePerChat} onValueChange={(v) => onChange({ ...value, oncePerChat: v })} label={t('asx.a.once')} />
      </View>
      <View className="flex-row items-center justify-between">
        <Txt className="font-semibold flex-1 me-3">{t('asx.a.enabled')}</Txt>
        <Toggle testID="asx-enabled" value={value.enabled} onValueChange={(v) => onChange({ ...value, enabled: v })} label={t('asx.a.enabled')} />
      </View>

      <TestBox automation={value} idPrefix="asx-draft" />
    </View>
  );
}

/* ------------------------------------------------------------------ list */
export function Automations({ api: au }: { api: AutomationsApi }) {
  const { t } = useT();
  const { info, list, setList, failed, load } = au;
  const [editing, setEditing] = useState<{ item: Automation; isNew: boolean } | null>(null);
  const [tried, setTried] = useState(false);
  const [del, setDel] = useState<Automation | null>(null);
  const hist = usePopupHistory<Automation | null>(editing?.item ?? null, (item) => { if (item) setEditing((e) => (e ? { ...e, item } : e)); }, { active: !!editing, resetKey: editing?.item.id });
  const ids = list.map((a) => a.id);
  const reorder = useReorder(ids, [], (moving, to) => setList((l) => dropAutomation(l, moving, to)), list.length > 1);
  if (failed && !info) return <Card className="p-4 items-center gap-3"><Txt testID="asx-a-error" className="text-danger">{t('asx.loadFail')}</Txt><Button size="sm" title={t('asx.retry')} onPress={() => load()} /></Card>;
  if (!info) return <AdminLoading testID="asx-a-loading" />;
  const max = info.max || MAX_AUTOMATIONS;
  const open = (item: Automation, isNew = false) => { setTried(false); setEditing({ item: clone(item), isNew }); };
  const commit = () => {
    if (!editing) return;
    if (automationErrors(editing.item).length) { setTried(true); return; }
    const item = { ...editing.item, name: editing.item.name.trim() };
    setList((l) => (l.some((a) => a.id === item.id) ? l.map((a) => (a.id === item.id ? { ...item, used: a.used, lastUsedAt: a.lastUsedAt } : a)) : [...l, item]));
    setEditing(null);
  };
  const patch = (id: string, p: Partial<Automation>) => setList((l) => l.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const addStarter = (id: StarterId) => { setList((l) => [...l, starter(id, { name: t(`asx.a.starters.${id}`), text: t(`asx.a.starterText.${id}`) })]); };
  const stats = (a: Automation) => (a.used ? `${t('asx.a.used', { count: a.used })}${a.lastUsedAt ? ` · ${t('asx.a.last', { date: dateOf(a.lastUsedAt) })}` : ''}` : t('asx.a.never'));
  return (
    <View style={{ gap: 12 }} testID="asx-panel-automations">
      <View>
        <Txt className="text-[15px] font-extrabold">{t('asx.a.title')}</Txt>
        <Txt className="text-[12px] text-muted mt-0.5">{t('asx.a.hint')}</Txt>
      </View>

      {list.length === 0 ? (
        <Card className="p-3" testID="asx-empty">
          <Txt className="text-[13px] text-muted mb-2">{t('asx.a.empty')}</Txt>
          <View className="flex-row flex-wrap gap-2">
            {(['welcome', 'hours', 'prices'] as StarterId[]).map((id) => <Button key={id} testID={`asx-starter-${id}`} size="sm" variant="soft" icon="plus" title={t(`asx.a.starters.${id}`)} onPress={() => addStarter(id)} />)}
          </View>
        </Card>
      ) : (
        <View style={{ gap: 8 }} testID="asx-list">
          {list.map((a, i) => (
            <DragRow key={a.id} id={a.id} reorder={reorder} layout="list" onMove={list.length > 1 ? (d) => setList((l) => moveAutomation(l, a.id, d)) : undefined}>{(handle) => (
              <View testID={`asx-item-${a.id}`} className="border border-line rounded-2xl bg-surface">
                <View className={`flex-row items-center gap-1.5 pe-2.5 py-2.5 ps-1 ${a.enabled ? '' : 'opacity-60'}`}>
                  {list.length > 1 ? handle : <View style={{ width: 8 }} />}
                  <View className="w-6 h-6 rounded-full bg-surface2 items-center justify-center"><Txt className="text-[11px] font-extrabold text-muted">{i + 1}</Txt></View>
                  <Pressable testID={`asx-item-${a.id}-open`} accessibilityRole="button" onPress={() => open(a)} className="flex-1" style={{ minWidth: 0 }}>
                    <Txt className="font-extrabold text-[14px]" numberOfLines={1}>{a.name || '—'}</Txt>
                    <View className="flex-row items-center gap-1.5 mt-0.5">
                      <Icon name={TRIGGER_ICON[a.trigger.type]} size={14} tone="muted" />
                      <Txt className="text-[12px] text-muted flex-1" numberOfLines={1}>{t(`asx.a.tt.${a.trigger.type}`)}{triggerSummary(a) ? ` · ${triggerSummary(a)}` : ''}</Txt>
                    </View>
                    <Txt testID={`asx-item-${a.id}-used`} className="text-[11.5px] text-muted mt-0.5" numberOfLines={1}>{a.enabled ? stats(a) : t('asx.a.off')} · {t(`asx.a.rt.${a.reply.type}`)}</Txt>
                  </Pressable>
                  <Toggle testID={`asx-item-${a.id}-on`} value={a.enabled} onValueChange={(v) => patch(a.id, { enabled: v })} label={a.name} />
                </View>
                <View className="flex-row items-center justify-end gap-1 px-2 pb-2">
                  <Button testID={`asx-item-${a.id}-up`} size="sm" variant="ghost" icon="arrow-up" title="" accessibilityLabel={t('asx.a.moveUp')} disabled={i === 0} onPress={() => setList((l) => moveAutomation(l, a.id, -1))} />
                  <Button testID={`asx-item-${a.id}-down`} size="sm" variant="ghost" icon="arrow-down" title="" accessibilityLabel={t('asx.a.moveDown')} disabled={i === list.length - 1} onPress={() => setList((l) => moveAutomation(l, a.id, 1))} />
                  <Button testID={`asx-item-${a.id}-edit`} size="sm" variant="soft" icon="pencil-outline" title={t('asx.a.edit')} onPress={() => open(a)} />
                  <Button testID={`asx-item-${a.id}-dup`} size="sm" variant="ghost" icon="content-copy" title={t('asx.a.duplicate')} disabled={list.length >= max} onPress={() => setList((l) => { const at = l.findIndex((x) => x.id === a.id); const copy = duplicateOf(a, t('asx.a.copySuffix')); return [...l.slice(0, at + 1), copy, ...l.slice(at + 1)]; })} />
                  <Button testID={`asx-item-${a.id}-delete`} size="sm" variant="ghost" icon="trash-can-outline" title="" accessibilityLabel={t('asx.a.delete')} onPress={() => setDel(a)} />
                </View>
              </View>
            )}</DragRow>
          ))}
        </View>
      )}
      <Button testID="asx-add" variant="soft" icon="plus" title={t('asx.a.add')} disabled={list.length >= max} onPress={() => open(blankAutomation(), true)} />

      <TestBox idPrefix="asx-all" />

      <Sheet visible={!!editing} onClose={() => setEditing(null)} wide title={editing ? t(editing.isNew ? 'asx.a.newTitle' : 'asx.a.editTitle') : ''} headerRight={editing ? <PopupHistoryButtons api={hist} prefix="asx" /> : undefined}
        footer={editing ? <View className="flex-row gap-2 justify-end"><Button safe testID="asx-editor-close" variant="ghost" title={t('asx.a.close')} onPress={() => setEditing(null)} /><Button testID="asx-editor-save" icon="check" title={t('asx.a.saveItem')} onPress={commit} /></View> : undefined}>
        {editing ? <Editor key={editing.item.id} value={editing.item} reveal={tried} onChange={(item) => setEditing({ ...editing, item })} /> : null}
      </Sheet>
      <ConfirmSheet visible={!!del} onClose={() => setDel(null)} onConfirm={() => { if (del) setList((l) => l.filter((x) => x.id !== del.id)); setDel(null); }} message={t('asx.a.deleteConfirm')} confirmLabel={t('asx.a.delete')} cancelLabel={t('asx.discard')} />
    </View>
  );
}
