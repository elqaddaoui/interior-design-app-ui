import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { ExplorerRules, OutputTab, PicturesTab, RulesTab, StepsTab, WordsTab } from '@/components/admin/promptcards/Editors';
import { LivePreview } from '@/components/admin/promptcards/LivePreview';
import { InheritBar, Note, Tabs } from '@/components/admin/promptcards/ui';
import { api, backendEnabled } from '@/lib/backend';
import { useBp } from '@/hooks/useBp';
import { router, useBackCheckpoint, useLeaveGuard } from '@/hooks/useLeaveGuard';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import type { PromptRules, PromptRulesInfo, PromptSet } from '@/data/types';
import { ALL_TABS, EXPLORE, HIGHLIGHT, clone, copySteps, customize, hasOwnSteps, inherit, isDirty, isTool, setSteps, startCase, stepTarget, stepsOf, toolThumb, touched, type Scope, type TabKey, type TestCase } from '@/lib/promptCards';

const TAB_ICON: Record<TabKey, string> = { rules: 'text-box-outline', images: 'image-multiple-outline', blocks: 'format-list-numbered', words: 'book-alphabet', output: 'tune-variant' };

/** One card of the strip: its picture (or icon), its name, and a dot when something is customised. */
function ScopeTile({ id, label, thumb, icon, badge, on, onPress }: { id: string; label: string; thumb?: string; icon?: string; badge: boolean; on: boolean; onPress: () => void }) {
  const { t } = useT();
  return (
    <Pressable testID={`pc-scope-${id === EXPLORE ? 'explore' : id}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={onPress} className={`rounded-2xl border-2 overflow-hidden ${id === EXPLORE ? 'bg-white' : 'bg-surface'} ${on ? 'border-primary' : 'border-line'}`} style={{ width: 118 }}>
      <View className={`items-center justify-center ${id === EXPLORE ? 'bg-white' : 'bg-surface2'}`} style={{ height: 66 }}>
        {thumb ? <Image source={{ uri: thumb }} style={{ width: 118, height: 66 }} contentFit="cover" /> : <Icon name={icon || 'image-outline'} size={28} tone={on || id === EXPLORE ? 'primary' : 'muted'} />}
        {badge ? <View testID={`pc-scope-${id === EXPLORE ? 'explore' : id}-badge`} className="absolute px-1.5 h-5 rounded-full bg-primary items-center justify-center" style={{ top: 5, end: 5 }}><Txt className="text-[10.5px] font-extrabold text-onprimary">{t('pc.customBadge')}</Txt></View> : null}
      </View>
      <View className={`px-2 py-1.5 ${id === EXPLORE ? 'bg-white' : ''}`}><Txt className={`text-[12.5px] ${id === EXPLORE ? 'text-black' : ''} ${on ? 'font-extrabold' : 'font-bold'}`} numberOfLines={2} style={{ minHeight: 32 }}>{label}</Txt></View>
    </Pressable>
  );
}

export default function PromptCards() {
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const { desktop } = useBp();
  const [info, setInfo] = useState<PromptRulesInfo | null>(null);
  const [saved, setSaved] = useState<PromptRules | null>(null);
  const [draft, setDraft] = useState<PromptRules | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<Scope>('all');
  const [tab, setTab] = useState<TabKey>('rules');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [used, setUsed] = useState<string[] | undefined>();
  const [tc, setTc] = useState<TestCase>(() => startCase(s.tools, s.styles, s.roomTypes));
  const [copyOpen, setCopyOpen] = useState(false);
  // What a card had before it went back to "same as All tools": customising again brings it back instead of starting over.
  const stash = useRef<Record<string, PromptSet['blocks']>>({});

  const load = useCallback(() => {
    api<PromptRulesInfo>('/admin/prompt-rules').then((r) => { setInfo(r); setSaved(r.rules); setDraft(clone(r.rules)); }).catch(() => setFailed(true));
  }, []);
  useEffect(() => { if (backendEnabled) load(); }, [load]);
  // A tool deleted elsewhere must not leave the screen on a card that no longer exists.
  useEffect(() => { if (isTool(scope) && s.tools.length && !s.tools.some((x) => x.id === scope)) setScope('all'); }, [s.tools, scope]);

  const dirty = !!draft && !!saved && !!info && isDirty(draft, saved, info.catalog);
  const save = async () => {
    if (!draft) return false;
    setSaving(true);
    try {
      const r = await api<PromptRulesInfo>('/admin/prompt-rules', { method: 'PUT', body: draft });
      setInfo(r); setSaved(r.rules); setDraft(clone(r.rules)); stash.current = {}; toast(t('pc.saved'));
      return true;
    } catch { toast(t('pc.saveFail')); return false; } finally { setSaving(false); }
  };
  const discard = () => { if (saved) { setDraft(clone(saved)); stash.current = {}; } };
  useLeaveGuard(dirty, save, discard, { before: saved, after: draft });
  useBackCheckpoint(dirty, () => router.back());

  const change = (fn: (d: PromptRules) => PromptRules) => setDraft((d) => (d ? fn(d) : d));
  const goScope = (id: Scope) => { setScope(id); setFocusId(null); };

  if (!backendEnabled) return <AdminPage title={t('admin.nav.promptCards')} max={1180}><Card className="p-4"><Txt className="text-muted">{t('pc.offline')}</Txt></Card></AdminPage>;
  if (failed) return <AdminPage title={t('admin.nav.promptCards')} max={1180}><Card className="p-4 items-center gap-3"><Txt testID="pc-error" className="text-danger">{t('pc.loadFail')}</Txt><Button size="sm" title={t('pc.retry')} onPress={() => { setFailed(false); load(); }} /></Card></AdminPage>;
  if (!draft || !info) return <AdminPage title={t('admin.nav.promptCards')} max={1180}><AdminLoading testID="pc-loading" /></AdminPage>;

  const tool = isTool(scope);
  const explore = scope === EXPLORE;
  const images = draft.global.images;
  const own = tool && hasOwnSteps(draft, scope);
  // A tool that still follows All tools shows what applies, locked until "Customise".
  const locked = tool && !own;
  const toolName = (id: string) => (id === 'all' ? t('pc.scopeAll') : id === EXPLORE ? t('pc.scopeExplore') : L(s.tools.find((x) => x.id === id)?.title));
  const turnOn = () => change((d) => customize(d, scope, stash.current[scope]));
  const turnOff = () => change((d) => { const r = inherit(d, scope); if (r.removed) stash.current[scope] = r.removed; return r.rules; });
  const copyFrom = (from: Scope) => { change((d) => copySteps(d, from, scope)); setCopyOpen(false); toast(t('pc.copied', { name: toolName(from) })); };
  // Touching a passage of the live preview opens the page / tab / step that wrote it.
  const pickStep = (id: string) => { const to = stepTarget(scope, id); setScope(to.scope); if (to.tab) setTab(to.tab); setFocusId(to.focus ?? null); };

  const tabs = ALL_TABS.map((k) => ({ key: k, label: t(`pc.tab${k === 'blocks' ? 'Steps' : k[0].toUpperCase() + k.slice(1)}`), icon: TAB_ICON[k], dot: touched(draft, k, info.catalog) }));
  const steps = <StepsTab key={scope} scope={scope} value={stepsOf(draft, scope)} onChange={(v) => change((d) => setSteps(d, scope, v))} info={info} images={images} used={used} focusId={focusId} onFocus={setFocusId} readOnly={locked} />;

  let page: React.ReactNode;
  if (explore) {
    page = (
      <Card className="p-3" testID="pc-panel-explore">
        <ExplorerRules text={draft.global.rules.exploreText} onText={(v) => change((d) => ({ ...d, global: { ...d.global, rules: { ...d.global.rules, exploreText: v } } }))} />
        <View className="mt-3">{steps}</View>
      </Card>
    );
  } else if (tool) {
    page = (
      <View testID="pc-panel-tool">
        <InheritBar custom={own} onCustomize={turnOn} onInherit={turnOff} />
        <View testID="pc-editor" style={locked ? { opacity: 0.6 } : undefined}>{steps}</View>
      </View>
    );
  } else {
    page = (<>
      <Tabs value={tab} onChange={(k) => { setTab(k); setFocusId(null); }} options={tabs} />
      <Card className="p-3 mt-3" testID={`pc-panel-${tab}`}>
        {tab === 'rules' ? <RulesTab value={draft.global.rules} onChange={(v) => change((d) => ({ ...d, global: { ...d.global, rules: v } }))} /> : null}
        {tab === 'images' ? <PicturesTab value={images} onChange={(v) => change((d) => ({ ...d, global: { ...d.global, images: v } }))} /> : null}
        {tab === 'blocks' ? steps : null}
        {tab === 'words' ? <WordsTab rules={draft} onChange={(v) => change((d) => ({ ...d, vocab: v }))} info={info} /> : null}
        {tab === 'output' ? <OutputTab value={draft.global.output} onChange={(v) => change((d) => ({ ...d, global: { ...d.global, output: v } }))} /> : null}
      </Card>
    </>);
  }

  const bar = dirty ? (
    <Card testID="pc-savebar" className="p-3 flex-row items-center gap-2 flex-wrap" style={Platform.OS === 'web' ? ({ boxShadow: '0 8px 28px rgba(0,0,0,0.18)' } as object) : undefined}>
      <Icon name="alert-circle-outline" size={18} tone="primary" />
      <Txt className="font-bold flex-1" style={{ minWidth: 120 }}>{t('pc.unsaved')}</Txt>
      <Button testID="pc-discard" size="sm" variant="ghost" title={t('pc.discard')} onPress={discard} disabled={saving} />
      <Button testID="pc-save" size="sm" icon="content-save-outline" title={t('pc.save')} onPress={save} loading={saving} />
    </Card>
  ) : null;

  const highlight = explore ? HIGHLIGHT.explore : tool ? [] : HIGHLIGHT[tab] ?? [];
  const preview = <LivePreview rules={draft} scope={scope} tc={tc} onCase={setTc} highlight={highlight} onPickStep={pickStep} active={setUsed} />;
  const hint = explore ? 'pc.scopeExploreHint' : tool ? 'pc.scopeToolHint' : 'pc.scopeAllHint';
  const others = ['all', ...s.tools.map((x) => x.id)].filter((id) => id !== scope);

  return (
    <AdminPage title={t('admin.nav.promptCards')} max={1180} floating={bar}>
      <Txt className="text-[13px] text-muted mb-3">{t('pc.intro')}</Txt>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="pc-scopes" contentContainerStyle={{ gap: 10, paddingBottom: 4 }} className="mb-1">
        <ScopeTile id={EXPLORE} label={t('pc.scopeExplore')} icon="compass-outline" badge={touched(draft, 'explore', info.catalog)} on={explore} onPress={() => goScope(EXPLORE)} />
        <ScopeTile id="all" label={t('pc.scopeAll')} icon="layers-outline" badge={false} on={scope === 'all'} onPress={() => goScope('all')} />
        {s.tools.map((x) => <ScopeTile key={x.id} id={x.id} label={L(x.title)} thumb={toolThumb(x)} badge={hasOwnSteps(draft, x.id)} on={scope === x.id} onPress={() => goScope(x.id)} />)}
      </ScrollView>
      <View className="flex-row items-center gap-2 mt-2 mb-3 flex-wrap">
        <Txt testID="pc-scope-hint" className="text-[12px] text-muted flex-1" style={{ minWidth: 160 }}>{t(hint)}</Txt>
        {tool ? <Button safe testID="pc-copy" size="sm" variant="soft" icon="content-copy" title={t('pc.copyFrom')} onPress={() => setCopyOpen(true)} /> : null}
      </View>

      <View className={desktop ? 'flex-row gap-4 items-start' : ''}>
        <View className={desktop ? 'flex-1' : ''} style={desktop ? { minWidth: 0 } : undefined}>{page}</View>
        {desktop
          ? <View style={{ width: 470, ...(Platform.OS === 'web' ? ({ position: 'sticky', top: 12 } as object) : null) }}>{preview}</View>
          : <View className="mt-3">{preview}</View>}
      </View>

      <Sheet visible={copyOpen} onClose={() => setCopyOpen(false)} title={t('pc.copyTitle', { name: toolName(scope) })}>
        <Note tone="info" text={t('pc.copyHelp')} />
        {others.map((id) => {
          const thumb = id === 'all' ? '' : toolThumb(s.tools.find((x) => x.id === id));
          const custom = id !== 'all' && hasOwnSteps(draft, id);
          return (
            <Pressable key={id} testID={`pc-copy-${id}`} accessibilityRole="button" onPress={() => copyFrom(id)} className="flex-row items-center gap-3 py-2.5 border-b border-line">
              <View className="w-11 h-11 rounded-xl bg-surface2 overflow-hidden items-center justify-center">{thumb ? <Image source={{ uri: thumb }} style={{ width: 44, height: 44 }} contentFit="cover" /> : <Icon name={id === 'all' ? 'layers-outline' : 'image-outline'} size={22} tone="muted" />}</View>
              <View className="flex-1"><Txt className="font-bold text-[14px]" numberOfLines={1}>{toolName(id)}</Txt><Txt className="text-[12px] text-muted">{custom ? t('pc.copyFromOwn') : t('pc.copyFromAll')}</Txt></View>
              <Icon name="chevron-right" size={20} tone="muted" flip />
            </Pressable>
          );
        })}
      </Sheet>
    </AdminPage>
  );
}
