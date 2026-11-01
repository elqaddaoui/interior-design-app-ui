import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon, ICON_CHOICES } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { MediaView, MediaView as Thumb } from '@/components/ui/MediaView';
import { Sheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { ColorPicker } from './ColorPicker';
import { ImageField } from './ImageField';
import { SlideshowModal } from './toolcards/SlideshowModal';
import { slideshowImages } from '@/lib/toolCards';
import { LangDots, LangField } from './LangField';
import { mergeStates } from '@/lib/langStatus';
import { useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { toast } from '@/store/useToast';
import { translateLines, translationsIdle, usePendingTranslations } from '@/lib/autoTranslate';
import { mediaUploadsEnabled, pickAndUploadVideo, uploadsIdle, usePendingUploads } from '@/lib/media';
import { requestLeave, useLeaveGuard } from '@/hooks/useLeaveGuard';
import { PartialSaveError } from '@/hooks/useReveal';
import type { LText } from '@/data/types';

export type Opt = { value: string; label: string };
export type Ctx = { s: ReturnType<typeof useStore.getState>; L: ReturnType<typeof useL>; t: ReturnType<typeof useT>['t'] };
type Base = { key: string; label: string; show?: (v: any) => boolean };
export type FieldDef =
  | (Base & { kind: 'text' | 'secret' | 'number'; required?: boolean; multiline?: boolean })
  | (Base & { kind: 'ltext'; multiline?: boolean })
  | (Base & { kind: 'bool' })
  | (Base & { kind: 'select'; options: (c: Ctx) => Opt[]; required?: boolean })
  | (Base & { kind: 'multi'; options: (c: Ctx) => Opt[] })
  | (Base & { kind: 'image' })
  | (Base & { kind: 'media' })
  | (Base & { kind: 'colors' })
  | (Base & { kind: 'icon' });

function Chips({ options, value, onChange, multi }: { options: Opt[]; value: any; onChange: (v: any) => void; multi?: boolean }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const on = multi ? (value as string[]).includes(o.value) : value === o.value;
        return (
          <Pressable key={o.value} testID={`chip-${o.value}`} onPress={() => onChange(multi ? (on ? (value as string[]).filter((x) => x !== o.value) : [...(value as string[]), o.value]) : o.value)}
            className={`px-3.5 h-9 rounded-full items-center justify-center flex-row gap-1.5 border ${on ? 'bg-primary border-primary' : 'bg-surface2 border-transparent'}`}>
            {on ? <Icon name="check" size={14} tone="onprimary" /> : null}
            <Txt className={`text-[13px] font-semibold ${on ? 'text-onprimary' : ''}`}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ f, value, onChange, ctx, error, record }: { f: FieldDef; value: any; onChange: (v: any) => void; ctx: Ctx; error?: string; record?: any }) {
  const { t } = ctx;
  const label = <Txt className="text-[13px] font-semibold text-muted mb-1.5">{f.label}</Txt>;
  switch (f.kind) {
    case 'text': case 'secret': case 'number':
      return <Input label={f.label} value={value == null ? '' : String(value)} error={error} secureTextEntry={f.kind === 'secret'} keyboardType={f.kind === 'number' ? 'numeric' : 'default'}
        multiline={'multiline' in f && f.multiline} style={'multiline' in f && f.multiline ? { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 } : undefined}
        autoCapitalize={f.kind === 'secret' ? 'none' : undefined}
        onChangeText={(v) => onChange(f.kind === 'number' ? (v === '' ? 0 : Number(v.replace(/[^\d.-]/g, '')) || 0) : v)} />;
    case 'ltext':
      return <View className="mb-3"><LangField label={f.label} fieldKey={f.key} value={value as LText} onChange={onChange} error={error} multiline={f.multiline} /></View>;
    case 'bool':
      return (
        <View className="flex-row items-center justify-between gap-3" style={{ minHeight: 32 }}>
          <Txt className="font-semibold text-[14px] flex-1">{f.label}</Txt>
          <Toggle testID={`sw-${f.key}`} label={f.label} value={!!value} onValueChange={onChange} />
        </View>
      );
    case 'select':
      return <View className="mb-3">{label}<Chips options={f.options(ctx)} value={value} onChange={onChange} />{error ? <Txt className="text-danger text-[12px] mt-1">{error}</Txt> : null}</View>;
    case 'multi':
      return <View className="mb-3">{label}<Chips multi options={f.options(ctx)} value={value ?? []} onChange={onChange} /></View>;
    case 'image':
      return <ImageField label={f.label} value={value ?? ''} onChange={onChange} />;
    case 'icon':
      return (
        <View className="mb-3">{label}
          <View className="flex-row flex-wrap gap-2">
            {ICON_CHOICES.map((n) => (
              <Pressable key={n} onPress={() => onChange(n)} className={`w-11 h-11 rounded-xl items-center justify-center ${value === n ? 'bg-primary' : 'bg-surface2'}`}><Icon name={n} size={22} tone={value === n ? 'onprimary' : 'fg'} /></Pressable>
            ))}
          </View>
        </View>
      );
    case 'media': {
      const m = value ?? { type: 'image', uri: '' };
      return (
        <View className="mb-2">{label}
          <MediaTypeChips m={m} onChange={onChange} record={record} />
          <View className="h-3" />
          {m.type === 'slideshow'
            ? <SlideshowSummary m={m} onChange={onChange} record={record} />
            : m.type === 'image'
            ? <ImageField label={t('admin.f.mediaUrl')} value={m.uri} onChange={(v) => onChange({ ...m, uri: v })} />
            : <><Input label={`${t('admin.f.mediaUrl')} (.mp4)`} value={m.uri} onChangeText={(v) => onChange({ ...m, uri: v })} autoCapitalize="none" placeholder="https://…/video.mp4" />
                {mediaUploadsEnabled ? <VideoUpload onUploaded={(uri, poster) => onChange({ ...m, uri, poster: poster || m.poster })} /> : null}
                {mediaUploadsEnabled ? <AutoPoster media={m} onChange={onChange} /> : null}
                <ImageField label={t('admin.f.poster')} value={m.poster ?? ''} onChange={(v) => onChange({ ...m, poster: v })} /></>}
        </View>
      );
    }
    case 'colors': {
      const list: string[] = value ?? [];
      return (
        <View className="mb-3">{label}
          {list.map((c, i) => (
            <View key={i} className="flex-row items-start gap-2">
              <View className="flex-1"><ColorPicker value={c} onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))} /></View>
              <Pressable testID={`color-dup-${i}`} accessibilityRole="button" accessibilityLabel={t('ax.duplicateColor')} onPress={() => onChange([...list.slice(0, i + 1), c, ...list.slice(i + 1)])} className="w-9 h-11 items-center justify-center"><Icon name="content-copy" size={18} /></Pressable>
              <Pressable testID={`color-del-${i}`} accessibilityRole="button" accessibilityLabel={t('common.delete')} onPress={() => onChange(list.filter((_, j) => j !== i))} className="w-9 h-11 items-center justify-center"><Icon name="trash-can-outline" size={20} tone="danger" /></Pressable>
            </View>
          ))}
          <Button size="sm" variant="soft" icon="plus" title={t('common.add')} onPress={() => onChange([...list, '#CCCCCC'])} />
        </View>
      );
    }
  }
}

