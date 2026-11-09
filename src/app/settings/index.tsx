import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useUserSession } from '@/store/useUserSession';
import { useWizard } from '@/store/useWizard';
import { router } from '@/hooks/useLeaveGuard';
import Constants from 'expo-constants';
import { useLang, LANGS, useT } from '@/i18n';
import { usePrefs } from '@/store/usePrefs';
import { setNotifications, useOwnerPushStatus } from '@/lib/notifications';
import { reloadUserSpace, useMe, useStore } from '@/store/useStore';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/StepHeader';
import { Screen } from '@/components/ui/Screen';
import { Sheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { toast } from '@/store/useToast';

function Row({ icon, title, sub, right, onPress, testID }: { icon: string; title: string; sub?: string; right?: React.ReactNode; onPress?: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} disabled={!onPress} onPress={onPress} className="flex-row items-center gap-3 px-4 py-3.5 active:bg-surface2">
      <View className="w-9 h-9 rounded-full bg-soft items-center justify-center"><Icon name={icon} size={19} /></View>
      <View className="flex-1"><Txt className="font-bold text-[15px]">{title}</Txt>{sub ? <Txt className="text-muted text-[12.5px]">{sub}</Txt> : null}</View>
      {right ?? (onPress ? <Icon name="chevron-right" size={20} tone="muted" flip /> : null)}
    </Pressable>
  );
}

export default function Settings() {
  const { t } = useT();
  const lang = useLang((s) => s.lang);
  const setLang = useLang((s) => s.set);
  const prefs = usePrefs((s) => s.client);
  const devicePush = useOwnerPushStatus('client');
  // The administrator can pause user notifications for everyone; the person's own choice is kept and applies again afterwards.
  const pausedByAdmin = useStore((state) => state.doc.settings.notifyUsers === false);
  const me = useMe();
  const user = useUserSession(s => s.user);
  const [loggingOut, setLoggingOut] = useState(false);
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await useUserSession.getState().logout(); useWizard.getState().clear(); useStore.setState({ history: [], conversations: [], requests: [] }); await reloadUserSpace(); router.replace('/'); }
    catch { toast(t('account.logoutError')); } finally { setLoggingOut(false); }
  };
  const changeNotifications = async (on: boolean) => {
    if (!user) { toast(t('push.clientLogin')); return; }
    try {
      const status = await setNotifications('client', on, lang);
      toast(t(!on ? 'notif.disabled' : status === 'enabled' ? 'notif.enabled' : status === 'blocked' ? 'push.blocked' : 'push.error'));
    } catch { toast(t('push.error')); }
  };
  const branding = useStore((s) => s.doc.branding);
  const [doc, setDoc] = useState<'about' | 'privacy' | null>(null);
  const ver = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen max={640} header={<PageHeader title={t('settings.title')} onBack={() => router.back()} />}>
      <Txt className="text-muted text-[12.5px] leading-[19px] mb-3 mt-1" testID="settings-note">{t('sm.userNote')}</Txt>

      <Txt className="text-muted font-bold text-[12px] mb-2 mt-2 uppercase" accessibilityRole="header">{t('sm.mine')}</Txt>
      <Txt className="text-muted font-bold text-[12px] mb-1.5">{t('settings.language')}</Txt>
      <Card className="flex-row p-1.5 gap-1.5 mb-3">
        {LANGS.map((l) => (
          <Pressable key={l} testID={`lang-${l}`} onPress={() => setLang(l)} className={`flex-1 h-11 rounded-xl items-center justify-center ${lang === l ? 'bg-primary' : 'active:bg-surface2'}`}>
            <Txt className={`font-bold text-[13px] ${lang === l ? 'text-onprimary' : ''}`}>{t(`lang.${l}`)}</Txt>
          </Pressable>
        ))}
      </Card>
      <Card className="overflow-hidden mb-5">
        <Row icon="bell-outline" title={t('settings.notifications')} sub={pausedByAdmin ? t('inbox.offByAdmin') : t('settings.notificationsDesc')}
          right={<Toggle testID="switch-notif" label={t('settings.notifications')} disabled={pausedByAdmin} value={prefs?.notifications === true || (prefs?.notifications !== false && devicePush === 'enabled')} onValueChange={(v) => { void changeNotifications(v); }} />} />
        <View className="h-px bg-line mx-4" />
        <Row icon="star-four-points-outline" title={t('settings.credits')} sub={t('settings.creditsLeft', { count: me?.credits ?? 0 })} onPress={() => router.push('/pro')} testID="row-credits"
          right={<View className="bg-primary rounded-lg px-3 py-1"><Txt className="text-onprimary font-extrabold text-[12px]">{t('settings.pro')}</Txt></View>} />
      </Card>

      <Txt className="text-muted font-bold text-[12px] mb-2 uppercase" accessibilityRole="header">{t('sm.app')}</Txt>
      <Card className="overflow-hidden mb-5">
        <Row icon="information-outline" title={t('settings.about')} onPress={() => setDoc('about')} testID="row-about" />
        <View className="h-px bg-line mx-4" />
        <Row icon="shield-lock-outline" title={t('settings.privacy')} onPress={() => setDoc('privacy')} testID="row-privacy" />
        <View className="h-px bg-line mx-4" />
        <Row icon="cog-box" title={t('settings.admin')} sub={t('sm.adminRowSub')} onPress={() => router.push('/admin')} testID="row-admin" />
      </Card>
      {user ? <Card className="overflow-hidden mb-5"><Row icon="logout" title={t('account.logout')} sub={user.whatsapp} onPress={() => { void logout(); }} testID="user-logout" /></Card> : null}
      <Txt className="text-muted text-center text-[12px]">{branding.appName} · {t('settings.version')} {ver}</Txt>

      <Sheet visible={doc !== null} onClose={() => setDoc(null)} title={doc ? t(`settings.${doc}`) : ''}>
        <Txt className="text-[15px] leading-6">{doc === 'about' ? t('settings.aboutText') : t('settings.privacyText')}</Txt>
      </Sheet>
    </Screen>
  );
}
