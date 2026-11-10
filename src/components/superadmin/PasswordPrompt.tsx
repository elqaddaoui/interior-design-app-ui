import React from 'react';
import { View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { Icon } from '@/components/ui/Icon';
import { useSuperAdmin } from '@/store/useSuperAdmin';
import { CredentialsForm } from './CredentialsForm';
import { useSa } from './ui';

/** Shown once after signing in with the default password: asks the owner to choose a real one. */
export function PasswordPrompt() {
  const { t } = useSa();
  const profile = useSuperAdmin((s) => s.profile);
  const shown = useSuperAdmin((s) => s.promptShown);
  const mark = useSuperAdmin((s) => s.markPrompted);
  const visible = !!profile?.defaultPassword && !shown;
  return (
    <Sheet visible={visible} onClose={mark} title={t('promptTitle')} history={false}>
      <View testID="sa-password-prompt">
        <View className="flex-row items-start mb-4" style={{ gap: 10 }}>
          <View className="w-10 h-10 rounded-2xl bg-soft items-center justify-center"><Icon name="shield-lock-outline" size={22} tone="fg" /></View>
          <Txt className="flex-1 text-[14px] leading-[21px] text-muted">{t('promptBody')}</Txt>
        </View>
        <CredentialsForm onDone={mark} onCancel={mark} cancelLabel={t('later')} />
      </View>
    </Sheet>
  );
}
