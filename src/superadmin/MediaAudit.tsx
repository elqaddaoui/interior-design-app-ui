import React, { useState } from 'react';
import { View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { MediaAudit, MediaRepair } from '@/superadmin/types';
import { Badge, Btn, Card, ErrorLine, Hint, Notice, Row, T, ago } from '@/superadmin/ui';

const size = (bytes: number | null | undefined) => {
  const n = Number(bytes || 0);
  return n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
};

/**
 * "Check storage": compares what the database says with what R2 / the app folder really hold. Reading changes nothing. Fixing only does the safe
 * steps by default (sizes, wrong storage, joining the shared namespace); deleting leftovers or broken rows is a separate, explicit choice.
 */
export function StorageCheck({ onChanged }: { onChanged: () => void }) {
  const [audit, setAudit] = useState<MediaAudit | null>(null);
  const [result, setResult] = useState<MediaRepair | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [orphans, setOrphans] = useState(false);
  const [broken, setBroken] = useState(false);

  const check = async () => {
    setBusy('check'); setError(null); setResult(null);
    try { setAudit(await sa<MediaAudit>('/media/audit', { method: 'POST' })); } catch (e) { setError(saMessage(e)); } finally { setBusy(''); }
  };
  const fix = async () => {
    setBusy('fix'); setError(null);
    try {
      let last = await sa<MediaRepair>('/media/repair', { method: 'POST', body: { orphans, broken } });
      const total = { ...last };
      for (let round = 0; last.partial && round < 40; round++) {
        last = await sa<MediaRepair>('/media/repair', { method: 'POST', body: { orphans, broken } });
        for (const k of ['sizes', 'repointed', 'copied', 'recovered', 'migrated', 'orphansDeleted', 'orphanBytes', 'brokenRemoved', 'failed'] as const) total[k] += last[k];
        total.remaining = last.remaining; total.partial = last.partial;
      }
      setResult(total);
      setAudit(await sa<MediaAudit>('/media/audit', { method: 'POST' }));
      onChanged();
    } catch (e) { setError(saMessage(e)); } finally { setBusy(''); }
  };

  const line = (label: string, count: number, hint: string, tone: 'ok' | 'warn' | 'danger' = 'warn') => (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
      <View style={{ flexShrink: 1, minWidth: 200, flexBasis: 260 }}>
        <T weight="bold">{label}</T>
        <T size="xs" color={SA.color.muted}>{hint}</T>
      </View>
      <Badge label={String(count)} tone={count ? tone : 'ok'} />
    </Row>
  );
  const unchecked = audit ? (['r2', 'fs'] as const).filter(k => audit.storages[k].available && !audit.storages[k].checked) : [];
  const pending = audit ? audit.recoverable.files + audit.wrongStorage.files + audit.strayPrefix.files + audit.legacy.files + audit.sizeMismatch.files + audit.sizeUnknown.files : 0;

  return (
    <Card>
      <View testID="sa-media-check">
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flexShrink: 1, flexBasis: 280 }}>
            <T weight="bold">{tr('Check storage')}</T>
            <T size="sm" color={SA.color.muted}>{tr('Compares the database with the files that really sit in R2 and in the app folder. Checking changes nothing.')}</T>
          </View>
          <Btn small testID="sa-media-check-go" label={audit ? tr('Check again') : tr('Check now')} onPress={check} busy={busy === 'check'} disabled={busy !== ''} />
        </Row>
        <ErrorLine error={error} />
        {audit ? (
          <View style={{ marginTop: SA.space.md }}>
            {unchecked.map(k => (
              <Notice key={k} tone="warn">{tr('{storage} could not be read completely, so nothing was concluded about it ({reason}). No file is treated as missing.', { storage: k === 'r2' ? tr('Cloudflare R2') : tr('App folder (self-hosted)'), reason: audit.storages[k].error || '?' })}</Notice>
            ))}
            {audit.healthy && !unchecked.length ? <Notice tone="ok" testID="sa-media-healthy">{tr('Everything matches: every file in the database is in storage, and nothing in storage is unknown to the database.')}</Notice> : null}
            {line(tr('Old folder layout'), audit.legacy.files, tr('Files still kept under a store’s own folder. Fixing moves them to the shared place (copy, verify, then the old copy waits 24 hours).'))}
            {line(tr('Wrong storage recorded'), audit.wrongStorage.files, tr('The database says R2 but the file is in the app folder, or the reverse.'))}
            {line(tr('Missing in storage'), audit.missing.files, tr('The database lists a file that is not there. Stores that use it show a broken picture.'), 'danger')}
            {audit.recoverable.files ? line(tr('Copy found elsewhere'), audit.recoverable.files, tr('The file is not where the database expects it, but a copy exists in another place. Fixing copies it back after checking it is the same file. Nothing is deleted.')) : null}
            {audit.unverified.files ? line(tr('Not confirmed'), audit.unverified.files, tr('The file was not found, but the other storage could not be read, so it may be there. Nothing is changed.')) : null}
            {line(tr('Not in the database'), audit.orphans.files, tr('{size} in storage that no store, demo or theme owns ({deletable} can be deleted, {kept} kept because a store still needs them).', { size: size(audit.orphans.bytes), deletable: audit.orphans.deletable, kept: audit.orphans.kept }))}
            {line(tr('Size differs'), audit.sizeMismatch.files + audit.sizeUnknown.files, tr('The recorded size is wrong or unknown. Fixed only when the stored bytes are proven intact.'))}
            <T size="xs" color={SA.color.muted} style={{ marginTop: 6 }}>{tr('{r2} files in R2 · {fs} in the app folder · {db} kept in the database · checked {when}', { r2: audit.storages.r2.objects, fs: audit.storages.fs.objects, db: audit.inDatabase.files, when: ago(audit.at) })}</T>

            {!audit.healthy ? (
              <View style={{ marginTop: SA.space.md }}>
                <Row>
                  <Btn small kind={orphans ? 'danger' : 'ghost'} testID="sa-media-opt-orphans" label={orphans ? tr('Will delete files not in the database') : tr('Also delete files not in the database')} onPress={() => setOrphans(v => !v)} disabled={!audit.orphans.deletable} />
                  <Btn small kind={broken ? 'danger' : 'ghost'} testID="sa-media-opt-broken" label={broken ? tr('Will remove rows of missing files') : tr('Also remove rows of missing files')} onPress={() => setBroken(v => !v)} disabled={!audit.missing.files} />
                </Row>
                <Hint>{tr('Safe fixes (sizes, wrong storage, recovered copies, shared place) run always. The two options above delete, so they are off until you choose them. A file is never removed when it is the only copy of something a store still uses, and a copy is deleted only after it is proven identical to another one.')}</Hint>
                <Btn testID="sa-media-fix" label={tr('Fix now')} onPress={fix} busy={busy === 'fix'} disabled={busy !== '' || (!pending && !orphans && !broken)} />
              </View>
            ) : null}
          </View>
        ) : null}
        {result ? (
          <Notice tone={result.failed ? 'warn' : 'ok'} testID="sa-media-fixed">
            {tr('Fixed: {moved} moved to the shared place, {recovered} copied back, {repointed} pointed at the right storage, {sizes} sizes, {deleted} leftovers deleted, {removed} broken rows removed. {failed} could not be done and {skipped} were left alone on purpose.', { moved: result.migrated + result.copied, recovered: result.recovered, repointed: result.repointed, sizes: result.sizes, deleted: result.orphansDeleted, removed: result.brokenRemoved, failed: result.failed, skipped: result.skipped })}
          </Notice>
        ) : null}
      </View>
    </Card>
  );
}
