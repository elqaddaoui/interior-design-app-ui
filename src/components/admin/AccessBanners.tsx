import React from 'react';
import { View } from 'react-native';
import { usePathname } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { featureForPath, levelOf, useAccess } from '@/store/useAccess';

const TONE = {
  info: { bg: 'bg-soft', icon: 'information-outline' },
  success: { bg: 'bg-success/15', icon: 'check-circle-outline' },
  warning: { bg: 'bg-primary/25', icon: 'alert-outline' },
  danger: { bg: 'bg-danger/15', icon: 'alert-circle-outline' },
} as const;

function Bar({ tone, text, testID }: { tone: keyof typeof TONE; text: string; testID: string }) {
  return (
    <View testID={testID} accessibilityRole="alert" className={`flex-row items-center px-4 py-2 border-b border-line ${TONE[tone].bg}`} style={{ gap: 10 }}>
      <Icon name={TONE[tone].icon} size={18} />
      <Txt className="flex-1 text-[13px] font-semibold leading-[18px]">{text}</Txt>
    </View>
  );
}

/** Platform notices shown on top of every tenant admin page: announcement, maintenance, impersonation, read-only page. */
export function AccessBanners() {
  const { t } = useT();
  const info = useAccess((s) => s.info);
  const impersonated = useAccess((s) => s.impersonated);
  const path = usePathname();
  if (!info) return null;
  const { platform } = info;
  const level = levelOf(info, featureForPath(path));
  return (
    <>
      {impersonated ? <Bar testID="banner-impersonation" tone="warning" text={`${t('sx.bn.imp')} · ${info.tenant.name}`} /> : null}
      {platform.maintenance.enabled ? <Bar testID="banner-maintenance" tone="danger" text={platform.maintenance.message || t('sx.bn.maintenance')} /> : null}
      {platform.announcement.enabled && platform.announcement.text ? <Bar testID="banner-announcement" tone={platform.announcement.level} text={platform.announcement.text} /> : null}
      {level === 'view' ? <Bar testID="banner-readonly" tone="info" text={t('sx.bn.readonly')} /> : null}
    </>
  );
}
