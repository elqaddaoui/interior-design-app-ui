import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Icon, Input, MediaView, Sheet, Toggle, Txt } from '@/components/ui';
import { ICON_CHOICES } from '@/components/ui/Icon';
import { ColorPicker } from './ColorPicker';
import { ImageField } from './ImageField';
import { useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { toast } from '@/store/useToast';
import { requestLeave, useLeaveGuard } from '@/hooks/useLeaveGuard';
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

const LANG_LABELS: { k: keyof LText; key: string }[] = [{ k: 'dar', key: 'title_dar' }, { k: 'ar', key: 'title_ar' }, { k: 'fr', key: 'title_fr' }];

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

export function Field({ f, value, onChange, ctx, error }: { f: FieldDef; value: any; onChange: (v: any) => void; ctx: Ctx; error?: string }) {
  const { t } = ctx;
  const label = <Txt className="text-[13px] font-semibold text-muted mb-1.5">{f.label}</Txt>;
  switch (f.kind) {
    case 'text': case 'secret': case 'number':
      return <Input label={f.label} value={value == null ? '' : String(value)} error={error} secureTextEntry={f.kind === 'secret'} keyboardType={f.kind === 'number' ? 'numeric' : 'default'}
        multiline={'multiline' in f && f.multiline} style={'multiline' in f && f.multiline ? { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 } : undefined}
        autoCapitalize={f.kind === 'secret' ? 'none' : undefined}
        onChangeText={(v) => onChange(f.kind === 'number' ? (v === '' ? 0 : Number(v.replace(/[^\d.-]/g, '')) || 0) : v)} />;
    case 'ltext':
      return (
        <View className="mb-1">
          {label}
          {LANG_LABELS.map(({ k, key }) => (
            <Input key={k} language={k} testID={`lt-${f.key}-${k}`} placeholder={t(`admin.f.${key}`)} value={(value as LText)?.[k] ?? ''} error={k === 'dar' ? error : undefined}
              multiline={f.multiline} label={t(`admin.f.${key}`)} style={{ textAlign: k === 'fr' ? 'left' : 'right', writingDirection: k === 'fr' ? 'ltr' : 'rtl' } as any}
              onChangeText={(v) => onChange({ ...(value ?? { dar: '', ar: '', fr: '' }), [k]: v })} />
          ))}
        </View>
      );
    case 'bool':
      return (
        <View className="flex-row items-center justify-between mb-4 bg-surface2 rounded-xl px-4 h-12">
          <Txt className="font-semibold text-[14px] flex-1">{f.label}</Txt>
          <Toggle testID={`sw-${f.key}`} label={f.label} value={!!value} onValueChange={onChange} />
        </View>
      );
    case 'select':
      return <View className="mb-4">{label}<Chips options={f.options(ctx)} value={value} onChange={onChange} />{error ? <Txt className="text-danger text-[12px] mt-1">{error}</Txt> : null}</View>;
    case 'multi':
      return <View className="mb-4">{label}<Chips multi options={f.options(ctx)} value={value ?? []} onChange={onChange} /></View>;
    case 'image':
      return <ImageField label={f.label} value={value ?? ''} onChange={onChange} />;
    case 'icon':
      return (
        <View className="mb-4">{label}
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
          <Chips options={[{ value: 'image', label: t('admin.f.image') }, { value: 'video', label: t('admin.f.video') }]} value={m.type} onChange={(v) => onChange({ ...m, type: v })} />
          <View className="h-3" />
          {m.type === 'image'
            ? <ImageField label={t('admin.f.mediaUrl')} value={m.uri} onChange={(v) => onChange({ ...m, uri: v })} />
            : <><Input label={`${t('admin.f.mediaUrl')} (.mp4)`} value={m.uri} onChangeText={(v) => onChange({ ...m, uri: v })} autoCapitalize="none" placeholder="https://…/video.mp4" />
                <ImageField label={t('admin.f.poster')} value={m.poster ?? ''} onChange={(v) => onChange({ ...m, poster: v })} /></>}
        </View>
      );
    }
    case 'colors': {
      const list: string[] = value ?? [];
      return (
        <View className="mb-4">{label}
          {list.map((c, i) => (
            <View key={i} className="flex-row items-start gap-2">
              <View className="flex-1"><ColorPicker value={c} onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))} /></View>
              <Pressable onPress={() => onChange(list.filter((_, j) => j !== i))} className="w-9 h-11 items-center justify-center"><Icon name="trash-can-outline" size={20} tone="danger" /></Pressable>
            </View>
          ))}
          <Button size="sm" variant="soft" icon="plus" title={t('common.add')} onPress={() => onChange([...list, '#CCCCCC'])} />
        </View>
      );
    }
  }
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
  const ctx: Ctx = { s, L, t };
  const submit = async () => {
    const e = validate(fields, v, t);
    setErr(e);
    if (Object.keys(e).length) return false;
    setBusy(true);
    try { await onSubmit(normalize(fields, v)); return true; } catch { toast(t('improve.saveError')); return false; } finally { setBusy(false); }
  };
  const dirty = visible && JSON.stringify(v) !== JSON.stringify(initial ?? {});
  useLeaveGuard(dirty, submit, onClose);
  useEffect(() => { if (visible) onDraftChange?.(v); }, [v, visible, onDraftChange]);
  const close = () => { if (!busy) requestLeave(onClose); };
  return (
    <Sheet visible={visible} onClose={close} title={title} wide footer={<View className="flex-row gap-3">
      <Button title={t('common.cancel')} variant="soft" onPress={close} disabled={busy} className="flex-1" />
      <Button testID="form-save" title="Submit" onPress={submit} loading={busy} className="flex-1" />
    </View>}>
      {visible ? <View testID="form-preview" className="bg-soft rounded-xl p-3 mb-3">
        <Txt className="text-muted text-[11px] font-bold mb-2">LIVE PREVIEW · NOT SAVED</Txt>
        {v.image || v.media?.uri ? <MediaView uri={v.image || v.media?.poster || v.media?.uri} style={{ height: 130, borderRadius: 10, marginBottom: 8 }} /> : null}
        <Txt className="font-bold text-[18px]">{L(v.title) || v.name || title}</Txt>
        {v.subtitle ? <Txt className="text-muted text-[13px]">{L(v.subtitle)}</Txt> : null}
        {v.colors ? <View className="flex-row gap-1 mt-2">{v.colors.map((color: string, i: number) => <View key={i} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color }} />)}</View> : null}
      </View> : null}
      <FormFields fields={visible ? fields : []} value={v} errors={err} ctx={ctx} onChange={(key, value) => setV((old: any) => ({ ...old, [key]: value }))} />
    </Sheet>
  );
}


