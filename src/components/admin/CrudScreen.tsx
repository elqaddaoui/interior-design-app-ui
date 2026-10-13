import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Card, ConfirmSheet, Icon, Input, Txt } from '@/components/ui';
import { CrudTable } from './CrudTable';
import { BatchFormModal, FormModal, validate } from './FormModal';
import { AdminPage } from './AdminShell';
import { HomeTabsOption } from './HomeTabsOption';
import { ENTITIES } from '@/admin/entities';
import { nextOrder, sorted, uid, useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { CollName } from '@/data/types';
import { useCollectionDraft } from '@/hooks/useDraftDoc';
import { useViewState } from '@/hooks/useViewState';
import { toast } from '@/store/useToast';

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
  const ctx = { s, L, t };
  const list = cfg ? s[cfg.name as CollName] : undefined;
  const rows = useMemo(() => (cfg?.ordered ? sorted((list ?? []) as any[]) : list ?? []), [cfg, list]);
  const filtered = rows.filter((r) => r.id === target || !query.trim() || JSON.stringify(r).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  if (!cfg) return null;

  const open = (r?: any) => { setPreview(null); setIsNew(!r); setEditing(r ?? { ...cfg.blank(ctx) }); };
  const submit = async (v: any) => {
    if (!await staged.save()) throw new Error('Could not save draft');
    if (cfg.name === 'models' && v.isDefault) {
      await Promise.all(s.models.filter((m) => m.isDefault && m.id !== v.id).map((m) => s.update('models', m.id, { isDefault: false })));
    }
    if (isNew) await s.create(cfg.name, v); else await s.update(cfg.name, v.id, v);
    setEditing(null);
    toast(t('admin.crud.saved'));
  };
  const removeRows = async (name: CollName, ids: string[]) => {
    for (const [child, fk] of ENTITIES[name]?.cascade ?? []) {
      const childIds = (useStore.getState()[child] as any[]).filter((x) => ids.includes(x[fk])).map((x) => x.id);
      if (childIds.length) await removeRows(child, childIds);
    }
    await s.removeMany(name, ids);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); toast(t('admin.crud.saved')); } catch { toast(t('improve.saveError')); } finally { setBusy(false); }
  };
  const submitBatch = async (values: any[], keys: string[]) => {
    if (!bulkEnabled) return;
    if (batch === 'add') {
      if (cfg.name === 'models' && values.filter((v) => v.isDefault).length > 1) throw new Error('Only one default model is allowed');
      for (const v of values) {
        // Stable draft IDs make retries safe after partial storage failures.
        if (!(useStore.getState()[cfg.name as CollName] as any[]).some((row) => row.id === v.id)) {
          if (cfg.name === 'models' && v.isDefault) for (const m of useStore.getState().models.filter((m) => m.isDefault)) await s.update('models', m.id, { isDefault: false });
          await s.create(cfg.name, { ...v, order: nextOrder(useStore.getState()[cfg.name as CollName] as any[]) });
        }
      }
    } else {
      const patch = Object.fromEntries(keys.map((key) => [key, values[0][key]]));
      // A model collection can have only one default, never multiple defaults.
      if (cfg.name === 'models' && patch.isDefault && selected.length > 1) throw new Error('Only one default model is allowed');
      const targets = rows.filter((r) => selected.includes(r.id));
      if (targets.some((r) => Object.keys(validate(cfg.fields(ctx), { ...r, ...patch }, t)).length)) throw new Error('Invalid update');
      if (cfg.name === 'models' && patch.isDefault) for (const m of s.models.filter((m) => m.isDefault && !selected.includes(m.id))) await s.update('models', m.id, { isDefault: false });
      for (const r of targets) await s.update(cfg.name, r.id, patch);
    }
    setBatch(null); setSelected([]); toast(t('admin.crud.saved'));
  };

  return (
    <AdminPage title={t(`admin.nav.${cfg.navKey}`)} right={<View className="flex-row items-center gap-2"><Button testID="crud-add" icon="plus" size="sm" title={t('common.add')} onPress={() => open()} />{bulkEnabled ? <Pressable testID="crud-batch-add" accessibilityRole="button" accessibilityLabel={t('improve.addMultiple')} onPress={() => setBatch('add')} className="w-10 h-10 rounded-full border border-line bg-surface2 items-center justify-center"><Icon name="playlist-plus" size={23} /></Pressable> : null}</View>}
      floating={bulkEnabled && selected.length ? <Card testID="bulk-panel" className="p-3 rounded-3xl" style={{ boxShadow: '0 8px 36px rgba(0,0,0,0.2)' } as any}>
        <View className="flex-row items-center gap-2 mb-2"><View className="bg-primary rounded-full px-3 py-1"><Txt className="text-onprimary font-bold">{selected.length}</Txt></View><Txt className="font-bold flex-1">{t('improve.selectedShort')}</Txt><Button testID="bulk-done" size="sm" variant="ghost" icon="close" title={t('common.done')} disabled={busy} onPress={() => setSelected([])} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
          <Button size="sm" icon="select-all" variant="ghost" title={t('common.all')} disabled={busy} onPress={() => setSelected(rows.map((r) => r.id))} />
          <Button testID="crud-batch-edit" size="sm" icon="pencil-outline" variant="ghost" title={t('common.edit')} disabled={busy} onPress={() => { setQuickKeys([]); setBatch('edit'); }} />
          <Button testID="crud-batch-visibility" size="sm" icon="eye-outline" variant="ghost" title={t('improve.visibilityShort')} disabled={busy} onPress={() => { setQuickKeys(['visible']); setBatch('edit'); }} />
          {cfg.ordered ? ([-1, 1] as const).map((d) => <Button key={d} testID={`crud-batch-move-${d}`} size="sm" icon={d === -1 ? 'arrow-up' : 'arrow-down'} variant="ghost" title={t(d === -1 ? 'improve.upShort' : 'improve.downShort')} disabled={busy} onPress={() => run(() => Promise.resolve(staged.move(selected, d)))} />) : null}
          <Button testID="crud-batch-delete" size="sm" icon="trash-can-outline" variant="ghost" title={t('common.delete')} disabled={busy} onPress={() => setBulkDelete(true)} />
        </ScrollView>
      </Card> : undefined}>
      <View className="flex-row items-center gap-3 mb-2"><View className="flex-1"><Input testID="crud-filter" placeholder={t('admin.dash.searchPh')} value={query} onChangeText={setQuery} /></View><Txt className="text-muted text-[12px]">{filtered.length} / {rows.length}</Txt></View>
      {entity === 'tabs' ? <HomeTabsOption /> : null}
      <CrudTable visual={['categories', 'inspirations', 'styles'].includes(entity)} onLongPress={bulkEnabled ? (id) => { if (!busy) setSelected((old) => old.includes(id) ? old : [...old, id]); } : undefined} selected={selected} onSelect={bulkEnabled ? (id) => { if (!busy) setSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]); } : undefined} rows={editing && preview ? isNew ? [...filtered, preview] : filtered.map((r) => r.id === preview.id ? preview : r) : filtered} cols={cfg.cols(ctx)} rowTestID="row"
        onEdit={open} onDelete={setDel}
        onMove={cfg.ordered && bulkEnabled ? (r, d) => staged.move([r.id], d) : undefined}
        onToggle={(r) => staged.update(r.id, { visible: r.visible === false } as any)} />
      {staged.dirty ? <Card className="p-2 mt-3 flex-row items-center gap-2"><Txt className="flex-1 text-[12px]">Unsaved changes · Live preview</Txt><Button testID="crud-discard" size="sm" variant="soft" title="Discard" onPress={staged.discard} /><Button testID="crud-submit" size="sm" title="Submit" onPress={staged.save} /></Card> : null}
      <View className="h-3" />
      <FormModal visible={!!editing} title={`${isNew ? t('admin.crud.addNew') : t('admin.crud.editItem')} · ${t(`admin.nav.${cfg.navKey}`)}`}
        fields={cfg.fields(ctx)} initial={editing} onDraftChange={previewDraft} onClose={() => setEditing(null)} onSubmit={submit} />
      <BatchFormModal initialKeys={quickKeys} mode={batch} title={batch === 'edit' ? t('improve.editCount', { count: selected.length }) : t('improve.addMultiple')} fields={cfg.fields(ctx)} initial={rows.find((r) => selected.includes(r.id))} blank={() => ({ ...cfg.blank({ ...ctx, s: useStore.getState() }), id: uid(cfg.name) })} onClose={() => setBatch(null)} onSubmit={submitBatch} />
      <ConfirmSheet visible={bulkDelete} onClose={() => setBulkDelete(false)} message={t('improve.deleteCount', { count: selected.length })} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => run(async () => { if (bulkEnabled) { await removeRows(cfg.name, selected); setSelected([]); } })} />
      <ConfirmSheet visible={!!del} onClose={() => setDel(null)} message={t('admin.crud.confirmDelete')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del && run(() => removeRows(cfg.name, [del.id]))} />
    </AdminPage>
  );
}