/**
 * Image / Video / Multiple images. Choosing "Multiple images" opens the slideshow popup at once (pictures + animation settings + live card preview).
 * The first picture of an existing image becomes the first slide, so nothing the admin already uploaded is lost.
 */
function MediaTypeChips({ m, onChange, record }: { m: any; onChange: (v: any) => void; record?: any }) {
  const { t } = useT();
  const [open, setOpen] = React.useState(false);
  const pick = (v: string) => {
    if (v !== 'slideshow') { onChange({ ...m, type: v }); return; }
    const images = m.images?.length ? m.images : m.type === 'image' && m.uri ? [m.uri] : [];
    onChange({ ...m, type: 'slideshow', images, uri: images[0] ?? '' });
    setOpen(true);
  };
  return <>
    <Chips options={[{ value: 'image', label: t('admin.f.image') }, { value: 'video', label: t('admin.f.video') }, { value: 'slideshow', label: t('tc.multiImages') }]} value={m.type} onChange={pick} />
    {open && m.type === 'slideshow' ? <SlideshowModal title={record?.title} subtitle={record?.subtitle} media={m} onChange={onChange} onClose={() => setOpen(false)} /> : null}
  </>;
}

/** Slideshow selected: thumbnails of its pictures and the button that reopens the popup. */
function SlideshowSummary({ m, onChange, record }: { m: any; onChange: (v: any) => void; record?: any }) {
  const { t } = useT();
  const [open, setOpen] = React.useState(false);
  const images = slideshowImages(m);
  return <View className="mb-3">
    <View className="flex-row flex-wrap gap-2 mb-2">
      {images.slice(0, 6).map((uri, i) => <Thumb key={`${i}-${uri}`} uri={uri} className="rounded-lg" style={{ width: 56, height: 56 }} />)}
      {images.length > 6 ? <View className="rounded-lg bg-surface2 items-center justify-center" style={{ width: 56, height: 56 }}><Txt className="text-muted font-bold">+{images.length - 6}</Txt></View> : null}
    </View>
    <Txt className="text-muted text-[12px] mb-2">{t('tc.imagesCount', { n: images.length })}</Txt>
    <View className="flex-row"><Button testID="slideshow-open" size="sm" variant="soft" icon="image-multiple-outline" title={t('tc.configure')} onPress={() => setOpen(true)} /></View>
    {open ? <SlideshowModal title={record?.title} subtitle={record?.subtitle} media={m} onChange={onChange} onClose={() => setOpen(false)} /> : null}
  </View>;
}

