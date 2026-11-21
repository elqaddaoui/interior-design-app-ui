import React, { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { ConfirmSheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { Bar, JobView, Notice, codeText } from './bits';
import { chooseZip, type useBackup } from '@/lib/useBackup';
import type { Capabilities, MediaTarget } from '@/lib/backupClient';
import { useT } from '@/i18n';

type Backup = ReturnType<typeof useBackup>;

/** Restore wizard: choose the zip -> upload in chunks -> full validation -> choose what to restore -> confirm -> progress. */
export function RestorePanel({ b, caps }: { b: Backup; caps: Capabilities }) {
  const { t } = useT();
  const plan = b.plan;
  const [parts, setParts] = useState({ app: false, db: false, media: false });
  const [target, setTarget] = useState<MediaTarget>('app');
  const [safety, setSafety] = useState(true);
  const [ask, setAsk] = useState(false);
  // A new plan (a freshly validated file) resets the choices: derived while rendering.
  const [seenPlan, setSeenPlan] = useState<typeof plan>(null);
  if (plan !== seenPlan) {
    setSeenPlan(plan);
    if (plan) {
      setParts({ app: plan.restorable.app, db: plan.restorable.db, media: plan.restorable.media });
      setTarget(plan.mediaTargets[plan.defaultMediaTarget] ? plan.defaultMediaTarget : plan.mediaTargets.app ? 'app' : 'r2');
      setSafety(true);
    }
  }
  const busy = b.phase === 'uploading' || b.phase === 'validating' || b.phase === 'restoring';
  const pick = async () => { const file = await chooseZip(); if (file) b.pickFile(file); };
  const chosen = [parts.db ? t('bk.part.db') : '', parts.media ? t('bk.part.media') : '', parts.app ? t('bk.part.app') : ''].filter(Boolean).join(' + ');
  const none = !parts.app && !parts.db && !parts.media;
  const mediaBlocked = parts.media && !plan?.mediaTargets[target];
  const rows = plan ? Object.entries(plan.willReplace).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]) : [];
  const row = (k: 'app' | 'db' | 'media', label: string, on: boolean, disabled: boolean) => (
    <View key={k} className="flex-row items-center justify-between py-2 gap-3">
      <Txt className={`flex-1 text-[15px] font-bold ${disabled ? 'text-muted' : ''}`}>{label}</Txt>
      <Toggle testID={`bk-part-${k}`} value={on} disabled={disabled || busy} onValueChange={(v) => setParts((p) => ({ ...p, [k]: v }))} label={label} />
    </View>
  );
  return (
    <View testID="bk-restore">
      <Card className="p-4 mb-3">
        <Txt className="text-muted text-[13px] mb-3">{t('bk.r.intro')}</Txt>
        <Button testID="bk-pick" title={b.fileName ? t('bk.r.another') : t('bk.r.pick')} icon="upload" variant={b.fileName ? 'soft' : 'primary'} disabled={busy || !caps.available} onPress={pick} />
        {b.fileName ? <Txt testID="bk-file" className="text-[13px] font-bold mt-3" numberOfLines={1}>{b.fileName}</Txt> : null}
        {b.phase === 'uploading' ? <View className="mt-2" testID="bk-upload"><Bar pct={b.uploadPct} /><Txt className="text-muted text-[12px] mt-1">{t('bk.r.uploading', { pct: b.uploadPct })}</Txt></View> : null}
        {b.phase === 'validating' && b.checkJob ? <View className="mt-2" testID="bk-validating"><Bar pct={b.checkJob.progress} /><Txt className="text-muted text-[12px] mt-1">{t('bk.r.validating')}</Txt></View> : null}
        {b.phase === 'error' && b.error && !b.restoreJob ? <View className="mt-3"><Notice tone="danger" testID="bk-restore-error">{codeText(t, 'err', b.error, b.checkJob?.errors[0] ?? {})}</Notice></View> : null}
      </Card>
      {plan && (b.phase === 'ready' || b.phase === 'restoring' || b.phase === 'done' || b.phase === 'error') ? (
        <Card testID="bk-plan" className="p-4 mb-3">
          <Notice tone="success">{t('bk.r.valid')}</Notice>
          <Txt className="font-bold text-[13px] text-muted mb-1">{t('bk.r.contains')}</Txt>
          {plan.manifest.createdAt ? <Txt className="text-muted text-[12px] mb-1">{t('bk.r.created', { date: new Date(plan.manifest.createdAt).toLocaleString() })}</Txt> : null}
          {row('db', plan.manifest.storePart === 'app' ? t('bk.part.storeApp') : plan.manifest.storePart === 'both' ? t('bk.part.storeBoth') : plan.manifest.db?.schemaOnly ? t('bk.part.dbSchema') : t('bk.part.db'), parts.db, !plan.restorable.db)}
          {row('media', t('bk.part.media'), parts.media, !plan.restorable.media)}
          {row('app', t('bk.part.app'), parts.app, !plan.restorable.app)}
          {parts.media ? (
            <View className="mt-2" testID="bk-target-box">
              <Txt className="text-[13px] font-bold text-muted mb-1.5">{t('bk.r.mediaTarget')}</Txt>
              <Segmented testID="bk-target" value={target} options={[{ key: 'r2' as MediaTarget, label: t('bk.target.r2') }, { key: 'app' as MediaTarget, label: t('bk.target.app') }]} onChange={setTarget} />
              {mediaBlocked ? <Txt className="text-danger text-[12px] mt-1.5">{t('bk.r.targetOff')}</Txt> : null}
            </View>
          ) : null}
          {parts.db ? (
            <View className="flex-row items-center justify-between gap-3 mt-3">
              <Txt className="flex-1 text-[13px] font-bold">{t('bk.r.safety')}</Txt>
              <Toggle testID="bk-safety" value={safety} disabled={busy} onValueChange={setSafety} label={t('bk.r.safety')} />
            </View>
          ) : null}
          {plan.warnings.map((w, i) => <View key={i} className="mt-2"><Notice tone="warn">{codeText(t, 'warn', w.code, w)}</Notice></View>)}
          {parts.db && rows.length ? (
            <View className="mt-3" testID="bk-replace">
              <Txt className="text-[13px] font-bold text-muted mb-1">{t('bk.r.willReplace')}</Txt>
              {rows.slice(0, 6).map(([table, n]) => <Txt key={table} className="text-[12px] text-muted">{table} · {t('bk.r.rows', { n })}</Txt>)}
              {rows.length > 6 ? <Txt className="text-[12px] text-muted">{t('bk.r.moreTables', { n: rows.length - 6 })}</Txt> : null}
            </View>
          ) : null}
          {none ? <Txt className="text-muted text-[12px] mt-3">{t('bk.r.nothing')}</Txt> : null}
          {b.phase === 'ready' || (b.phase === 'error' && !b.restoreJob) ? (
            <View className="mt-4"><Button testID="bk-restore-start" title={t('bk.r.start')} variant="danger" icon="database-import-outline" disabled={none || mediaBlocked || busy} onPress={() => setAsk(true)} /></View>
          ) : null}
        </Card>
      ) : null}
      {b.restoreJob ? <JobView job={b.restoreJob} testID="bk-restore-job" onCancel={() => b.cancelRestore(b.restoreJob!.id)} /> : null}
      {b.phase === 'done' || (b.phase === 'error' && b.restoreJob) ? <View className="mb-3"><Button testID="bk-restore-reset" variant="soft" title={t('bk.r.another')} onPress={b.reset} /></View> : null}
      <ConfirmSheet
        visible={ask} onClose={() => setAsk(false)}
        message={`${t('bk.r.confirm', { parts: chosen })}\n${parts.db ? (safety ? t('bk.r.confirmSafety') : t('bk.r.confirmNoSafety')) : ''}`.trim()}
        confirmLabel={t('bk.r.confirmYes')} cancelLabel={t('bk.r.confirmNo')}
        onConfirm={() => b.restore(parts, parts.media ? target : undefined, parts.db && safety)}
      />
    </View>
  );
}
