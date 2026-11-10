import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ConfirmSheet, Sheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { DemoCards } from '@/components/chat/DemoCards';
import { DragRow, useReorder } from '@/components/admin/DragReorder';
import { LangField } from '@/components/admin/LangField';
import { Chips, Label, Note, OptionTiles } from '@/components/admin/promptcards/ui';
import { PopupHistoryButtons } from '@/components/admin/PopupHistoryButtons';
import { usePopupHistory } from '@/hooks/usePopupHistory';
import { backendEnabled } from '@/lib/backend';
import { loadDemoStats, type DemoStats } from '@/lib/demoApi';
import {
  DEMO_ICONS, MAX_DEMO_ITEMS, MAX_FOLLOW_UPS, demoConfigOf, demoFromQuestion, demoIssues, demoItems, demoUsage, duplicateDemoItem, newDemoItem, pickText, removeDemoItem, toggleFollowUp,
} from '@/lib/demoMessages';
import { moveTo } from '@/lib/reorder';
import { useT } from '@/i18n';
import type { AssistantConfig, DemoConfig, DemoCta, DemoMessage, Lang } from '@/data/types';

const CTAS: DemoCta[] = ['none', 'tools', 'explore', 'pro'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Edit one demo message: what the card says, what a tap does, the answer, what comes next. */
function Editor({ value, onChange, all, showErrors }: { value: DemoMessage; onChange: (v: DemoMessage) => void; all: DemoMessage[]; showErrors: boolean }) {
  const { t, lang } = useT();
  const others = all.filter((x) => x.id !== value.id);
  const bad = demoIssues(value);
  return (
    <View style={{ gap: 14 }} testID="da-editor">
      <View>
        <Label>{t('da.icon')}</Label>
        <View className="flex-row flex-wrap gap-2" testID="da-icons">
          {DEMO_ICONS.map((n) => {
            const on = value.icon === n;
            return (
              <Pressable key={n} testID={`da-icon-${n}`} accessibilityRole="radio" accessibilityLabel={n} accessibilityState={{ selected: on }} onPress={() => onChange({ ...value, icon: n })}
                className={`w-10 h-10 rounded-xl items-center justify-center border-2 ${on ? 'border-primary bg-surface2' : 'border-line bg-surface'}`}>
                <Icon name={n} size={20} tone={on ? 'primary' : 'muted'} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <View>
        <LangField label={t('da.label')} fieldKey="demo-label" value={value.label} onChange={(label) => onChange({ ...value, label })} />
        {showErrors && bad.includes('noLabel') ? <Txt testID="da-err-label" className="text-danger text-[12px] mt-1">{t('da.needLabel')}</Txt> : null}
      </View>

      <View>
        <Label>{t('da.mode')}</Label>
        <OptionTiles testID="da-mode" value={value.mode} onChange={(mode) => onChange({ ...value, mode })} options={[
          { key: 'click', label: t('da.modeClick'), sub: t('da.modeClickSub'), icon: 'gesture-tap' },
          { key: 'write', label: t('da.modeWrite'), sub: t('da.modeWriteSub'), icon: 'pencil-outline' },
        ]} />
      </View>

      {value.mode === 'write' ? (
        <View>
          <LangField label={t('da.prompt')} fieldKey="demo-prompt" value={value.prompt} onChange={(prompt) => onChange({ ...value, prompt })} />
          {bad.includes('noPrompt') ? <Txt className="text-muted text-[12px] mt-1">{t('da.issueNoPrompt')}</Txt> : null}
        </View>
      ) : (
        <>
          <View>
            <Label>{t('da.reply')}</Label>
            <OptionTiles testID="da-reply" value={value.reply.type} onChange={(type) => onChange({ ...value, reply: { ...value.reply, type } })} options={[
              { key: 'text', label: t('da.replyText'), sub: t('da.replyTextSub'), icon: 'text-box-outline' },
              { key: 'ai', label: t('da.replyAi'), sub: t('da.replyAiSub'), icon: 'robot-outline' },
            ]} />
          </View>
          {value.reply.type === 'text' ? (
            <View>
              <LangField label={t('da.answer')} fieldKey="demo-answer" multiline value={value.reply.text} onChange={(text) => onChange({ ...value, reply: { ...value.reply, text } })} />
              {bad.includes('noAnswer') ? <Txt className="text-muted text-[12px] mt-1">{t('da.issueNoAnswer')}</Txt> : null}
            </View>
          ) : null}
        </>
      )}

      {value.mode === 'click' ? (
        <>
          <View>
            <Label hint={t('da.followUpsHint')}>{`${t('da.followUps')} · ${value.followUps.length}/${MAX_FOLLOW_UPS}`}</Label>
            {others.length === 0 ? <Txt className="text-[12px] text-muted">{t('da.followUpsNone')}</Txt> : (
              <View className="flex-row flex-wrap gap-2" testID="da-followups">
                {others.map((o) => {
                  const on = value.followUps.includes(o.id);
                  const full = !on && value.followUps.length >= MAX_FOLLOW_UPS;
                  return (
                    <Pressable key={o.id} testID={`da-follow-${o.id}`} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: full }} disabled={full} onPress={() => onChange(toggleFollowUp(value, o.id))}
                      className={`flex-row items-center gap-1.5 px-3 h-9 rounded-full border ${on ? 'bg-ink border-ink' : 'bg-surface border-line'}`} style={{ opacity: full ? 0.4 : 1, maxWidth: '100%' }}>
                      <Icon name={on ? 'check' : o.icon} size={14} tone={on ? 'onink' : 'muted'} />
                      <Txt numberOfLines={1} className={`text-[12.5px] font-bold ${on ? 'text-onink' : ''}`} style={{ flexShrink: 1 }}>{pickText(o.label, lang) || '—'}</Txt>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
          <View>
            <Label>{t('da.cta')}</Label>
            <Chips testID="da-cta" value={value.cta} onChange={(cta) => onChange({ ...value, cta })} options={CTAS.map((k) => ({ key: k, label: t(`da.cta${cap(k)}`) }))} />
          </View>
        </>
      ) : null}

      <View className="flex-row items-center justify-between">
        <Txt className="font-semibold flex-1 me-3">{t('da.enabled')}</Txt>
        <Toggle testID="da-item-enabled" value={value.enabled} onValueChange={(enabled) => onChange({ ...value, enabled })} label={t('da.enabled')} />
      </View>
    </View>
  );
}

/** Admin > Assistant > Demo messages: the suggestions an empty chat shows, their answers and what the customer can pick next. */
export function DemoMessages({ c, setC }: { c: AssistantConfig; setC: (v: AssistantConfig | ((old: AssistantConfig) => AssistantConfig)) => void }) {
  const { t, lang } = useT();
  const cfg = demoConfigOf(c);
  const starter = !c.demo;
  const items = cfg.items;
  const [stats, setStats] = useState<DemoStats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [editing, setEditing] = useState<{ item: DemoMessage; isNew: boolean } | null>(null);
  const [tried, setTried] = useState(false);
  const [del, setDel] = useState<DemoMessage | null>(null);
  const [resetAsk, setResetAsk] = useState(false);
  const hist = usePopupHistory<DemoMessage | null>(editing?.item ?? null, (item) => { if (item) setEditing((e) => (e ? { ...e, item } : e)); }, { active: !!editing, resetKey: editing?.item.id });

  useEffect(() => {
    if (!backendEnabled) return;
    let alive = true;
    loadDemoStats().then((r) => { if (alive) { setStats(r); setStatsFailed(false); } }).catch(() => { if (alive) setStatsFailed(true); });
    return () => { alive = false; };
  }, []);

  /** The first change turns the built-in starter set into the owner's own list. */
  const edit = (fn: (d: DemoConfig) => DemoConfig) => setC((old) => ({ ...old, demo: fn(clone(demoConfigOf(old))) }));
  const setItems = (fn: (list: DemoMessage[]) => DemoMessage[]) => edit((d) => ({ ...d, items: fn(d.items) }));
  const ids = items.map((x) => x.id);
  const reorder = useReorder(ids, [], (moving, to) => setItems((l) => moveTo(l, moving, to)), items.length > 1);
  const move = (id: string, dir: -1 | 1) => setItems((l) => { const i = l.findIndex((x) => x.id === id), j = i + dir; if (i < 0 || j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const full = items.length >= MAX_DEMO_ITEMS;
  const open = (item: DemoMessage, isNew = false) => { setTried(false); setEditing({ item: clone(item), isNew }); };
  const commit = () => {
    if (!editing) return;
    if (demoIssues(editing.item).includes('noLabel')) { setTried(true); return; }
    const item = editing.item;
    setItems((l) => (l.some((x) => x.id === item.id) ? l.map((x) => (x.id === item.id ? item : x)) : [...l, item]));
    setEditing(null);
  };
  const usage = demoUsage(stats?.stats, items);
  const used = (id: string) => stats?.stats[id]?.used ?? 0;
  const visible = demoItems(cfg, lang).length;
  const langIssues = (['dar', 'ar', 'fr'] as Lang[]).filter((l) => cfg.enabled && items.some((x) => x.enabled) && demoItems(cfg, l).length < items.filter((x) => x.enabled).length);
  const popular = (stats?.popular ?? []).filter((p) => !items.some((x) => (['dar', 'ar', 'fr'] as Lang[]).some((l) => (x.label[l] || '').trim().toLowerCase() === p.text.trim().toLowerCase()))).slice(0, 6);

  return (
    <View style={{ gap: 14 }} testID="asx-panel-demo">
      <View>
        <Txt className="text-[15px] font-extrabold">{t('da.title')}</Txt>
        <Txt className="text-[12px] text-muted mt-0.5">{t('da.hint')}</Txt>
      </View>

      <Card className="p-3" style={{ gap: 12 }}>
        <View className="flex-row items-center justify-between">
          <View className="flex-1 me-3"><Txt className="font-bold">{t('da.enabled')}</Txt><Txt className="text-[11.5px] text-muted">{t('da.enabledHint')}</Txt></View>
          <Toggle testID="da-enabled" value={cfg.enabled} onValueChange={(enabled) => edit((d) => ({ ...d, enabled }))} label={t('da.enabled')} />
        </View>
        {starter ? (
          <Note tone="info" testID="da-starter" text={t('da.starterNote')} />
        ) : (
          <Button testID="da-reset" size="sm" variant="ghost" icon="restore" title={t('da.resetStarter')} onPress={() => setResetAsk(true)} />
        )}
        <View>
          <Label>{t('da.layout')}</Label>
          <OptionTiles testID="da-layout" value={cfg.layout ?? 'cards'} onChange={(layout) => edit((d) => ({ ...d, layout }))} options={[
            { key: 'cards', label: t('da.layoutCards'), sub: t('da.layoutCardsSub'), icon: 'view-grid-outline' },
            { key: 'chips', label: t('da.layoutChips'), sub: t('da.layoutChipsSub'), icon: 'format-list-bulleted' },
          ]} />
        </View>
        <LangField label={t('da.secTitle')} fieldKey="demo-title" value={cfg.title} onChange={(title) => edit((d) => ({ ...d, title }))} />
        <LangField label={t('da.secSubtitle')} fieldKey="demo-subtitle" value={cfg.subtitle} onChange={(subtitle) => edit((d) => ({ ...d, subtitle }))} />
      </Card>

      <View className="flex-row items-center justify-between">
        <Txt className="text-[14px] font-extrabold">{t('da.list')}</Txt>
        <Txt testID="da-count" className="text-[12px] font-bold text-muted">{t('da.count', { count: items.length, max: MAX_DEMO_ITEMS })}{backendEnabled && usage.total ? ` · ${t('da.usageTotal', { count: usage.total })}` : ''}</Txt>
      </View>
      {langIssues.length ? <Note tone="warn" testID="da-lang-issues" text={t('da.missing', { langs: langIssues.map((l) => l.toUpperCase()).join(', ') })} /> : null}

      <View style={{ gap: 8 }} testID="da-list">
        {items.map((it, i) => {
          const issues = demoIssues(it);
          const n = used(it.id);
          return (
            <DragRow key={it.id} id={it.id} reorder={reorder} layout="list" onMove={items.length > 1 ? (d) => move(it.id, d) : undefined}>{(handle) => (
              <View testID={`da-item-${it.id}`} className="border border-line rounded-2xl bg-surface">
                <View className={`flex-row items-center gap-1.5 pe-2.5 py-2.5 ps-1 ${it.enabled ? '' : 'opacity-60'}`}>
                  {items.length > 1 ? handle : <View style={{ width: 8 }} />}
                  <View className="w-9 h-9 rounded-full bg-soft items-center justify-center"><Icon name={it.icon} size={19} tone="primary" /></View>
                  <Pressable testID={`da-item-${it.id}-open`} accessibilityRole="button" onPress={() => open(it)} className="flex-1" style={{ minWidth: 0 }}>
                    <Txt className="font-extrabold text-[14px]" numberOfLines={1}>{pickText(it.label, lang) || '—'}</Txt>
                    <Txt className="text-[11.5px] text-muted mt-0.5" numberOfLines={1}>
                      {it.enabled ? '' : `${t('da.off')} · `}{t(it.mode === 'write' ? 'da.modeWrite' : it.reply.type === 'text' ? 'da.replyText' : 'da.replyAi')}
                      {it.mode === 'click' && it.cta !== 'none' ? ` · ${t(`da.cta${cap(it.cta)}`)}` : ''}
                      {backendEnabled && stats ? ` · ${n ? t('da.taps', { count: n }) : t('da.never')}` : ''}
                    </Txt>
                    {issues.length ? (
                      <View className="flex-row items-center gap-1 mt-0.5"><Icon name="alert-outline" size={12} tone="muted" /><Txt testID={`da-item-${it.id}-issue`} className="text-[11px] text-muted flex-1" numberOfLines={1}>{t(`da.issue${cap(issues[0])}`)}</Txt></View>
                    ) : null}
                  </Pressable>
                  <Toggle testID={`da-item-${it.id}-on`} value={it.enabled} onValueChange={(enabled) => setItems((l) => l.map((x) => (x.id === it.id ? { ...x, enabled } : x)))} label={pickText(it.label, lang)} />
                </View>
                <View className="flex-row items-center justify-end gap-1 px-2 pb-2">
                  <Button testID={`da-item-${it.id}-up`} size="sm" variant="ghost" icon="arrow-up" title="" accessibilityLabel={t('da.moveUp')} disabled={i === 0} onPress={() => move(it.id, -1)} />
                  <Button testID={`da-item-${it.id}-down`} size="sm" variant="ghost" icon="arrow-down" title="" accessibilityLabel={t('da.moveDown')} disabled={i === items.length - 1} onPress={() => move(it.id, 1)} />
                  <Button testID={`da-item-${it.id}-edit`} size="sm" variant="soft" icon="pencil-outline" title={t('da.edit')} onPress={() => open(it)} />
                  <Button testID={`da-item-${it.id}-dup`} size="sm" variant="ghost" icon="content-copy" title={t('da.duplicate')} disabled={full} onPress={() => setItems((l) => { const copy = duplicateDemoItem(l, it.id); if (!copy) return l; const at = l.findIndex((x) => x.id === it.id); return [...l.slice(0, at + 1), copy, ...l.slice(at + 1)]; })} />
                  <Button testID={`da-item-${it.id}-delete`} size="sm" variant="ghost" icon="trash-can-outline" title="" accessibilityLabel={t('da.delete')} onPress={() => setDel(it)} />
                </View>
              </View>
            )}</DragRow>
          );
        })}
      </View>
      <Button testID="da-add" variant="soft" icon="plus" title={t('da.add')} disabled={full} onPress={() => open(newDemoItem(items), true)} />

      {backendEnabled ? (
        <Card className="p-3" testID="da-popular" style={{ gap: 8 }}>
          <View>
            <Txt className="text-[14px] font-extrabold">{t('da.popularTitle')}</Txt>
            <Txt className="text-[12px] text-muted mt-0.5">{t('da.popularHint')}</Txt>
          </View>
          {statsFailed ? <Txt className="text-[12px] text-muted">{t('da.loadFail')}</Txt> : null}
          {!statsFailed && popular.length === 0 ? <Txt testID="da-popular-empty" className="text-[12px] text-muted">{t('da.popularEmpty')}</Txt> : null}
          {popular.map((p, i) => (
            <View key={p.text} testID={`da-popular-${i}`} className="flex-row items-center gap-2 bg-surface2 rounded-xl ps-3 pe-1.5 py-1.5">
              <Txt className="flex-1 text-[13px] font-semibold" numberOfLines={2}>{p.text}</Txt>
              <Txt className="text-[11.5px] font-bold text-muted">{t('da.popularTimes', { count: p.count })}</Txt>
              <Button testID={`da-popular-${i}-add`} size="sm" variant="soft" icon="plus" title={t('da.popularAdd')} disabled={full} onPress={() => setItems((l) => [...l, demoFromQuestion(l, p.text, lang)])} />
            </View>
          ))}
        </Card>
      ) : null}

      <View testID="da-preview" style={{ gap: 8 }}>
        <Txt className="text-[12.5px] font-extrabold text-muted">{t('da.preview')}</Txt>
        <Card className="py-4">
          {visible ? <DemoCards config={cfg} onPick={() => {}} preview /> : <Txt className="text-[12px] text-muted text-center px-3">{t('da.previewEmpty')}</Txt>}
        </Card>
      </View>

      <Sheet visible={!!editing} onClose={() => setEditing(null)} wide title={editing ? t(editing.isNew ? 'da.newTitle' : 'da.editTitle') : ''} headerRight={editing ? <PopupHistoryButtons api={hist} prefix="da" /> : undefined}
        footer={editing ? <View className="flex-row gap-2 justify-end"><Button safe testID="da-editor-close" variant="ghost" title={t('da.close')} onPress={() => setEditing(null)} /><Button testID="da-editor-save" icon="check" title={t('da.saveItem')} onPress={commit} /></View> : undefined}>
        {editing ? <Editor key={editing.item.id} value={editing.item} all={items} showErrors={tried} onChange={(item) => setEditing({ ...editing, item })} /> : null}
      </Sheet>
      <ConfirmSheet visible={!!del} onClose={() => setDel(null)} onConfirm={() => { if (del) setItems((l) => removeDemoItem(l, del.id)); setDel(null); }} message={t('da.deleteConfirm')} confirmLabel={t('da.delete')} cancelLabel={t('da.close')} />
      <ConfirmSheet visible={resetAsk} onClose={() => setResetAsk(false)} onConfirm={() => { setC((old) => { const { demo: _drop, ...rest } = old; return rest as AssistantConfig; }); setResetAsk(false); }} message={t('da.resetConfirm')} confirmLabel={t('da.resetStarter')} cancelLabel={t('da.close')} />
    </View>
  );
}
