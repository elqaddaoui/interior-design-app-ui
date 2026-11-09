 
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ConfirmSheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { Controls } from '@/components/brand/Controls';
import { PreviewPanel } from '@/components/brand/PreviewPanel';
import { ExportSheet, HistorySheet, PublishSheet } from '@/components/brand/Sheets';
import { useStore } from '@/store/useStore';
import { useT } from '@/i18n';
import { useBp } from '@/hooks/useBp';
import { useBackCheckpoint, useLeaveGuard, router } from '@/hooks/useLeaveGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { toast } from '@/store/useToast';
import { storage } from '@/data/mock/storage';
import type { BrandVersion } from '@/data/types';
import { applyFavicon, faviconDataUrl } from '@/lib/brand/export';
import * as H from '@/lib/brand/history';
import { changedGroups, cleanSpec, hasErrors, legacyFields, sameSpec, specFromBranding, validateSpec, type LogoSpec } from '@/lib/brand/spec';
import { designLogo } from '@/lib/brand/design';
import type { Tone } from '@/lib/brand/palette';
import type { Locks } from '@/components/brand/Controls';

const DRAFT_KEY = 'branding-draft';
const MAX_VERSIONS = 20;
const PREVIEW_DELAY = 120;
const AUTOSAVE_DELAY = 800;

