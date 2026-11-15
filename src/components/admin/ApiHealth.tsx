import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { Txt } from '@/components/ui/Txt';
import { api, backendEnabled } from '@/lib/backend';
import { useT } from '@/i18n';

type Health = 'working' | 'not_working' | 'unknown';

/**
 * Read-only "API Health" card for administrators who may not see or edit the Store API settings (permission storeApi withdrawn by the
 * super admin). It shows ONE word, Working or Not working: no provider, key, model or usage. The server answers the same single word.
 */
export function ApiHealth({ testID = 'api-health' }: { testID?: string }) {
  const { t } = useT();
  const [state, setState] = useState<Health | 'loading'>('loading');
  const load = useCallback(async () => {
    if (!backendEnabled) { setState('unknown'); return; }
    setState('loading');
    try { const r = await api<{ status: string }>('/admin/api-health'); setState(r.status === 'working' ? 'working' : 'not_working'); }
    catch { setState('unknown'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const ok = state === 'working';
  const label = state === 'working' ? t('bk.health.working') : state === 'not_working' ? t('bk.health.notWorking') : state === 'loading' ? t('bk.health.checking') : t('bk.health.unknown');
  return (
    <Card testID={testID} className="p-4 mb-3">
      <View className="flex-row items-center gap-3">
        <View className={`w-11 h-11 rounded-2xl items-center justify-center ${ok ? 'bg-soft' : 'bg-surface2'}`}>
          {state === 'loading' ? <Spinner size={22} /> : <Icon name={ok ? 'check-circle-outline' : 'alert-circle-outline'} size={26} tone={ok ? 'success' : 'danger'} />}
        </View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt className="text-muted text-[12px] font-bold">{t('bk.health.title')}</Txt>
          <Txt testID={`${testID}-status`} className={`text-[18px] font-black ${ok ? 'text-success' : state === 'not_working' ? 'text-danger' : ''}`}>{label}</Txt>
        </View>
        <Pressable testID={`${testID}-refresh`} accessibilityRole="button" accessibilityLabel={t('bk.health.refresh')} onPress={load} hitSlop={8} className="w-10 h-10 rounded-full items-center justify-center active:bg-surface2"><Icon name="refresh" size={20} tone="muted" /></Pressable>
      </View>
      <Txt className="text-muted text-[12px] mt-2">{t('bk.health.note')}</Txt>
    </Card>
  );
}
