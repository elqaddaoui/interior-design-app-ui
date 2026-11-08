import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '@/store/useToast';
import { Txt } from './Txt';

export function ToastHost() {
  const { msg, id, action, dismiss } = useToast();
  const [expired, setExpired] = React.useState(0);
  const visible = !!msg && expired !== id;
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setExpired(id), action ? 6000 : 2400);
    return () => clearTimeout(t);
  }, [id, msg, action]);
  if (!visible) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 96 + insets.bottom, alignItems: 'center', zIndex: 999 }}>
      <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(180)} className="bg-ink rounded-full max-w-[90%] flex-row items-center" style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 14 }}>
        <Txt testID="toast-message" className="text-onink font-semibold text-[14px] text-center flex-shrink">{msg}</Txt>
        {action ? (
          <Pressable testID="toast-action" accessibilityRole="button" hitSlop={8} onPress={() => { const run = action.run; dismiss(); run(); }} className="active:opacity-70">
            <Txt className="text-onink font-black text-[14px] underline">{action.label}</Txt>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}