/** Direct (presigned) upload of a video file to R2; the field receives its /api/media URL. */
function VideoUpload({ onUploaded }: { onUploaded: (uri: string, poster: string) => void }) {
  const { t } = useT();
  const [busy, setBusy] = React.useState(false);
  const up = async () => {
    setBusy(true);
    try { const { uri, poster } = await pickAndUploadVideo(); if (uri) onUploaded(uri, poster); }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      toast(/TOO_LARGE/.test(code) ? t('admin.f.videoTooLarge') : code === 'R2_REQUIRED' ? t('improve.videoNeedsR2') : /^UPLOAD_(BLOCKED|FAILED_403)$/.test(code) ? t('improve.uploadBlocked') : t('admin.f.uploadFailed'));
    }
    finally { setBusy(false); }
  };
  return <View className="flex-row -mt-1 mb-3"><Button title={t('admin.f.uploadVideo')} icon="upload" variant="soft" size="sm" onPress={up} loading={busy} /></View>;
}

/**
 * A video without a preview image gets its first frame as the thumbnail, automatically (once per video). Uploads already bring
 * theirs; this covers pasted URLs. A server that does not allow reading the video simply leaves the preview empty (the admin can still add one).
 */
function AutoPoster({ media, onChange }: { media: { type: string; uri: string; poster?: string }; onChange: (v: any) => void }) {
  const latest = React.useRef(media);
  React.useEffect(() => { latest.current = media; });
  const tried = React.useRef('');
  const [busy, setBusy] = React.useState(false);
  const { t } = useT();
  React.useEffect(() => {
    const uri = media.uri.trim();
    if (media.poster || !/^https?:\/\/|^\/api\/media\//i.test(uri) || tried.current === uri) return;
    // Wait for the typing to stop before touching the network.
    const timer = setTimeout(async () => {
      tried.current = uri;
      setBusy(true);
      const { posterForVideo } = await import('@/lib/videoPoster');
      const poster = await posterForVideo(uri);
      setBusy(false);
      const now = latest.current;
      if (poster && now.uri.trim() === uri && !now.poster) onChange({ ...now, poster });
    }, 700);
    return () => clearTimeout(timer);
  }, [media.uri, media.poster, onChange]);
  return busy ? <Txt testID="poster-busy" className="text-muted text-[12px] -mt-1 mb-3">{t('inbox.posterBusy')}</Txt> : null;
}

export function validate(fields: FieldDef[], v: any, t: Ctx['t']) {
  const err: Record<string, string> = {};
  v = v ?? {};
  for (const f of fields) {
    if (f.show && !f.show(v)) continue;
    if (f.kind === 'ltext') { const x = v[f.key] as LText; if (!x || ![x.dar, x.ar, x.fr].some((value) => value?.trim())) err[f.key] = t('admin.crud.required'); }
    else if ((f.kind === 'text' || f.kind === 'select') && 'required' in f && f.required && !String(v[f.key] ?? '').trim()) err[f.key] = t('admin.crud.required');
  }
  return err;
}
/** Fill empty languages from the first filled one so the UI never shows blanks. */
export function normalize(fields: FieldDef[], v: any) {
  const out = { ...v };
  for (const f of fields) if (f.kind === 'ltext') {
    const x = (out[f.key] ?? { dar: '', ar: '', fr: '' }) as LText; const first = x.dar || x.ar || x.fr;
    out[f.key] = { dar: x.dar || first, ar: x.ar || first, fr: x.fr || first };
  }
  return out;
}

function FormDialog({ visible, title, fields, initial, onClose, onSubmit, onDraftChange }: { visible: boolean; title: string; fields: FieldDef[]; initial: any; onClose: () => void; onSubmit: (v: any) => Promise<void> | void; onDraftChange?: (v: any) => void }) {
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const [v, setV] = useState<any>(initial ?? {});
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const translating = usePendingTranslations() > 0;
  const uploading = usePendingUploads() > 0 || translating;
  const ctx: Ctx = { s, L, t };
  const latest = useRef(v);
  useEffect(() => { latest.current = v; });
  const submit = async () => {
    setBusy(true);
    // A picture or video still travelling would be saved as an empty field: wait for it, then save the finished form.
    await uploadsIdle();
    // Automatic translations still travelling fill the other languages: wait for them so the saved form is complete.
    await translationsIdle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const now = latest.current;
    const e = validate(fields, now, t);
    setErr(e);
    if (Object.keys(e).length) { setBusy(false); return false; }
    try { await onSubmit(normalize(fields, now)); return true; } catch { toast(t('improve.saveError')); return false; } finally { setBusy(false); }
  };
  const langKeys = fields.filter((f) => f.kind === 'ltext' && (!f.show || f.show(v))).map((f) => f.key);
  const dirty = visible && JSON.stringify(v) !== JSON.stringify(initial ?? {});
  useLeaveGuard(dirty, submit, onClose, { before: initial ?? {}, after: v, labels: Object.fromEntries(fields.map(f => [f.key, f.label])), secrets: fields.filter(f => f.kind === 'secret').map(f => f.key) });
  useEffect(() => { if (visible) onDraftChange?.(v); }, [v, visible, onDraftChange]);
  const close = () => { if (!busy) requestLeave(onClose); };
  return (
    <Sheet visible={visible} onClose={close} title={title} wide footer={<View className="flex-row gap-2.5">
      <Button title={t('common.cancel')} variant="soft" onPress={close} disabled={busy} className="flex-1" />
      <Button testID="form-save" title={t('improve.submit')} onPress={submit} loading={busy || uploading} className="flex-1" />
    </View>}>
      {visible ? <View testID="form-preview" className="bg-soft rounded-xl px-3 py-2 mb-2 flex-row items-center gap-3">
        {v.image || v.media?.uri ? <MediaView uri={v.image || v.media?.poster || v.media?.uri} style={{ width: 44, height: 44, borderRadius: 10 }} /> : null}
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt className="text-muted text-[10px] font-bold tracking-wide">{t('improve.previewLabel')}</Txt>
          <Txt className="font-bold text-[15px]" numberOfLines={1}>{L(v.title) || v.name || title}</Txt>
          {v.subtitle ? <Txt className="text-muted text-[12px]" numberOfLines={1}>{L(v.subtitle)}</Txt> : null}
          {v.colors ? <View className="flex-row gap-1 mt-1">{v.colors.map((color: string, i: number) => <View key={i} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color }} />)}</View> : null}
        </View>
        {langKeys.length ? <LangDots all states={mergeStates(langKeys.map((key) => v[key]))} /> : null}
      </View> : null}
      <FormFields fields={visible ? fields : []} value={v} errors={err} ctx={ctx} onChange={(key, value) => setV((old: any) => ({ ...old, [key]: value }))} />
    </Sheet>
  );
}


