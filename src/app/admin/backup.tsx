import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { BackupForm } from '@/components/admin/backup/BackupForm';
import { RestorePanel } from '@/components/admin/backup/RestorePanel';
import { JobView, Notice, codeText } from '@/components/admin/backup/bits';
import { adminTransport } from '@/components/admin/backup/transport';
import { useBackup } from '@/lib/useBackup';
import { formatBytes } from '@/lib/backupClient';
import { backendEnabled } from '@/lib/backend';
import { useCan } from '@/store/useAdminProfile';
import { useT } from '@/i18n';

type Tab = 'backup' | 'restore' | 'history';

/** Admin > Backup & Restore. Needs the `backup` permission (granted by the platform owner); everything long runs on the server. */
export default function BackupAdmin() {
  const { t } = useT();
  const allowed = useCan('backup');
  if (!allowed) return <AdminPage title={t('admin.nav.backup')} max={640}><Notice tone="info" testID="bk-locked">{t('bk.ui.locked')}</Notice></AdminPage>;
  return <BackupScreen />;
}

function BackupScreen() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('backup');
  const b = useBackup(backendEnabled ? adminTransport : null, 'admin');
  const web = Platform.OS === 'web';
  const title = t('admin.nav.backup');
  if (!backendEnabled) return <AdminPage title={title} max={760}><Notice tone="info">{t('bk.err.NETWORK')}</Notice></AdminPage>;
  if (b.capsError) return <AdminPage title={title} max={760}><Notice tone="danger" testID="bk-caps-error">{b.capsError === 'PERMISSION_DENIED' ? t('bk.ui.locked') : codeText(t, 'err', b.capsError)}</Notice><Button title={t('bk.ui.retry')} variant="soft" onPress={b.loadCaps} /></AdminPage>;
  if (!b.caps) return <AdminPage title={title} max={760}><AdminLoading label={t('bk.ui.loading')} /></AdminPage>;
  const caps = b.caps;
  return (
    <AdminPage title={title} max={760}>
      <Txt className="text-muted text-[13px] mb-3">{t('bk.ui.intro')}</Txt>
      {!caps.available ? <Notice tone="warn" testID="bk-unavailable">{codeText(t, 'err', caps.reason || 'BACKUP_UNSUPPORTED_HOST')}</Notice> : null}
      {!web ? <Notice tone="info">{t('bk.ui.webOnly')}</Notice> : null}
      <View className="mb-3"><Segmented testID="bk-tabs" value={tab} options={[{ key: 'backup' as Tab, label: t('bk.tab.backup') }, { key: 'restore' as Tab, label: t('bk.tab.restore') }, { key: 'history' as Tab, label: t('bk.tab.history') }]} onChange={(v) => { setTab(v); if (v === 'history') b.loadJobs(); }} /></View>
      {tab === 'backup' ? (
        <>
          {!b.backupRunning ? <BackupForm caps={caps} busy={b.busy} error={b.error} onStart={b.startBackup} /> : null}
          {b.job ? <JobView job={b.job} testID="bk-job" onCancel={() => b.cancel(b.job!.id)} onDownload={() => b.download(b.job!.id)} /> : null}
        </>
      ) : null}
      {tab === 'restore' ? <RestorePanel b={b} caps={caps} /> : null}
      {tab === 'history' ? <History b={b} /> : null}
    </AdminPage>
  );
}

function History({ b }: { b: ReturnType<typeof useBackup> }) {
  const { t } = useT();
  const [open, setOpen] = useState<string | null>(null);
  if (!b.jobs.length) return <Card className="p-6 items-center"><Txt testID="bk-history-empty" className="text-muted">{t('bk.h.empty')}</Txt></Card>;
  return (
    <View testID="bk-history">
      {b.jobs.map((j) => (
        <View key={j.id}>
          <Pressable testID={`bk-history-${j.id}`} accessibilityRole="button" onPress={() => setOpen(open === j.id ? null : j.id)} className="flex-row items-center gap-3 bg-surface rounded-2xl border border-line p-3 mb-2 active:opacity-80">
            <Icon name={j.status === 'done' ? 'check-circle-outline' : j.status === 'running' || j.status === 'queued' ? 'progress-clock' : 'alert-circle-outline'} size={22} tone={j.status === 'done' ? 'success' : j.status === 'error' ? 'danger' : 'muted'} />
            <View className="flex-1" style={{ minWidth: 0 }}>
              <Txt className="font-bold text-[14px]">{t(`bk.job.${j.kind}`)} · {t(`bk.status.${j.status}`)}</Txt>
              <Txt className="text-muted text-[12px]" numberOfLines={1}>{new Date(j.createdAt).toLocaleString()}{typeof j.result?.size === 'number' ? ` · ${formatBytes(j.result.size)}` : ''}</Txt>
            </View>
            <Icon name={open === j.id ? 'chevron-up' : 'chevron-down'} size={20} tone="muted" />
          </Pressable>
          {open === j.id ? <JobView job={j} testID={`bk-history-job-${j.id}`} onDownload={() => b.download(j.id)} /> : null}
        </View>
      ))}
      <Txt className="text-muted text-[12px] mt-1">{t('bk.h.expires', { n: b.caps?.limits.keepHours ?? 24 })}</Txt>
    </View>
  );
}
