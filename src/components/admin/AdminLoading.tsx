import React from 'react';
import { View } from 'react-native';
import { Spinner } from '@/components/ui/Spinner';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';

/** Shown by an admin page while its data has not arrived from the database yet (uses the loader chosen in Admin > Interface). */
export function AdminLoading({ label, testID = 'admin-loading' }: { label?: string; testID?: string }) {
  const { t } = useT();
  return (
    <View testID={testID} accessibilityRole="progressbar" accessibilityLabel={label ?? t('ax.loadingData')} className="items-center justify-center py-16 gap-3" style={{ minHeight: 280 }}>
      <Spinner size={56} />
      <Txt className="text-muted text-[13px] font-semibold">{label ?? t('ax.loadingData')}</Txt>
    </View>
  );
}