/**
 * How much room a field needs: wide editors (languages, media, colours, icons, long chip lists, multi-line text) take a full row,
 * short ones (a toggle, a short text, a few chips, a photo) share a row two by two.
 */
function span(f: FieldDef, ctx: Ctx): 'full' | 'half' {
  switch (f.kind) {
    case 'ltext': case 'media': case 'colors': case 'icon': return 'full';
    case 'text': case 'secret': case 'number': return 'multiline' in f && f.multiline ? 'full' : 'half';
    case 'select': case 'multi': return f.options(ctx).reduce((sum, o) => sum + o.label.length * 7.5 + 44, 0) <= 330 ? 'half' : 'full';
    default: return 'half';
  }
}

/** Fields in reading order, packed into rows without holes: a short field takes the next short one (looking 3 fields ahead) as its row mate. */
export function packRows(fields: FieldDef[], ctx: Ctx, twoColumns: boolean): FieldDef[][] {
  const queue = [...fields];
  const rows: FieldDef[][] = [];
  while (queue.length) {
    const f = queue.shift() as FieldDef;
    if (!twoColumns || span(f, ctx) === 'full') { rows.push([f]); continue; }
    const mate = queue.findIndex((x, i) => i < 3 && span(x, ctx) === 'half');
    rows.push(mate >= 0 ? [f, queue.splice(mate, 1)[0]] : [f]);
  }
  return rows;
}

