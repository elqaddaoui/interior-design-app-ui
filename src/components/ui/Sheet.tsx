import React from 'react';
import { useBackCheckpoint, useNativeOverlayBack } from '@/hooks/useLeaveGuard';
import { Modal, Pressable, View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { Txt } from './Txt';
import { Icon } from './Icon';

function NativeOverlayBoundary({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useNativeOverlayBack(visible, onClose);
  return null;
}

/** Bottom sheet on phones, centred dialog on larger screens. Re-applies theme vars (needed for web portals). */
export function Sheet({ visible, onClose, title, children, wide, footer, history = true, onBack, headerRight }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode; history?: boolean; onBack?: () => void; headerRight?: React.ReactNode }) {
  useBackCheckpoint(visible && history, onClose, 1);
  const insets = useSafeAreaInsets();
  const { style } = useTheme();
  const { tablet, height } = useBp();
  const { rtl, t } = useT();
  return (
    <Modal visible={visible} transparent animationType={tablet ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <View style={[style, { flex: 1, direction: rtl ? 'rtl' : 'ltr' } as any]}>
        {history ? <NativeOverlayBoundary visible={visible} onClose={onClose} /> : null}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: tablet ? 'center' : 'flex-end', alignItems: 'center' }}>
            <Pressable
              onPress={() => {}}
              className={`bg-bg w-full ${tablet ? `rounded-2xl ${wide ? 'max-w-[880px]' : 'max-w-[460px]'}` : 'rounded-t-2xl'}`}
              style={{ maxHeight: height * (tablet ? 0.88 : 0.92), width: tablet ? '92%' : '100%', flexShrink: 1, minHeight: 0 }}
            >
              {title ? (
                <View testID="sheet-header" style={{ flexShrink: 0 }} className="flex-row items-center justify-between px-4 py-2.5 border-b border-line gap-3">
                  {onBack ? <Pressable accessibilityRole="button" accessibilityLabel={t('improve.back')} testID="sheet-back" onPress={onBack} hitSlop={8} className="w-8 h-8 rounded-full bg-surface2 items-center justify-center"><Icon name="chevron-left" size={20} flip /></Pressable> : null}
                  <Txt className="text-[16px] leading-[22px] font-extrabold flex-1" numberOfLines={2}>{title}</Txt>
                  {headerRight}
                  <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} testID="sheet-close" onPress={onClose} hitSlop={8} className="w-8 h-8 rounded-full bg-surface2 items-center justify-center"><Icon name="close" size={18} /></Pressable>
                </View>
              ) : null}
              <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ padding: tablet ? 16 : 12, paddingTop: title ? 10 : 16, paddingBottom: footer ? 12 : Math.max(16, insets.bottom + 8) }}>{children}</ScrollView>
              {footer ? <View className="px-3 pt-2.5 border-t border-line bg-bg" style={{ paddingBottom: Math.max(10, insets.bottom), flexShrink: 0 }}>{footer}</View> : null}
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
      <Txt className="text-[15px] leading-[22px] font-bold text-center mb-3 mt-1">{message}</Txt>
      <View className="flex-row gap-2.5">
        <Pressable onPress={onClose} className="flex-1 h-11 rounded-full bg-surface2 items-center justify-center active:opacity-80"><Txt className="font-bold">{cancelLabel}</Txt></Pressable>
        <Pressable onPress={() => { onClose(); onConfirm(); }} className="flex-1 h-11 rounded-full bg-danger items-center justify-center active:opacity-80"><Txt className="font-bold text-white">{confirmLabel}</Txt></Pressable>
      </View>
    </Sheet>
  );
}
