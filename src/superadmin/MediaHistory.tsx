import React, { useState } from 'react';
import { View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { MediaHistoryEntry, MediaRestoreResult } from '@/superadmin/types';
import type { IconName } from '@/superadmin/icons';
import { IconBox, size, type Tone } from '@/superadmin/MediaBits';
import { Badge, Btn, Empty, ErrorLine, Hint, Loading, Notice, Row, T, ago, useLoad } from '@/superadmin/ui';

const OP_ICON: Record<MediaHistoryEntry['op'], { icon: IconName; tone: Tone }> = {
  consolidate: { icon: 'folderOutline', tone: 'accent' }, move: { icon: 'cloudOutline', tone: 'accent' }, restore: { icon: 'restore', tone: 'ok' }, cleanup: { icon: 'deleteOutline', tone: 'warn' },
};
const opLabel = (op: MediaHistoryEntry['op']) => (op === 'consolidate' ? tr('One media folder') : op === 'move' ? tr('Move all media') : op === 'restore' ? tr('Restore') : tr('Cleanup'));

/**
 * Transfer history: before every transfer the server saves a restore point (where every file was). Restoring puts every file back where the
 * restore point says, with a verified copy, and saves its own restore point first, so a restore can be undone too.
 */
export function MediaHistory({ onChanged }: { onChanged: () => void }) {
  const { data, error, loading, reload } = useLoad(() => sa<MediaHistoryEntry[]>('/media/history'));
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const restore = async (id: string) => {
    setBusy(id); setProblem(null); setNote(null);
    try {
      let cursor: [string, string] = ['', ''];
      let backup = '';
      const sum = { restored: 0, conflicts: 0, failed: 0, bytes: 0 };
      for (let round = 0; round < 500; round++) {
        const r: MediaRestoreResult = await sa<MediaRestoreResult>(`/media/history/${id}/restore`, { method: 'POST', body: { cursor, backup } });
        sum.restored += r.restored; sum.conflicts += r.conflicts; sum.failed += r.failed; sum.bytes += r.bytes;
        cursor = r.cursor; backup = r.backup || backup;
        if (r.done || !r.partial) break;
      }
      setNote({
        tone: sum.failed || sum.conflicts ? 'warn' : 'ok',
        text: tr('Restored {n} files ({size}). {failed} could not be restored and {conflicts} were left alone because a different file is in the way. A new restore point was saved first, so this restore can be undone.', { n: sum.restored, size: size(sum.bytes), failed: sum.failed, conflicts: sum.conflicts }),
      });
      setConfirm('');
      reload(); onChanged();
    } catch (e) { setProblem(saMessage(e)); } finally { setBusy(''); }
  };

  return (
    <View testID="sa-media-history">
      <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap', marginBottom: SA.space.md }}>
        <T size="sm" color={SA.color.muted} style={{ flex: 1 }}>{tr('Before every transfer the previous state of the hosting is saved here. Restore puts the files back where they were.')}</T>
        <Btn small kind="ghost" icon="refresh" label={tr('Refresh')} onPress={reload} disabled={busy !== ''} />
      </Row>
      <ErrorLine error={error || problem} />
      {note ? <Notice tone={note.tone} testID="sa-media-history-done">{note.text}</Notice> : null}
      {loading && !data ? <Loading /> : null}
      {data && !data.length ? <Empty>{tr('No transfer yet. A restore point appears here before the first one.')}</Empty> : null}
      {data && data.length ? (
        <View style={{ borderRadius: SA.radius.lg, borderWidth: 1, borderColor: SA.color.line, backgroundColor: SA.color.panel, overflow: 'hidden' }}>
          {data.map((h, i) => (
            <View key={h.id} testID="sa-media-history-row" style={{ padding: SA.space.md, borderTopWidth: i ? 1 : 0, borderColor: SA.color.line }}>
              <Row style={{ flexWrap: 'nowrap', gap: SA.space.md }}>
                <IconBox name={OP_ICON[h.op].icon} tone={OP_ICON[h.op].tone} box={34} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T weight="bold" numberOfLines={1}>{h.label || opLabel(h.op)}</T>
                  <T size="xs" color={SA.color.muted} numberOfLines={1}>{`${opLabel(h.op)} · ${ago(h.at)}${h.actor ? ` · ${h.actor}` : ''}`}</T>
                  <T size="xs" color={SA.color.muted}>{tr('{n} files · {size}', { n: h.files, size: size(h.bytes) })}</T>
                </View>
                {h.restoredAt ? <Badge tone="muted" label={tr('Restored {when}', { when: ago(h.restoredAt) })} /> : h.restorable ? <Badge tone="ok" label={tr('{n} files would move back', { n: h.changed })} /> : <Badge tone="muted" label={tr('Nothing to restore')} />}
              </Row>
              {h.restorable && confirm !== h.id ? (
                <View style={{ marginTop: SA.space.sm, marginStart: 34 + SA.space.md }}>
                  <Row><Btn small kind="ghost" testID="sa-media-history-restore" icon="restore" label={tr('Restore this state')} onPress={() => setConfirm(h.id)} disabled={busy !== ''} /></Row>
                </View>
              ) : null}
              {confirm === h.id ? (
                <View style={{ marginTop: SA.space.sm }}>
                  <Notice tone="warn" testID="sa-media-history-confirm">
                    {tr('Put every file back where it was before this transfer? Files are copied and checked first, and a new restore point is saved so you can undo this.')}
                    <Row style={{ marginTop: SA.space.sm }}>
                      <Btn small testID="sa-media-history-go" label={tr('Restore now')} onPress={() => restore(h.id)} busy={busy === h.id} />
                      <Btn small kind="ghost" label={tr('Cancel')} onPress={() => setConfirm('')} disabled={busy !== ''} />
                    </Row>
                  </Notice>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ marginTop: SA.space.md }}>
        <Hint>{tr('Restore points hold the location of each file, not a second copy of it. The old copies kept after a transfer are what make a restore possible, so remove them only when you are sure.')}</Hint>
      </View>
    </View>
  );
}
