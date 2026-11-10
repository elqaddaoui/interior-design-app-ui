import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { BackendError, isBackendUnavailable } from '@/lib/backend';
import { sendTestPush, type PushStatus } from '@/lib/push';
import { setNotifications, useDevicePush, useOwnerPushStatus } from '@/lib/notifications';
import { useLocal } from '@/store/useLocal';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';

/** "Notifications des nouvelles demandes": works in desktop browsers, Android browsers, installed iPhone web apps and the Android app. */
export function PushNotifications() {
  const { t, lang } = useT();
  const offline = useLocal(s => s.adminOffline);
  const paused = useStore(s => s.doc.settings.notifyAdmins === false);
  const status: PushStatus = useOwnerPushStatus('admin');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => useDevicePush.getState().refresh(), []);
  // Subscribing (silently, when the browser already allows it) and language updates are handled by the preference bindings.
  useEffect(() => { void refresh(); }, [refresh]);
  const failure = (error: unknown) => toast(t(error instanceof BackendError && error.status === 401 ? 'push.login' : isBackendUnavailable(error) ? 'push.unavailable' : 'push.error'));
  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try { await setNotifications('admin', true, lang); }
    catch (error) { failure(error); void refresh(); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try { await setNotifications('admin', false, lang); }
    catch (error) { failure(error); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { const result = await sendTestPush(); toast(t(result.ok ? 'push.testSent' : 'push.testFailed')); }
    catch (error) { toast(t(error instanceof BackendError && error.code === 'NO_SUBSCRIPTION' ? 'push.testNone' : error instanceof BackendError && error.code === 'NOTIFICATIONS_OFF' ? 'inbox.offByAdmin' : 'push.testFailed')); }
    finally { setBusy(false); }
  };
  const blockedInfo = status === 'unsupported' || status === 'unconfigured' || status === 'blocked' || status === 'install';
  const on = status === 'enabled' && !paused;
  const bad = status === 'blocked' || status === 'unsupported' || status === 'unconfigured';
  const badge = on ? 'push.badgeOn' : paused ? 'push.badgePaused' : bad ? 'push.badgeBlocked' : status === 'install' ? 'push.badgeInstall' : 'push.badgeOff';
  const tone = on ? 'text-success' : bad ? 'text-danger' : 'text-muted';
  return <Card testID="admin-push-panel" className="p-4 mb-4 gap-4">
    <View className="flex-row items-center gap-3">
      <View className={`w-11 h-11 rounded-2xl items-center justify-center ${on ? 'bg-soft' : 'bg-surface2'}`}>
        <Icon name={on ? 'bell-check-outline' : bad ? 'bell-off-outline' : 'bell-outline'} size={22} tone={on ? 'primary' : bad ? 'danger' : 'muted'} />
      </View>
      <View className="flex-1 gap-0.5">
        <Txt className="font-bold text-[16px]">{t('push.title')}</Txt>
        <View className="flex-row items-center gap-1.5">
          <View className={`w-2 h-2 rounded-full ${on ? 'bg-success' : bad ? 'bg-danger' : 'bg-muted'}`} />
          <Txt testID="push-badge" className={`text-[12px] font-semibold ${tone}`}>{t(badge)}</Txt>
        </View>
      </View>
    </View>
    <Txt testID="push-status" className="text-muted text-[13px] leading-5">{t(`push.${status}`)}</Txt>
    {paused ? <Txt testID="push-paused" className="text-danger text-[13px]">{t('inbox.offByAdmin')}</Txt> : null}
    {offline ? <Txt testID="push-offline" className="text-danger text-[13px]">{t('push.login')}</Txt> : null}
    <View className="flex-row flex-wrap items-center gap-2">
      <Button safe testID="push-enable" title={t(status === 'enabled' ? 'push.renew' : 'push.enable')} icon={status === 'enabled' ? 'refresh' : 'bell-outline'} loading={busy} disabled={blockedInfo} onPress={() => { void enable(); }} />
      {status === 'enabled' ? <Button safe testID="push-test" title={t('push.test')} icon="bell-ring-outline" variant="outline" disabled={busy} onPress={() => { void test(); }} /> : null}
      {status === 'enabled' ? <Button safe testID="push-disable" title={t('push.disable')} icon="bell-off-outline" variant="ghost" disabled={busy} onPress={() => { void disable(); }} /> : null}
    </View>
    <View className="flex-row items-start gap-2 pt-3 border-t border-line">
      <View className="pt-0.5"><Icon name="lock-outline" size={14} tone="muted" /></View>
      <Txt className="flex-1 text-muted text-[12px] leading-4">{t('push.privacy')}</Txt>
    </View>
  </Card>;
}
