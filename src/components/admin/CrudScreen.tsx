import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmSheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Txt } from '@/components/ui/Txt';
import { CrudTable } from './CrudTable';
import { BatchFormModal, FormModal, validate } from './FormModal';
import { AdminPage } from './AdminShell';
import { HomeTabsOption } from './HomeTabsOption';
import { AiEnginePanel } from './AiEnginePanel';
import { ENTITIES } from '@/admin/entities';
import { nextOrder, sorted, uid, useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { CollName } from '@/data/types';
import { useCollectionDraft } from '@/hooks/useDraftDoc';
import { useViewState } from '@/hooks/useViewState';
import { toast } from '@/store/useToast';
import { PartialSaveError, revealAdded } from '@/hooks/useReveal';
import { mergeStates, LANG_ORDER } from '@/lib/langStatus';

/** The one generic CRUD screen: every admin entity is described by a config in `admin/entities.tsx`. */
export function CrudScreen({ entity }: { entity: string }) {
  const cfg = ENTITIES[entity];
  const staged = useCollectionDraft(cfg?.name ?? 'tools');
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const { target } = useLocalSearchParams<{ target?: string }>();
  const [query, setQuery] = useViewState('query', '');
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [selected, setSelected] = useViewState<string[]>('selected', []);
  const [preview, setPreview] = useState<any>(null);
  const previewDraft = useCallback((v: any) => setPreview(v), []);
  const [quickKeys, setQuickKeys] = useState<string[]>([]);
  const [batch, setBatch] = useState<'add' | 'edit' | null>(null);
  const [bulkDelete, setBulkDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const bulkEnabled = s.doc.settings.bulkPanels?.includes(entity) ?? false;
  const [del, setDel] = useState<any | null>(null);
  /** Rows stored by earlier attempts of the same bulk dialog (a retry skips them but they still belong to the group). */
  const stored = useRef<string[]>([]);
  const ctx = { s, L, t };
  const list = cfg ? s[cfg.name as CollName] : undefined;
  const rows = useMemo(() => (cfg?.ordered ? sorted((list ?? []) as any[]) : list ?? []), [cfg, list]);
  const [onlyTodo, setOnlyTodo] = useViewState('only-untranslated', false);
  /** Translation state of a row = the worst state of each language over all its multilingual fields. */
  const langsOf = (r: any) => {
    const keys = cfg ? cfg.fields(ctx).filter((f) => f.kind === 'ltext' && (!f.show || f.show(r))).map((f) => f.key) : [];
    return keys.length ? mergeStates(keys.map((key) => r[key])) : null;
  };
  const todo = (r: any) => { const st = langsOf(r); return !!st && LANG_ORDER.some((l) => st[l] !== 'complete'); };
  const hasLangs = !!cfg && cfg.fields(ctx).some((f) => f.kind === 'ltext');
  const todoCount = hasLangs ? rows.filter(todo).length : 0;
  const filtered = rows.filter((r) => r.id === target || (!onlyTodo || todo(r)) && (!query.trim() || JSON.stringify(r).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  // While the form is open the list previews the draft: in place for an edit, at the end for a new item. Once the saved row is in the list it replaces the preview.
  const shown = editing && preview
    ? isNew ? (filtered.some((r) => r.id === preview.id) ? filtered.map((r) => r.id === preview.id ? preview : r) : [...filtered, preview]) : filtered.map((r) => r.id === preview.id ? preview : r)
    : filtered;
  if (!cfg) return null;

  const open = (r?: any) => { setPreview(null); setIsNew(!r); // A new item gets its id up front: the live preview row and the saved row are then the same row (never a duplicate), and retrying a save that timed out can only overwrite, not add a second copy.
    setEditing(r ?? { ...cfg.blank(ctx), id: uid(cfg.name.slice(0, 3)) }); };
  const submit = async (v: any) => {
    if (!await staged.save()) throw new Error('Could not save draft');
    if (cfg.name === 'models' && v.isDefault) {
      await Promise.all(s.models.filter((m) => m.isDefault && m.id !== v.id).map((m) => s.update('models', m.id, { isDefault: false })));
    }
    let added: string | undefined;
    if (isNew) added = (await s.create(cfg.name, v)).id; else await s.update(cfg.name, v.id, v);
    setEditing(null);
    toast(t('admin.crud.saved'));
    if (added) showAdded([added]);
  };
  /** The saved rows must be on screen to be revealed: drop a search that would hide them, then scroll to and highlight them. */
  const showAdded = (ids: string[]) => {
    const fresh = (useStore.getState()[cfg.name as CollName] as any[]).filter((r) => ids.includes(r.id));
    const q = query.trim().toLocaleLowerCase();
    if (q && fresh.some((r) => !JSON.stringify(r).toLocaleLowerCase().includes(q))) setQuery('');
    revealAdded(ids);
  };
  const closeBatch = () => { setBatch(null); if (stored.current.length) showAdded(stored.current); stored.current = []; };
  const removeRows = async (name: CollName, ids: string[]) => {
    for (const [child, fk] of ENTITIES[name]?.cascade ?? []) {
      const childIds = (useStore.getState()[child] as any[]).filter((x) => ids.includes(x[fk])).map((x) => x.id);
      if (childIds.length) await removeRows(child, childIds);
    }
    await s.removeMany(name, ids);
    if (name === cfg.name) staged.forget(ids);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); toast(t('admin.crud.saved')); } catch { toast(t('improve.saveError')); } finally { setBusy(false); }
  };
  const submitBatch = async (values: any[], keys: string[]) => {
    if (!bulkEnabled) return;
    if (!await staged.save()) throw new Error('Could not save draft');
    if (batch === 'add') {
      if (cfg.name === 'models' && values.filter((v) => v.isDefault).length > 1) throw new Error('Only one default model is allowed');
      let failed = 0;
      for (const v of values) {
        // Stable draft IDs make retries safe after partial storage failures.
        try {
          if (!(useStore.getState()[cfg.name as CollName] as any[]).some((row) => row.id === v.id)) {
            if (cfg.name === 'models' && v.isDefault) for (const m of useStore.getState().models.filter((m) => m.isDefault)) await s.update('models', m.id, { isDefault: false });
            await s.create(cfg.name, { ...v, order: nextOrder(useStore.getState()[cfg.name as CollName] as any[]) });
          }
          if (!stored.current.includes(v.id)) stored.current.push(v.id);
        } catch { failed++; }
      }
      // Some rows are stored, some are not: say exactly that, keep the dialog open so a retry only sends the missing ones.
      if (failed) throw new PartialSaveError(t('improve.partialSaved', { saved: values.length - failed, total: values.length }), stored.current);
    } else {
      const patch = Object.fromEntries(keys.map((key) => [key, values[0][key]]));
      // A model collection can have only one default, never multiple defaults.
      if (cfg.name === 'models' && patch.isDefault && selected.length > 1) throw new Error('Only one default model is allowed');
      const targets = rows.filter((r) => selected.includes(r.id));
      if (targets.some((r) => Object.keys(validate(cfg.fields(ctx), { ...r, ...patch }, t)).length)) throw new Error('Invalid update');
      if (cfg.name === 'models' && patch.isDefault) for (const m of s.models.filter((m) => m.isDefault && !selected.includes(m.id))) await s.update('models', m.id, { isDefault: false });
      for (const r of targets) await s.update(cfg.name, r.id, patch);
    }
    const added = batch === 'add' ? [...stored.current] : [];
    stored.current = [];
    setBatch(null); setSelected([]); toast(t('admin.crud.saved'));
    if (added.length) showAdded(added);
  };

  return (
    <AdminPage title={t(`admin.nav.${cfg.navKey}`)} right={<View className="flex-row items-center gap-2"><Button testID="crud-add" icon="plus" size="sm" title={t('common.add')} onPress={() => open()} />{bulkEnabled ? <Pressable testID="crud-batch-add" accessibilityRole="button" accessibilityLabel={t('improve.addMultiple')} onPress={() => setBatch('add')} className="w-10 h-10 rounded-full border border-line bg-surface2 items-center justify-center"><Icon name="playlist-plus" size={23} /></Pressable> : null}</View>}
      floating={bulkEnabled && selected.length ? <Card testID="bulk-panel" className="p-3 rounded-3xl" style={{ boxShadow: '0 8px 36px rgba(0,0,0,0.2)' } as any}>
        <View className="flex-row items-center gap-2 mb-2"><View className="bg-primary rounded-full px-3 py-1"><Txt className="text-onprimary font-bold">{selected.length}</Txt></View><Txt className="font-bold flex-1">{t('improve.selectedShort')}</Txt><Button testID="bulk-done" size="sm" variant="ghost" icon="close" title={t('common.done')} disabled={busy} onPress={() => setSelected([])} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
          <Button size="sm" icon="select-all" variant="ghost" title={t('common.all')} disabled={busy} onPress={() => setSelected(rows.map((r) => r.id))} />
          <Button testID="crud-batch-edit" size="sm" icon="pencil-outline" variant="ghost" title={t('common.edit')} disabled={busy} onPress={() => { setQuickKeys([]); setBatch('edit'); }} />
          <Button testID="crud-batch-visibility" size="sm" icon="eye-outline" variant="ghost" title={t('improve.visibilityShort')} disabled={busy} onPress={() => { setQuickKeys(['visible']); setBatch('edit'); }} />
          <Button testID="crud-batch-delete" size="sm" icon="trash-can-outline" variant="ghost" title={t('common.delete')} disabled={busy} onPress={() => setBulkDelete(true)} />
        </ScrollView>
      </Card> : undefined}>
      <View className="flex-row items-center gap-3 mb-2"><View className="flex-1"><Input testID="crud-filter" placeholder={t('admin.dash.searchPh')} value={query} onChangeText={setQuery} /></View>{hasLangs && (todoCount > 0 || onlyTodo) ? <Pressable testID="crud-untranslated" accessibilityRole="button" accessibilityState={{ selected: onlyTodo }} accessibilityLabel={t('improve.langFilter')} onPress={() => setOnlyTodo(!onlyTodo)} className={`flex-row items-center gap-1.5 rounded-full px-3 h-9 border ${onlyTodo ? 'bg-primary border-primary' : 'bg-surface border-line'}`}><Icon name="translate" size={15} tone={onlyTodo ? 'onprimary' : 'muted'} /><Txt className={`text-[12.5px] font-bold ${onlyTodo ? 'text-onprimary' : ''}`}>{t('improve.langFilterShort', { count: todoCount })}</Txt></Pressable> : null}<Txt className="text-muted text-[12px]">{filtered.length} / {rows.length}</Txt></View>
      {entity === 'tabs' ? <HomeTabsOption /> : null}
      {entity === 'models' ? <AiEnginePanel /> : null}
      <CrudTable langs={hasLangs ? langsOf : undefined} visual={!!cfg.visual} onLongPress={bulkEnabled ? (id) => { if (!busy) setSelected((old) => old.includes(id) ? old : [...old, id]); } : undefined} selected={selected} onSelect={bulkEnabled ? (id) => { if (!busy) setSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]); } : undefined} rows={shown} view={cfg.view(ctx)} rowTestID="row"
        onEdit={open} onDelete={setDel}
        onReorder={cfg.ordered && bulkEnabled && !query.trim() ? staged.drop : undefined}
        onMove={cfg.ordered && bulkEnabled && !query.trim() ? (r, d) => staged.move([r.id], d) : undefined}
        onToggle={(r) => staged.update(r.id, { visible: r.visible === false } as any)} />
      {staged.dirty ? <Card className="p-2 mt-3 flex-row items-center gap-2"><Txt className="flex-1 text-[12px]">{t('improve.previewLabel')}</Txt><Button testID="crud-discard" size="sm" variant="soft" title={t('improve.discard')} onPress={staged.discard} /><Button testID="crud-submit" size="sm" title={t('improve.submit')} onPress={staged.save} /></Card> : null}
      <View className="h-3" />
      <FormModal visible={!!editing} title={`${isNew ? t('admin.crud.addNew') : t('admin.crud.editItem')} · ${t(`admin.nav.${cfg.navKey}`)}`}
        fields={cfg.fields(ctx)} initial={editing} onDraftChange={previewDraft} onClose={() => setEditing(null)} onSubmit={submit} />
      <BatchFormModal initialKeys={quickKeys} mode={batch} title={batch === 'edit' ? t('improve.editCount', { count: selected.length }) : t('improve.addMultiple')} fields={cfg.fields(ctx)} initial={rows.find((r) => selected.includes(r.id))} blank={() => ({ ...cfg.blank({ ...ctx, s: useStore.getState() }), id: uid(cfg.name) })} onClose={closeBatch} onSubmit={submitBatch} />
      <ConfirmSheet visible={bulkDelete} onClose={() => setBulkDelete(false)} message={t('improve.deleteCount', { count: selected.length })} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => run(async () => { if (bulkEnabled) { await removeRows(cfg.name, selected); setSelected([]); } })} />
      <ConfirmSheet visible={!!del} onClose={() => setDel(null)} message={t('admin.crud.confirmDelete')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del && run(() => removeRows(cfg.name, [del.id]))} />
    </AdminPage>
  );
}
