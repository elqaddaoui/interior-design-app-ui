import React from 'react';
import { View } from 'react-native';
import type { Href } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useRouter } from '@/hooks/useLeaveGuard';
import { useT } from '@/i18n';
import { ADMIN_NAV } from '@/lib/adminNav';
import { levelOf, useAccess } from '@/store/useAccess';

/** Shown instead of a page the signed-in administrator's plan or role does not include. */
export function ForbiddenPage() {
  const { t } = useT();
  const router = useRouter();
  const info = useAccess((s) => s.info);
  const first = ADMIN_NAV.find((n) => levelOf(info, n.key) !== 'none');
  return (
    <View testID="admin-forbidden" className="flex-1 items-center justify-center px-8" style={{ gap: 14 }}>
      <View className="w-16 h-16 rounded-3xl bg-surface2 items-center justify-center"><Icon name="shield-lock-outline" size={30} tone="muted" /></View>
      <Txt accessibilityRole="header" className="text-[18px] font-black text-center">{t('sx.bn.forbidden')}</Txt>
      {first ? <Button testID="admin-forbidden-back" title={t('sx.bn.forbiddenBack')} onPress={() => router.replace(first.href as Href)} /> : null}
    </View>
  );
}
