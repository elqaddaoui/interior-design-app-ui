import React from 'react';
import { useBackCheckpoint } from '@/hooks/useLeaveGuard';
import { Modal, Pressable, View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { Txt } from './Txt';
import { Icon } from './Icon';

/** Bottom sheet on phones, centred dialog on larger screens. Re-applies theme vars (needed for web portals). */
export function Sheet({ visible, onClose, title, children, wide, footer, history = true }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode; history?: boolean }) {
  useBackCheckpoint(visible && history, onClose);
  const insets = useSafeAreaInsets();
  const { style } = useTheme();
  const { tablet, height } = useBp();
  const { rtl, t } = useT();
  return (
    <Modal visible={visible} transparent animationType={tablet ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <View style={[style, { flex: 1, direction: rtl ? 'rtl' : 'ltr' } as any]}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: tablet ? 'center' : 'flex-end', alignItems: 'center' }}>
            <Pressable
              onPress={() => {}}
              className={`bg-bg w-full ${tablet ? `rounded-3xl ${wide ? 'max-w-[960px]' : 'max-w-[520px]'}` : 'rounded-t-3xl'}`}
              style={{ maxHeight: height * 0.9, width: tablet ? '92%' : '100%', flexShrink: 1, minHeight: 0 }}
            >
              {title ? (
                <View testID="sheet-header" style={{ flexShrink: 0 }} className="flex-row items-center justify-between px-5 py-4 border-b border-line gap-3">
                  <Txt className="text-[18px] leading-[26px] font-extrabold flex-1">{title}</Txt>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} testID="sheet-close" onPress={onClose} hitSlop={10} className="w-9 h-9 rounded-full bg-surface2 items-center justify-center"><Icon name="close" size={20} /></Pressable>
                </View>
              ) : null}
              <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ padding: tablet ? 24 : 16, paddingTop: title ? 12 : 20, paddingBottom: footer ? 20 : Math.max(28, insets.bottom + 16) }}>{children}</ScrollView>
              {footer ? <View className="px-4 pt-3 border-t border-line bg-bg" style={{ paddingBottom: Math.max(16, insets.bottom), flexShrink: 0 }}>{footer}</View> : null}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function ConfirmSheet({ visible, onClose, onConfirm, message, confirmLabel, cancelLabel }: { visible: boolean; onClose: () => void; onConfirm: () => void; message: string; confirmLabel: string; cancelLabel: string }) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Txt className="text-[17px] font-bold text-center mb-5">{message}</Txt>
      <View className="flex-row gap-3">
        <Pressable onPress={onClose} className="flex-1 h-12 rounded-full bg-surface2 items-center justify-center active:opacity-80"><Txt className="font-bold">{cancelLabel}</Txt></Pressable>
        <Pressable onPress={() => { onClose(); onConfirm(); }} className="flex-1 h-12 rounded-full bg-danger items-center justify-center active:opacity-80"><Txt className="font-bold text-white">{confirmLabel}</Txt></Pressable>
      </View>
    </Sheet>
  );
}
