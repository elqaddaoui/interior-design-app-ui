import React from 'react';
import { RememberScroll } from '@/hooks/useViewState';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBp } from '@/hooks/useBp';

/** Page container: safe-area aware, scrollable, centred with a max width on large screens. */
export function Screen({ children, header, footer, scroll = true, max = 1100, padded = true, bottomInset = 0, className = '' }: {
  children?: React.ReactNode; header?: React.ReactNode; footer?: React.ReactNode; scroll?: boolean; max?: number; padded?: boolean; bottomInset?: number; className?: string;
}) {
  const insets = useSafeAreaInsets();
  const { tablet, desktop } = useBp();
  const px = padded ? (tablet ? 28 : 16) : 0;
  const body = (
    <View style={{ width: '100%', maxWidth: max, paddingHorizontal: px, alignSelf: 'center', flex: scroll ? undefined : 1 }} className={className}>{children}</View>
  );
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {header ? <View style={{ width: '100%', maxWidth: max, paddingHorizontal: px, alignSelf: 'center' }}>{header}</View> : null}
      {scroll ? (
        <RememberScroll style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: bottomInset + 24 }} showsVerticalScrollIndicator={desktop}>{body}</RememberScroll>
      ) : body}
      {footer ? (
        <View style={{ paddingBottom: Math.max(insets.bottom, 12), paddingTop: 10 }} className="bg-bg">
          <View style={{ width: '100%', maxWidth: Math.min(max, 720), paddingHorizontal: px, alignSelf: 'center' }}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}
