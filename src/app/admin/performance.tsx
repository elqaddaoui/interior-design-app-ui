import React from 'react';
import { Button } from '@/components/ui/Button';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { VideoPanel } from '@/components/admin/performance/VideoPanel';
import { useT } from '@/i18n';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { patchGlobal, resolveGlobal } from '@/lib/toolCards';
import { toast } from '@/store/useToast';
import { useStore } from '@/store/useStore';

/** Admin > Performance: everything that keeps the app light on low-end phones. Today: the Video preview panel (pre-rendered card animations). */
export default function PerformanceAdmin() {
  const contentReady = useStore((s) => s.contentReady);
  const { t } = useT();
  const { draft: settings, patch, save, dirty } = useDraftDoc('settings');
  if (!contentReady) return <AdminPage title={t('admin.nav.performance')}><AdminLoading /></AdminPage>;
  const global = resolveGlobal(settings.toolCards);
  return (
    <AdminPage title={t('admin.nav.performance')} right={<Button testID="performance-submit" size="sm" title={t('improve.submit')} disabled={!dirty} onPress={async () => { if (await save()) toast(t('admin.crud.saved')); }} />}>
      <Txt className="text-muted text-[12px] mb-3">{t('ax.vid.pageNote')}</Txt>
      <VideoPanel videoMode={global.videoMode} onMode={(videoMode) => patch({ toolCards: patchGlobal(settings.toolCards, { videoMode }) })}
        extras={global.videoExtras} onExtras={(videoExtras) => patch({ toolCards: patchGlobal(settings.toolCards, { videoExtras }) })}
        quality={global.videoQuality} onQuality={(videoQuality) => patch({ toolCards: patchGlobal(settings.toolCards, { videoQuality }) })}
        adv={global.videoAdv} onAdv={(videoAdv) => patch({ toolCards: patchGlobal(settings.toolCards, { videoAdv: Object.keys(videoAdv).length ? videoAdv : undefined }) })} />
    </AdminPage>
  );
}