/** Layout is based on the actual dialog width, not the viewport behind it. */
export function FormFields({ fields, value, errors, ctx, onChange }: { fields: FieldDef[]; value: any; errors: Record<string, string>; ctx: Ctx; onChange: (key: string, value: any) => void }) {
  const [width, setWidth] = useState(0);
  return <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }}>
    {fields.filter((f) => !f.show || f.show(value ?? {})).map((f) => <View key={f.key} style={{ width: width >= 680 && !['media', 'colors', 'icon'].includes(f.kind) ? '50%' : '100%', padding: 6, minWidth: 0 }}>
      <View className="bg-surface rounded-xl border border-line p-3" style={{ minWidth: 0 }}><Field f={f} ctx={ctx} value={value?.[f.key]} error={errors[f.key]} onChange={(v) => onChange(f.key, v)} /></View>
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
  const submit = async () => {
    if (pasted && (!lines.length || lines.length > 50)) { setPasteError(t('improve.pasteError')); return false; }
    const active = mode === 'edit' ? fields.filter((f) => keys.includes(f.key)) : fields;
    const values = pasted ? pasteDrafts.map((draft, i) => ({ ...shared, id: draft.id, [titleField!.key]: titleField!.kind === 'ltext' ? { dar: lines[i], ar: lines[i], fr: lines[i] } : lines[i] })) : drafts;
    const nextErrors = values.map((v) => validate(active, v, t));
    setErrors(nextErrors);
    if (nextErrors.some((e) => Object.keys(e).length)) return false;
    setBusy(true);
    try { await onSubmit(values.map((v) => normalize(active, v)), keys); return true; }
    catch { toast(t('improve.saveError')); return false; } finally { setBusy(false); }
  };
  const snapshot = JSON.stringify({ text, shared, drafts, keys });
  const [original] = useState(snapshot);
  useLeaveGuard(!!mode && snapshot !== original, submit, onClose);
  const close = () => { if (!busy) requestLeave(onClose); };
  return <Sheet visible={!!mode} title={title} wide={mode === 'add'} onClose={close} footer={<View className="flex-row gap-3"><Button title={t('common.cancel')} variant="soft" onPress={close} disabled={busy} className="flex-1" /><Button testID="batch-save" title={pasted ? t('improve.createCount', { count: lines.length }) : t('common.save')} onPress={submit} loading={busy} disabled={mode === 'edit' && !keys.length || pasted && (!lines.length || lines.length > 50)} className="flex-1" /></View>}>
    {mode === 'edit' ? <>
      <Txt className="text-muted text-[13px] leading-[21px] mb-3">{t('improve.batchHelp')}</Txt>
      {fields.filter((f) => !f.show || f.show(drafts[0] ?? {})).map((f) => <View key={f.key} className="rounded-xl border border-line p-3 mb-3 bg-surface">
        <View className="flex-row items-center gap-3 mb-2"><Toggle label={f.label} testID={`batch-field-${f.key}`} value={keys.includes(f.key)} onValueChange={(on) => setKeys((old) => on ? [...old, f.key] : old.filter((key) => key !== f.key))} /><Txt className="flex-1 font-bold text-[14px]">{f.label}</Txt></View>
        <View pointerEvents={keys.includes(f.key) ? 'auto' : 'none'} style={{ opacity: keys.includes(f.key) ? 1 : 0.4 }}><Field f={f} value={drafts[0]?.[f.key]} error={errors[0]?.[f.key]} ctx={ctx} onChange={(v) => setDrafts(([old]) => [{ ...old, [f.key]: v }])} /></View>
      </View>)}
    </> : <>
      {titleField ? <View className="flex-row flex-wrap gap-2 mb-4"><Button size="sm" icon="text-box-outline" variant={pasteMode ? 'primary' : 'soft'} title={t('improve.pasteMode')} onPress={() => { setPasteMode(true); setErrors([]); }} /><Button testID="batch-individual" size="sm" icon="form-select" variant={!pasteMode ? 'primary' : 'soft'} title={t('improve.individual')} onPress={() => { setPasteMode(false); setErrors([]); }} /></View> : null}
      {pasteMode && titleField ? <>
        <Txt className="text-muted text-[13px] leading-[21px] mb-3">{t('improve.pasteHelp')}</Txt>
        <Input testID="batch-titles" label={t('improve.pasteTitles')} multiline value={text} error={pasteError} placeholder="Salon\nCuisine\nChambre" style={{ minHeight: 120, maxHeight: 200, textAlignVertical: 'top' }} onChangeText={(value) => {
          setText(value);
          const count = value.split(/\r?\n/).map((line) => line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '')).filter(Boolean).length;
          setPasteError(count > 50 ? t('improve.pasteError') : '');
          setPasteDrafts((old) => Array.from({ length: Math.min(count, 50) }, (_, i) => old[i] ?? blank()));
        }} />
        <Txt className="font-bold text-[16px] mb-3">{t('improve.sharedSettings')}</Txt>
        <FormFields fields={sharedFields} value={shared} errors={errors[0] ?? {}} ctx={ctx} onChange={(key, value) => setShared((old: any) => ({ ...old, [key]: value }))} />
      </> : <>
        {drafts.map((v, i) => <View key={v.id} className="mb-5">
          <View className="flex-row items-center justify-between mb-2"><Txt className="font-bold text-[17px]">{t('admin.crud.addNew')} · {i + 1}</Txt>{drafts.length > 1 ? <Button size="sm" variant="soft" icon="close" title={t('improve.removeDraft')} disabled={busy} onPress={() => setDrafts((old) => old.filter((_, index) => i !== index))} /> : null}</View>
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
