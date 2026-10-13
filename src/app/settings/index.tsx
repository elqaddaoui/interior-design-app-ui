import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from '@/hooks/useLeaveGuard';
import Constants from 'expo-constants';
import { useLang, LANGS } from '@/i18n';
import { useLocal } from '@/store/useLocal';
import { useMe, useStore } from '@/store/useStore';
import { useT } from '@/i18n';
import { Card, Icon, PageHeader, Screen, Sheet, Toggle, Txt } from '@/components/ui';
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
  const { notifications, set } = useLocal();
  const me = useMe();
  const branding = useStore((s) => s.doc.branding);
  const [doc, setDoc] = useState<'about' | 'privacy' | null>(null);
  const ver = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen max={640} header={<PageHeader title={t('settings.title')} onBack={() => router.back()} />}>
      <Txt className="text-muted font-bold text-[12px] mb-2 mt-2 uppercase">{t('settings.language')}</Txt>
      <Card className="flex-row p-1.5 gap-1.5 mb-5">
        {LANGS.map((l) => (
          <Pressable key={l} testID={`lang-${l}`} onPress={() => setLang(l)} className={`flex-1 h-11 rounded-xl items-center justify-center ${lang === l ? 'bg-primary' : 'active:bg-surface2'}`}>
            <Txt className={`font-bold text-[13px] ${lang === l ? 'text-onprimary' : ''}`}>{t(`lang.${l}`)}</Txt>
          </Pressable>
        ))}
      </Card>

      <Card className="overflow-hidden mb-5">
        <Row icon="star-four-points-outline" title={t('settings.credits')} sub={t('settings.creditsLeft', { count: me?.credits ?? 0 })} onPress={() => router.push('/pro')} testID="row-credits"
          right={<View className="bg-primary rounded-lg px-3 py-1"><Txt className="text-onprimary font-extrabold text-[12px]">{t('settings.pro')}</Txt></View>} />
        <View className="h-px bg-line mx-4" />
        <Row icon="bell-outline" title={t('settings.notifications')} sub={t('settings.notificationsDesc')}
          right={<Toggle testID="switch-notif" label={t('settings.notifications')} value={notifications} onValueChange={(v) => { set({ notifications: v, bannerDismissed: true }); toast(t(v ? 'notif.enabled' : 'notif.disabled')); }} />} />
      </Card>

      <Card className="overflow-hidden mb-5">
        <Row icon="information-outline" title={t('settings.about')} onPress={() => setDoc('about')} testID="row-about" />
        <View className="h-px bg-line mx-4" />
        <Row icon="shield-lock-outline" title={t('settings.privacy')} onPress={() => setDoc('privacy')} testID="row-privacy" />
        <View className="h-px bg-line mx-4" />
        <Row icon="cog-box" title={t('settings.admin')} onPress={() => router.push('/admin')} testID="row-admin" />
      </Card>
      <Txt className="text-muted text-center text-[12px]">{branding.appName} · {t('settings.version')} {ver}</Txt>

      <Sheet visible={doc !== null} onClose={() => setDoc(null)} title={doc ? t(`settings.${doc}`) : ''}>
        <Txt className="text-[15px] leading-6">{doc === 'about' ? t('settings.aboutText') : t('settings.privacyText')}</Txt>
      </Sheet>
    </Screen>
  );
}