/** Value that follows `value` after `ms` of calm: typing and slider drags never re-render the heavy preview on every tick. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

const Tool = ({ icon, label, onPress, disabled, testID, on }: { icon: string; label: string; onPress: () => void; disabled?: boolean; testID: string; on?: boolean }) => (
  <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={4}
    className={`w-10 h-10 rounded-full items-center justify-center active:opacity-70 ${on ? 'bg-ink' : 'bg-surface2'} ${disabled ? 'opacity-40' : ''}`}>
    <Icon name={icon} size={19} tone={on ? 'onink' : 'fg'} />
  </Pressable>
);

function Studio() {
  const { t } = useT();
  const { desktop } = useBp();
  const { colors, dark } = useTheme();
  const branding = useStore((s) => s.doc.branding);
  const published = useMemo(() => specFromBranding(branding), [branding]);
  const versions = useMemo<BrandVersion[]>(() => branding.versions ?? [], [branding.versions]);
  const accent = colors.primary;

  /* one draft state: every control edits it through `up`; undo / redo / reset all work on it */
  const [hist, setHist] = useState(() => H.init(published));
  const spec = hist.present;
  const up = useCallback((fn: (s: LogoSpec) => LogoSpec, key?: string) => setHist((h) => H.commit(h, cleanSpec(fn(h.present)), key ?? '', Date.now(), sameSpec)), []);
  const dirty = !sameSpec(spec, published);
  const issues = useMemo(() => validateSpec(spec), [spec]);
  const shown = useDebounced(spec, PREVIEW_DELAY);

  const [locks, setLocks] = useState<Locks>({ font: false, color: false, layout: false });
  /* "match the app": colours of the running theme drive Surprise me and the demos (on by default: the logo lives inside the app) */
  const [matchApp, setMatchApp] = useState(true);
  const tone = useMemo<Tone | null>(() => (matchApp ? { primary: colors.primary, bg: colors.bg, surface: colors.surface, fg: colors.fg, ink: colors.ink, dark } : null), [matchApp, colors.primary, colors.bg, colors.surface, colors.fg, colors.ink, dark]);
  const recent = useRef<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'' | 'history' | 'export'>('');
  const [resetting, setResetting] = useState(false);

  /* autosave of the draft on this device + restore offer */
  const [found, setFound] = useState<{ spec: LogoSpec; at: number } | null>(null);
  const [checked, setChecked] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  useEffect(() => {
    let live = true;
    storage.read<{ spec: unknown; at: number }>(DRAFT_KEY).then((d) => {
      if (!live) return;
      if (d && d.spec) { const s = cleanSpec(d.spec); if (!sameSpec(s, published)) setFound({ spec: s, at: d.at }); }
      setChecked(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!checked || found) return;
    const id = setTimeout(() => {
      if (dirty) { const at = Date.now(); storage.write(DRAFT_KEY, { spec, at }); setSavedAt(at); }
      else { storage.write(DRAFT_KEY, null); setSavedAt(0); }
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(id);
  }, [spec, dirty, checked, found]);

  /* actions */
  const undo = () => setHist(H.undo);
  const redo = () => setHist(H.redo);
  /* each press = a new concept (never one of the last four), seeded by the clock, coloured from the app theme when matched */
  const doSurprise = () => {
    const d = designLogo(spec, Date.now(), locks, tone, { avoid: recent.current });
    recent.current = [d.concept, ...recent.current].slice(0, 4);
    up(() => d.spec);
  };
  const discard = useCallback(() => { storage.write(DRAFT_KEY, null); setHist(H.init(published)); setSavedAt(0); }, [published]);

  const publish = useCallback(async (): Promise<boolean> => {
    if (hasErrors(validateSpec(spec))) { toast(t('br.publishBlocked')); return false; }
    setBusy(true);
    try {
      const at = Date.now();
      const favicon = await faviconDataUrl(spec, accent);
      const entry: BrandVersion = { id: `v${at}`, at, note: '', groups: changedGroups(published, spec), logo: spec };
      const old = versions.length ? versions : [{ id: `v${at - 1}`, at: at - 1, note: '', groups: [], logo: published }];
      await useStore.getState().patchDoc('branding', { ...legacyFields(spec), logo: spec, favicon, versions: [entry, ...old].slice(0, MAX_VERSIONS) } as any);
      const stored = specFromBranding(useStore.getState().doc.branding);
      setHist((h) => (sameSpec(h.present, stored) ? h : { ...h, present: stored }));
      storage.write(DRAFT_KEY, null);
      setSavedAt(0);
      applyFavicon(useStore.getState().doc.branding.favicon ?? favicon);
      toast(t('br.publishedOk'));
      return true;
    } catch { toast(t('br.publishFailed')); return false; }
    finally { setBusy(false); }
  }, [spec, accent, published, versions, t]);

  const askPublish = () => {
    if (!dirty) { toast(t('br.nothingChanged')); return; }
    if (hasErrors(issues)) { toast(t('br.publishBlocked')); return; }
    setPublishing(true);
  };
  const restore = (v: BrandVersion) => { up(() => v.logo); setSheet(''); toast(t('br.rolledBack')); };

  useLeaveGuard(dirty, publish, discard, { before: published, after: spec });
  useBackCheckpoint(dirty, () => router.back());

  /* keyboard: Ctrl/Cmd+Z, Shift+Z, Y (not while a text field has the focus: it keeps its own native undo) */
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); setHist(e.shiftKey ? H.redo : H.undo); }
      else if (k === 'y') { e.preventDefault(); setHist(H.redo); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* the favicon of the tab follows the published logo */
  useEffect(() => { if (branding.favicon) applyFavicon(branding.favicon); }, [branding.favicon]);

  const preview = <PreviewPanel spec={shown} before={published} dirty={dirty} desktop={desktop} collapsed={collapsed} onCollapse={setCollapsed} />;
  const tools = (
    <View testID="brand-tools" className="flex-row items-center gap-1.5">
      <Tool testID="undo" icon="undo" label={t('br.undo')} onPress={undo} disabled={!H.canUndo(hist)} />
      <Tool testID="redo" icon="redo" label={t('br.redo')} onPress={redo} disabled={!H.canRedo(hist)} />
      <Tool testID="reset" icon="restart" label={t('br.reset')} onPress={() => setResetting(true)} disabled={!dirty} />
      <Tool testID="history" icon="history" label={t('br.history')} onPress={() => setSheet('history')} />
      <Tool testID="export" icon="download" label={t('br.export')} onPress={() => setSheet('export')} />
    </View>
  );
  const status = dirty ? (savedAt ? t('br.autosaved') : t('br.unsavedDraft')) : t('br.allPublished');
  const bar = (
    <Card className="p-2.5 rounded-2xl flex-row items-center gap-2" style={{ boxShadow: '0 6px 28px rgba(0,0,0,0.18)' } as any}>
      <View className="flex-1 flex-row items-center gap-1.5" style={{ minWidth: 0 }} accessibilityLiveRegion="polite">
        <Icon name={dirty ? 'circle-edit-outline' : 'check-circle-outline'} size={18} tone={dirty ? 'primary' : 'muted'} />
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt testID="brand-status" className={`text-[12px] font-bold ${dirty ? '' : 'text-muted'}`} numberOfLines={1}>{dirty ? t('br.unsavedDraft') : t('br.allPublished')}</Txt>
          {dirty && savedAt ? <Txt className="text-[10px] text-muted" numberOfLines={1}>{status}</Txt> : null}
        </View>
      </View>
      {dirty ? <Button testID="brand-discard" size="sm" variant="soft" title={t('improve.discard')} onPress={() => setResetting(true)} disabled={busy} /> : null}
      <Button testID="brand-save" size="sm" icon="rocket-launch-outline" title={t('br.publish')} onPress={askPublish} loading={busy} disabled={!dirty && !busy} />
    </Card>
  );

  const draftBanner = found ? (
    <Card testID="draft-found" className="p-3 mb-3 flex-row flex-wrap items-center gap-2">
      <Icon name="backup-restore" size={18} tone="primary" />
      <Txt className="flex-1 text-[13px] font-bold" style={{ minWidth: 160 }}>{t('br.draftFound')}</Txt>
      <Button testID="draft-restore" size="sm" title={t('br.draftRestore')} onPress={() => { up(() => found.spec); setFound(null); }} />
      <Button testID="draft-drop" size="sm" variant="soft" title={t('br.draftDrop')} onPress={() => { storage.write(DRAFT_KEY, null); setFound(null); }} />
    </Card>
  ) : null;

  const controls = (
    <View style={{ flex: 1, minWidth: 0 }}>
      {draftBanner}
      <Controls spec={spec} up={up} issues={issues} locks={locks} setLocks={setLocks} onSurprise={doSurprise} accent={accent} tone={tone} matchApp={matchApp} setMatchApp={setMatchApp} />
      {Platform.OS === 'web' && desktop ? <Txt className="text-[11px] text-muted text-center mt-2">{t('br.shortcuts')}</Txt> : null}
    </View>
  );

  return (
    <AdminPage title={t('admin.nav.branding')} max={1180} right={tools} floating={bar} audience="both">
      {desktop ? (
        <View className="flex-row gap-4 items-start">
          {controls}
          {/* the column stretches over the whole row so the sticky box has room to travel while the controls scroll */}
          <View testID="brand-preview-col" style={{ width: 460, maxWidth: '45%', alignSelf: 'stretch' }}>
            <View style={{ position: 'sticky', top: 8 } as any}>{preview}</View>
          </View>
        </View>
      ) : (
        <View>
          <View testID="brand-preview-col" style={{ position: 'sticky', top: 0, zIndex: 20, backgroundColor: colors.bg, paddingBottom: 8 } as any}>{preview}</View>
          {controls}
        </View>
      )}
      <PublishSheet visible={publishing} onClose={() => setPublishing(false)} before={published} after={spec} groups={changedGroups(published, spec)} issues={issues} busy={busy}
        onConfirm={async () => { if (await publish()) setPublishing(false); }} />
      <HistorySheet visible={sheet === 'history'} onClose={() => setSheet('')} versions={versions} published={published} onRestore={restore} />
      <ExportSheet visible={sheet === 'export'} onClose={() => setSheet('')} spec={spec} />
      <ConfirmSheet visible={resetting} onClose={() => setResetting(false)} message={t('br.resetTitle')} confirmLabel={t('br.resetConfirm')} cancelLabel={t('br.cancel')}
        onConfirm={() => { up(() => published); }} />
    </AdminPage>
  );
}

export default function Branding() {
  const contentReady = useStore((s) => s.contentReady);
  const { t } = useT();
  if (!contentReady) return <AdminPage title={t('admin.nav.branding')}><AdminLoading /></AdminPage>;
  return <Studio />;
}
