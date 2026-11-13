import React from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { poolState, useAdminInstance } from '@/store/useAdminInstance';

/**
 * The credit limit of a store is shared by all its clients. When what they hold plus what was used passes the limit ('over'),
 * the administrator gets a red warning; at 90% ('near') a softer heads-up; also when the platform paused the store's AI.
 * `onPress` (the dashboard) opens the credits page; on the credits page itself it is left out.
 */
export function PoolWarning({ onPress }: { onPress?: () => void }) {
  const { t } = useT();
  const { colors } = useTheme();
  const instance = useAdminInstance((s) => s.instance);
  const credits = instance?.credits;
  const state = poolState(credits);
  const paused = !!instance?.aiPaused;
  if (!credits || (state === 'ok' && !paused)) return null;
  const over = state === 'over';
  const tone = over || paused ? colors.danger : colors.ink;
  const title = paused && !over ? t('sp.aiPaused') : over ? t('sp.poolOverTitle') : t('sp.poolNearTitle');
  const body = over
    ? t('sp.poolOver', { allocated: credits.allocated ?? 0, used: credits.used, over: credits.over ?? 0, limit: credits.limit ?? 0 })
    : paused ? '' : t('sp.poolNear', { available: credits.available ?? 0, limit: credits.limit ?? 0 });
  return (
    <Pressable testID={over ? 'pool-warning-over' : paused ? 'pool-warning-paused' : 'pool-warning-near'} accessibilityRole={onPress ? 'button' : 'alert'} disabled={!onPress} onPress={onPress}
      className="rounded-2xl bg-surface border flex-row items-start" style={{ borderColor: tone, borderWidth: 1.5, padding: 14, gap: 12 }}>
      <Icon name={over || paused ? 'alert-circle-outline' : 'alert-outline'} size={24} tone={over || paused ? 'danger' : 'fg'} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt className="font-extrabold text-[14px]" style={{ color: tone }}>{title}</Txt>
        {body ? <Txt className="text-[12px] leading-[18px]">{body}</Txt> : null}
        {onPress ? <Txt className="text-[12px] font-bold text-primary" style={{ marginTop: 4 }}>{t('sp.poolCta')}</Txt> : null}
      </View>
    </Pressable>
  );
}
