import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { errorVars, formatBytes, type Job, type JobIssue } from '@/lib/backupClient';
import { useT } from '@/i18n';

type TFn = ReturnType<typeof useT>['t'];

/** Text for a server error / warning / log code, with the details it carries ({{entry}}, {{count}}...). Unknown codes fall back to a generic line. */
export const codeText = (t: TFn, group: 'err' | 'warn' | 'log', code: string, issue: JobIssue | Record<string, unknown> = {}) => {
  const key = group === 'log' ? code.replace(/\./g, '_') : code;
  const vars = errorVars(issue as JobIssue);
  const full = { ...vars, ...Object.fromEntries(Object.entries(issue).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)])) };
  const text = t(`bk.${group}.${key}`, { ...full, defaultValue: '' });
  return text && typeof text === 'string' ? text : group === 'log' ? key : t('bk.err.UNKNOWN');
};

export function Bar({ pct, tone = 'primary', testID }: { pct: number; tone?: 'primary' | 'danger' | 'success'; testID?: string }) {
  return (
    <View testID={testID} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }} className="h-2.5 rounded-full bg-surface2 overflow-hidden">
      <View className={`h-full rounded-full ${tone === 'danger' ? 'bg-danger' : tone === 'success' ? 'bg-success' : 'bg-primary'}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </View>
  );
}

export function Notice({ tone, children, testID }: { tone: 'warn' | 'danger' | 'info' | 'success'; children: React.ReactNode; testID?: string }) {
  const icon = tone === 'danger' ? 'alert-circle-outline' : tone === 'success' ? 'check-circle-outline' : tone === 'warn' ? 'alert-outline' : 'information-outline';
  return (
    <View testID={testID} className={`flex-row gap-2.5 rounded-xl p-3 mb-2 ${tone === 'danger' ? 'bg-surface2 border border-danger' : 'bg-surface2'}`}>
      <Icon name={icon} size={18} tone={tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'muted'} />
      <View className="flex-1" style={{ minWidth: 0 }}>{typeof children === 'string' ? <Txt className="text-[13px] leading-[19px]">{children}</Txt> : children}</View>
    </View>
  );
}

const STATUS_ICON: Record<string, string> = { done: 'check-circle', running: 'progress-clock', error: 'close-circle', skipped: 'minus-circle-outline', pending: 'circle-outline' };

/** Progress of one job: bar, the steps with their state, errors, notices, the result and an optional detailed log. */
export function JobView({ job, onCancel, onDownload, testID = 'bk-job' }: { job: Job; onCancel?: () => void; onDownload?: () => void; testID?: string }) {
  const { t } = useT();
  const [showLog, setShowLog] = useState(false);
  const running = job.status === 'running' || job.status === 'queued';
  const failed = job.status === 'error' || job.status === 'cancelled';
  const result = job.result;
  const safety = result?.safetyBackup;
  const safetyName = typeof safety === 'string' ? safety : safety?.name;
  const restored = result?.restored;
  const parts = restored ? [restored.db ? t('bk.part.db') : '', restored.media ? `${t('bk.part.media')} (${restored.media})` : '', restored.app ? `${t('bk.part.app')} (${restored.app})` : ''].filter(Boolean).join(', ') : '';
  return (
    <Card testID={testID} className="p-4 mb-3">
      <View className="flex-row items-center justify-between mb-2 gap-2">
        <Txt testID={`${testID}-status`} className={`font-black text-[15px] ${job.status === 'done' ? 'text-success' : failed ? 'text-danger' : ''}`}>{t(`bk.job.${job.kind}`)} · {t(`bk.status.${job.status}`)}</Txt>
        <Txt testID={`${testID}-pct`} className="text-muted font-bold text-[13px]">{job.status === 'done' ? 100 : job.progress}%</Txt>
      </View>
      <Bar pct={job.status === 'done' ? 100 : job.progress} tone={job.status === 'done' ? 'success' : failed ? 'danger' : 'primary'} />
      <View className="mt-3 gap-1.5">
        {job.steps.map((s) => (
          <View key={s.key} testID={`${testID}-step-${s.key}`} className="flex-row items-center gap-2">
            <Icon name={STATUS_ICON[s.status] || 'circle-outline'} size={16} tone={s.status === 'done' ? 'success' : s.status === 'error' ? 'danger' : 'muted'} />
            <Txt className={`text-[13px] flex-1 ${s.status === 'pending' || s.status === 'skipped' ? 'text-muted' : ''}`}>{t(`bk.step.${s.key}`)}</Txt>
            {s.status === 'running' || s.status === 'error' ? <Txt className="text-muted text-[12px]">{t(`bk.status.${s.status}`)}</Txt> : null}
          </View>
        ))}
      </View>
      {job.errors.length ? (
        <View className="mt-3" testID={`${testID}-errors`}>
          <Txt className="text-danger font-bold text-[13px] mb-1">{t('bk.job.errors')}</Txt>
          {job.errors.map((e, i) => <Notice key={i} tone="danger">{codeText(t, 'err', e.code, e)}</Notice>)}
        </View>
      ) : null}
      {job.warnings.length ? (
        <View className="mt-3" testID={`${testID}-warnings`}>
          <Txt className="font-bold text-[13px] mb-1">{t('bk.job.warnings')}</Txt>
          {job.warnings.map((w, i) => <Notice key={i} tone="warn">{codeText(t, 'warn', w.code, w)}</Notice>)}
        </View>
      ) : null}
      {job.status === 'done' && job.kind === 'backup' && result ? (
        <View className="mt-3 gap-1">
          {typeof result.size === 'number' ? <Txt className="text-[13px]">{t('bk.job.size', { size: formatBytes(result.size) })}</Txt> : null}
          {job.options?.destination && job.options.destination !== 'local' ? <Txt className="text-[13px] text-success font-bold">{t('bk.job.sentTo', { dest: t(`bk.dest.${job.options.destination}`) })}</Txt> : null}
          {result.sha256 ? <Txt selectable className="text-muted text-[11px]">{t('bk.job.sha', { sha: String(result.sha256) })}</Txt> : null}
        </View>
      ) : null}
      {job.status === 'done' && job.kind === 'restore' ? (
        <View className="mt-3 gap-1">
          {parts ? <Txt testID={`${testID}-restored`} className="text-[13px] font-bold">{t('bk.job.restored', { parts })}</Txt> : null}
          {safetyName ? <Txt className="text-muted text-[12px]">{t('bk.job.safetyMade', { name: safetyName })}</Txt> : null}
          {result?.failed ? <Notice tone="warn">{t('bk.job.failedSome')}</Notice> : null}
          {result?.restartRequired ? <Notice tone="warn" testID={`${testID}-restart`}>{t('bk.job.restart')}</Notice> : null}
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-2 mt-3 items-center">
        {running && onCancel ? (
          <Pressable testID={`${testID}-cancel`} accessibilityRole="button" disabled={job.cancelling} onPress={onCancel} className="h-10 px-4 rounded-full bg-surface2 items-center justify-center active:opacity-80"><Txt className="font-bold text-[13px]">{job.cancelling ? t('bk.job.cancelling') : t('bk.job.cancel')}</Txt></Pressable>
        ) : null}
        {job.canDownload && onDownload ? (
          <Pressable testID={`${testID}-download`} accessibilityRole="button" onPress={onDownload} className="h-10 px-4 rounded-full bg-primary flex-row gap-2 items-center justify-center active:opacity-80"><Icon name="download" size={18} tone="onprimary" /><Txt className="font-bold text-[13px] text-onprimary">{t('bk.job.download')}</Txt></Pressable>
        ) : null}
        {job.log.length ? <Pressable testID={`${testID}-log-toggle`} accessibilityRole="button" onPress={() => setShowLog((v) => !v)} hitSlop={6}><Txt className="text-muted text-[12px] font-bold underline">{showLog ? t('bk.job.hideLog') : t('bk.job.log')}</Txt></Pressable> : null}
      </View>
      {showLog ? (
        <View testID={`${testID}-log`} className="mt-2 rounded-xl bg-surface2 p-3 gap-1">
          {job.log.slice(-60).map((l, i) => <Txt key={i} className={`text-[11px] ${l.level === 'error' ? 'text-danger' : l.level === 'warn' ? '' : 'text-muted'}`}>{new Date(l.at).toLocaleTimeString()} · {codeText(t, l.level === 'error' ? 'err' : 'log', l.code, l)}</Txt>)}
        </View>
      ) : null}
    </Card>
  );
}
