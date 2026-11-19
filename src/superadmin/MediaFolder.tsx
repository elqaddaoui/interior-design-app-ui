import React, { useState } from 'react';
import { View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { ConsolidateResult, Consolidation, ConsolidationAction } from '@/superadmin/types';
import { Badge, Btn, Card, ErrorLine, Hint, Notice, Row, T, ago } from '@/superadmin/ui';

const size = (bytes: number | null | undefined) => {
  const n = Number(bytes || 0);
  return n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
};
const where = (storage: string) => (storage === 'r2' ? tr('Cloudflare R2') : storage === 'db' ? tr('Database') : tr('App folder (self-hosted)'));
const ACTION: Record<ConsolidationAction, { label: () => string; tone: 'ok' | 'muted' | 'danger' }> = {
  move: { label: () => tr('Will move'), tone: 'ok' },
  merge: { label: () => tr('Already in media/'), tone: 'muted' },
  conflict: { label: () => tr('Different file, left alone'), tone: 'danger' },
};

/**
 * "One media folder": every picture lives in `media/` (its name is its hash, shared by every store). This panel previews what still sits outside it
 * (old `t/<store>/media/` folders), moves it in with a verified copy, and removes the old copies and their empty folders once they are proven identical.
 * Previewing changes nothing.
 */
export function MediaFolder({ oldCopies, onChanged }: { oldCopies: number; onChanged: () => void }) {
  const [plan, setPlan] = useState<Consolidation | null>(null);
  const [result, setResult] = useState<ConsolidateResult | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>(null);

  const preview = async () => {
    setBusy('preview'); setError(null);
    try { setPlan(await sa<Consolidation>('/media/consolidation')); } catch (e) { setError(saMessage(e)); } finally { setBusy(''); }
  };
  const move = async () => {
    setBusy('move'); setError(null); setNote(''); setResult(null);
    try {
      let total: ConsolidateResult | null = null;
      for (let round = 0; round < 200; round++) {
        const r: ConsolidateResult = await sa<ConsolidateResult>('/media/consolidate', { method: 'POST', body: { history: total?.history || '' } });
        total = total ? { ...r, history: r.history || total.history, moved: total.moved + r.moved, merged: total.merged + r.merged, waiting: total.waiting + r.waiting, bytes: total.bytes + r.bytes, rowsFixed: total.rowsFixed + r.rowsFixed, failed: total.failed + r.failed, conflicts: total.conflicts + r.conflicts, dbMoved: total.dbMoved + r.dbMoved, dbFailed: total.dbFailed + r.dbFailed } : r;
        if (!r.partial) break;
      }
      setResult(total);
      setPlan(await sa<Consolidation>('/media/consolidation'));
      onChanged();
    } catch (e) { setError(saMessage(e)); } finally { setBusy(''); }
  };
  const removeOld = async () => {
    setBusy('remove'); setError(null); setNote('');
    try {
      const r = await sa<{ removed: number; bytes: number }>('/media/cleanup', { method: 'POST', body: { now: true } });
      setNote(tr('Removed {n} old copies ({size}).', { n: r.removed, size: size(r.bytes) }));
      setPlan(await sa<Consolidation>('/media/consolidation'));
      onChanged();
    } catch (e) { setError(saMessage(e)); } finally { setBusy(''); }
  };

  const unreadable = plan ? (['r2', 'fs'] as const).filter(k => plan.storages[k].available && !plan.storages[k].checked) : [];
  const movable = plan ? plan.totals.move + plan.totals.merge : 0;

  return (
    <Card>
      <View testID="sa-media-folder">
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flexShrink: 1, flexBasis: 280 }}>
            <T weight="bold">{tr('One media folder')}</T>
            <T size="sm" color={SA.color.muted}>{tr('Every picture belongs in media/. Preview lists the pictures that sit anywhere else and the old folders to remove. Previewing changes nothing.')}</T>
          </View>
          <Btn small testID="sa-media-folder-preview" label={plan ? tr('Preview again') : tr('Preview')} onPress={preview} busy={busy === 'preview'} disabled={busy !== ''} />
        </Row>
        <ErrorLine error={error} />
        {note ? <Notice tone="ok">{note}</Notice> : null}
        {result ? (
          <Notice tone={result.failed || result.conflicts || result.unreadable.length ? 'warn' : 'ok'} testID="sa-media-folder-done">
            {tr('Moved {moved} files into media/ ({size}), {merged} were already there. {failed} could not be moved and {conflicts} were left alone because media/ holds a different file under the same name. The old copies wait 24 hours, or remove them now below.', { moved: result.moved, size: size(result.bytes), merged: result.merged, failed: result.failed, conflicts: result.conflicts })}
            {result.history ? ` ${tr('A restore point was saved first: see Transfer history to put everything back.')}` : ''}
          </Notice>
        ) : null}
        {plan ? (
          <View style={{ marginTop: SA.space.md }}>
            {unreadable.map(k => (
              <Notice key={k} tone="warn">{tr('{storage} could not be read completely, so nothing was concluded about it ({reason}). No file is treated as missing.', { storage: where(k), reason: plan.storages[k].error || '?' })}</Notice>
            ))}
            {plan.clean ? <Notice tone="ok" testID="sa-media-folder-clean">{tr('Everything is in media/: no file sits outside it, and every file the database lists is in storage.')}</Notice> : null}
            <Row style={{ marginBottom: SA.space.sm }}>
              {(['r2', 'fs'] as const).filter(k => plan.storages[k].available).map(k => (
                <Badge key={k} tone="muted" label={tr('{storage}: {n} files in media/ · {outside} outside', { storage: where(k), n: plan.storages[k].media.files, outside: plan.storages[k].outside })} />
              ))}
              {plan.rows.missing ? <Badge tone="danger" label={tr('{n} files the database lists are missing in storage', { n: plan.rows.missing })} /> : <Badge tone="ok" label={tr('{n} database entries checked, none missing', { n: plan.rows.checked })} />}
            </Row>

            {plan.database.files ? (
              <T size="sm" color={SA.color.muted} testID="sa-media-folder-db" style={{ marginBottom: SA.space.sm }}>{tr('{n} files ({size}) are stored inside the database and will be moved into media/ too.', { n: plan.database.files, size: size(plan.database.bytes) })}</T>
            ) : null}

            {plan.folders.length ? (
              <View testID="sa-media-folder-folders" style={{ marginBottom: SA.space.sm }}>
                <T size="xs" weight="bold" color={SA.color.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{tr('Folders to remove')}</T>
                {plan.folders.map(f => (
                  <Row key={`${f.storage}|${f.path}`} style={{ justifyContent: 'space-between', flexWrap: 'nowrap', paddingVertical: 4 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T selectable numberOfLines={1}>{f.path}</T>
                      <T size="xs" color={SA.color.muted} numberOfLines={1}>{`${where(f.storage)} · ${f.store}`}</T>
                    </View>
                    <T size="sm" color={SA.color.muted}>{tr('{n} files · {size}', { n: f.files, size: size(f.bytes) })}</T>
                  </Row>
                ))}
              </View>
            ) : null}

            {plan.files.length ? (
              <View testID="sa-media-folder-files" style={{ marginBottom: SA.space.sm }}>
                <T size="xs" weight="bold" color={SA.color.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{tr('Files outside media/')}</T>
                <View style={{ borderWidth: 1, borderColor: SA.color.line, borderRadius: SA.radius.sm, maxHeight: 280, overflow: 'scroll' as any }}>
                  {plan.files.map((f, i) => (
                    <View key={`${f.storage}|${f.from}`} testID="sa-media-folder-file" style={{ padding: SA.space.sm, borderTopWidth: i ? 1 : 0, borderColor: SA.color.line }}>
                      <T size="xs" selectable numberOfLines={1}>{f.storage === 'db' ? `${tr('Database')} · ${f.from}` : f.from}</T>
                      <Row style={{ flexWrap: 'nowrap', gap: 4 }}>
                        <T size="xs" color={SA.color.muted}>→</T>
                        <T size="xs" selectable numberOfLines={1} style={{ flex: 1 }}>{f.to}</T>
                        <T size="xs" color={SA.color.muted}>{size(f.size)}</T>
                        <Badge label={ACTION[f.action].label()} tone={ACTION[f.action].tone} />
                      </Row>
                    </View>
                  ))}
                </View>
                {plan.totals.files > plan.files.length ? <T size="xs" color={SA.color.muted} style={{ marginTop: 4 }}>{tr('Showing the first {n} of {total} files.', { n: plan.files.length, total: plan.totals.files })}</T> : null}
              </View>
            ) : null}

            {plan.totals.files ? <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.sm }}>{tr('{n} files ({size}) sit outside media/: {move} to move, {merge} already in media/, {conflict} with a different file at the same name.', { n: plan.totals.files, size: size(plan.totals.bytes), move: plan.totals.move, merge: plan.totals.merge, conflict: plan.totals.conflict })}</T> : null}
            <T size="xs" color={SA.color.muted}>{tr('Checked {when}', { when: ago(plan.at) })}</T>
          </View>
        ) : null}

        {plan && movable ? (
          <View style={{ marginTop: SA.space.md }}>
            <Btn testID="sa-media-folder-go" label={tr('Move {n} files into media/', { n: movable })} onPress={move} busy={busy === 'move'} disabled={busy !== '' || unreadable.length > 0} />
            <Hint>{tr('A restore point is saved first. Each file is copied, checked byte for byte, and only then does its database entry point to media/. Nothing is deleted by this step; the pictures keep loading all along.')}</Hint>
          </View>
        ) : null}
        {oldCopies > 0 ? (
          <View style={{ marginTop: SA.space.md }}>
            <Btn small kind="ghost" testID="sa-media-folder-remove" label={tr('Remove old copies and folders now')} onPress={removeOld} busy={busy === 'remove'} disabled={busy !== ''} />
            <Hint>{tr('Every old copy is compared with the file in media/ first and kept if they differ. Empty old folders disappear with their last file.')}</Hint>
          </View>
        ) : null}
      </View>
    </Card>
  );
}