/** Layout is based on the actual dialog width, not the viewport behind it. */
export function FormFields({ fields, value, errors, ctx, onChange }: { fields: FieldDef[]; value: any; errors: Record<string, string>; ctx: Ctx; onChange: (key: string, value: any) => void }) {
  const [width, setWidth] = useState(0);
  const rows = packRows(fields.filter((f) => !f.show || f.show(value ?? {})), ctx, width >= 680);
  return <View testID="form-fields" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ gap: 8 }}>
    {rows.map((row) => <View key={row.map((f) => f.key).join('+')} style={{ flexDirection: 'row', gap: 8, alignItems: 'stretch' }}>
      {row.map((f) => <View key={f.key} testID={`field-${f.key}`} className="bg-surface rounded-xl border border-line px-3 pt-2.5" style={{ flex: 1, minWidth: 0, justifyContent: f.kind === 'bool' ? 'center' : undefined, paddingBottom: f.kind === 'bool' ? 10 : 0 }}>
        <Field f={f} ctx={ctx} value={value?.[f.key]} record={value} error={errors[f.key]} onChange={(v) => onChange(f.key, v)} />
      </View>)}
    </View>)}
  </View>;
}

function BatchFormDialog({ mode, title, fields, initial, initialKeys = [], blank, onClose, onSubmit }: { mode: 'add' | 'edit' | null; title: string; fields: FieldDef[]; initial: any; initialKeys?: string[]; blank: () => any; onClose: () => void; onSubmit: (values: any[], keys: string[]) => Promise<void> }) {
  const { t } = useT(); const L = useL(); const s = useStore(); const ctx = { s, L, t };
  const titleField = fields.find((f) => f.key === 'title' && f.kind === 'ltext') ?? fields.find((f) => f.key === 'name' && f.kind === 'text');
  const [pasteMode, setPasteMode] = useState(!!titleField);
  const [text, setText] = useState('');
  const [shared, setShared] = useState<any>(() => mode === 'add' ? blank() : {});
  const [drafts, setDrafts] = useState<any[]>(() => mode === 'add' ? [blank(), blank()] : mode === 'edit' ? [{ ...initial }] : []);
  const [pasteDrafts, setPasteDrafts] = useState<any[]>([]);
  const [keys, setKeys] = useState<string[]>(initialKeys);
  const [errors, setErrors] = useState<Record<string, string>[]>([]);
  const [pasteError, setPasteError] = useState('');
  const [busy, setBusy] = useState(false);
  const sharedFields = fields.filter((f) => f.key !== titleField?.key);
  const pasted = mode === 'add' && pasteMode;
  const lines = text.split(/\r?\n/).map((line) => line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '')).filter(Boolean);
  const translating = usePendingTranslations() > 0;
  const uploading = usePendingUploads() > 0 || translating;
  const submit = async () => {
    if (uploading) { toast(t(translating ? 'improve.translateWait' : 'improve.uploadWait')); return false; }
    if (pasted && (!lines.length || lines.length > 50)) { setPasteError(t('improve.pasteError')); return false; }
    const active = mode === 'edit' ? fields.filter((f) => keys.includes(f.key)) : fields;
    let titles: any[] = lines;
    if (pasted && titleField!.kind === 'ltext') {
      setBusy(true);
      try { titles = await translateLines(lines); } finally { setBusy(false); }
    }
    const values = pasted ? pasteDrafts.map((draft, i) => ({ ...shared, id: draft.id, [titleField!.key]: titles[i] })) : drafts;
    const nextErrors = values.map((v) => validate(active, v, t));
    setErrors(nextErrors);
    if (nextErrors.some((e) => Object.keys(e).length)) return false;
    setBusy(true);
    try { await onSubmit(values.map((v) => normalize(active, v)), keys); return true; }
    catch (error) { toast(error instanceof PartialSaveError ? error.message : t('improve.saveError')); return false; } finally { setBusy(false); }
  };
  const snapshot = JSON.stringify({ text, shared, drafts, keys });
  const [original] = useState(snapshot);
  const [originalValues] = useState(() => ({ text, shared, drafts, keys }));
  useLeaveGuard(!!mode && snapshot !== original, submit, onClose, { before: originalValues, after: { text, shared, drafts, keys }, labels: { text: t('improve.pasteText'), keys: t('improve.selectedFields'), ...Object.fromEntries(fields.flatMap(f => [[`shared.${f.key}`, f.label], [`drafts.0.${f.key}`, f.label]])) }, secrets: fields.filter(f => f.kind === 'secret').flatMap(f => [`shared.${f.key}`, ...drafts.map((_, i) => `drafts.${i}.${f.key}`)]) });
  const close = () => { if (!busy) requestLeave(onClose); };
  return <Sheet visible={!!mode} title={title} wide={mode === 'add'} onClose={close} footer={<View className="flex-row gap-2.5"><Button title={t('common.cancel')} variant="soft" onPress={close} disabled={busy} className="flex-1" /><Button testID="batch-save" title={pasted ? t('improve.createCount', { count: lines.length }) : t('common.save')} onPress={submit} loading={busy || uploading} disabled={mode === 'edit' && !keys.length || pasted && (!lines.length || lines.length > 50)} className="flex-1" /></View>}>
    {mode === 'edit' ? <>
      <Txt className="text-muted text-[12px] leading-[18px] mb-2">{t('improve.batchHelp')}</Txt>
      {fields.filter((f) => !f.show || f.show(drafts[0] ?? {})).map((f) => <View key={f.key} className="rounded-xl border border-line px-3 pt-2.5 pb-1.5 mb-2 bg-surface">
        <View className="flex-row items-center gap-3 mb-1.5"><Toggle label={f.label} testID={`batch-field-${f.key}`} value={keys.includes(f.key)} onValueChange={(on) => setKeys((old) => on ? [...old, f.key] : old.filter((key) => key !== f.key))} /><Txt className="flex-1 font-bold text-[14px]">{f.label}</Txt></View>
        <View pointerEvents={keys.includes(f.key) ? 'auto' : 'none'} style={{ opacity: keys.includes(f.key) ? 1 : 0.4 }}><Field f={f} value={drafts[0]?.[f.key]} error={errors[0]?.[f.key]} ctx={ctx} onChange={(v) => setDrafts(([old]) => [{ ...old, [f.key]: v }])} /></View>
      </View>)}
    </> : <>
      {titleField ? <View className="flex-row flex-wrap gap-2 mb-2.5"><Button size="sm" icon="text-box-outline" variant={pasteMode ? 'primary' : 'soft'} title={t('improve.pasteMode')} onPress={() => { setPasteMode(true); setErrors([]); }} /><Button testID="batch-individual" size="sm" icon="form-select" variant={!pasteMode ? 'primary' : 'soft'} title={t('improve.individual')} onPress={() => { setPasteMode(false); setErrors([]); }} /></View> : null}
      {pasteMode && titleField ? <>
        <Txt className="text-muted text-[12px] leading-[18px] mb-2">{t('improve.pasteHelp')}</Txt>
        <Input testID="batch-titles" label={t('improve.pasteTitles')} multiline value={text} error={pasteError} placeholder="Salon\nCuisine\nChambre" style={{ minHeight: 120, maxHeight: 200, textAlignVertical: 'top' }} onChangeText={(value) => {
          setText(value);
          const count = value.split(/\r?\n/).map((line) => line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '')).filter(Boolean).length;
          setPasteError(count > 50 ? t('improve.pasteError') : '');
          setPasteDrafts((old) => Array.from({ length: Math.min(count, 50) }, (_, i) => old[i] ?? blank()));
        }} />
        <Txt className="font-bold text-[14px] mb-1.5">{t('improve.sharedSettings')}</Txt>
        <FormFields fields={sharedFields} value={shared} errors={errors[0] ?? {}} ctx={ctx} onChange={(key, value) => setShared((old: any) => ({ ...old, [key]: value }))} />
      </> : <>
        {drafts.map((v, i) => <View key={v.id} className="mb-3">
          <View className="flex-row items-center justify-between mb-1"><Txt className="font-bold text-[14px]">{t('admin.crud.addNew')} · {i + 1}</Txt>{drafts.length > 1 ? <Button size="sm" variant="soft" icon="close" title={t('improve.removeDraft')} disabled={busy} onPress={() => setDrafts((old) => old.filter((_, index) => i !== index))} /> : null}</View>
          <FormFields fields={fields} value={v} errors={errors[i] ?? {}} ctx={ctx} onChange={(key, value) => setDrafts((old) => old.map((item, index) => index === i ? { ...item, [key]: value } : item))} />
        </View>)}
        <Button testID="batch-add-another" variant="soft" icon="plus" title={t('improve.addAnother')} disabled={busy || drafts.length >= 50} onPress={() => setDrafts((old) => [...old, blank()])} />
      </>}
    </>}
  </Sheet>;
}

/** Opening a different record starts a fresh draft; store updates never overwrite typing. */
export function FormModal(props: React.ComponentProps<typeof FormDialog>) {
  return <FormDialog key={props.visible ? props.initial?.id ?? 'new' : 'closed'} {...props} />;
}
export function BatchFormModal(props: React.ComponentProps<typeof BatchFormDialog>) {
  return <BatchFormDialog key={props.mode ?? 'closed'} {...props} />;
}
