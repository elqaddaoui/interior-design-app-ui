import React, { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Icon } from './Icon';
import { useBp } from '@/hooks/useBp';
import { RememberScroll } from '@/hooks/useViewState';
import { useT } from '@/i18n';

/** Keep positive scroll coordinates in both languages; mirror only the RTL track. */
export function Carousel({ children, gap = 12 }: { children: React.ReactNode; gap?: number }) {
  const key = `carousel:${React.Children.toArray(children).map((child) => React.isValidElement(child) ? child.key : '').join(',')}`;
  const ref = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);
  const { desktop } = useBp();
  const { t, rtl } = useT();
  const max = Math.max(0, content - width);
  const handleScrollMove = useCallback((direction: number) => { ref.current?.scrollTo({ x: Math.min(max, Math.max(0, offset + direction * width * 0.8)), animated: true }); }, [max, offset, width]);
  return <View style={{ minWidth: 0, paddingHorizontal: desktop ? 24 : 0 }}>
    <RememberScroll stateKey={key} ref={ref} horizontal style={{ direction: 'ltr', transform: [{ scaleX: rtl ? -1 : 1 }] }} showsHorizontalScrollIndicator={false} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} onContentSizeChange={(w) => setContent(w)} onScroll={(e) => setOffset(e.nativeEvent.contentOffset.x)} scrollEventThrottle={16} contentContainerStyle={{ gap, paddingBottom: desktop ? 12 : 0 }}>
      {React.Children.map(children, (child) => <View style={{ transform: [{ scaleX: rtl ? -1 : 1 }], direction: rtl ? 'rtl' : 'ltr' }}>{child}</View>)}
    </RememberScroll>
    {desktop && max > 1 ? <>
      <Pressable testID="carousel-previous" accessibilityRole="button" accessibilityLabel={t('improve.previous')} disabled={offset <= 1} onPress={() => handleScrollMove(-1)} className="w-12 h-12 rounded-full border border-line bg-surface items-center justify-center" style={{ position: 'absolute', top: '50%', marginTop: -30, left: rtl ? undefined : 0, right: rtl ? 0 : undefined, opacity: offset <= 1 ? 0.4 : 1, boxShadow: '0 6px 24px rgba(0,0,0,0.14)' } as any}><Icon name={rtl ? 'chevron-right' : 'chevron-left'} size={26} /></Pressable>
      <Pressable testID="carousel-next" accessibilityRole="button" accessibilityLabel={t('improve.next')} disabled={offset >= max - 1} onPress={() => handleScrollMove(1)} className="w-12 h-12 rounded-full border border-line bg-surface items-center justify-center" style={{ position: 'absolute', top: '50%', marginTop: -30, left: rtl ? 0 : undefined, right: rtl ? undefined : 0, opacity: offset >= max - 1 ? 0.4 : 1, boxShadow: '0 6px 24px rgba(0,0,0,0.14)' } as any}><Icon name={rtl ? 'chevron-left' : 'chevron-right'} size={26} /></Pressable>
    </> : null}
  </View>;
}
