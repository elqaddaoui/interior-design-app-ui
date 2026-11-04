import React from 'react';
import { Modal, Platform, Pressable, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBackCheckpoint, useNativeOverlayBack } from '@/hooks/useLeaveGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n';
import { saveImage } from '@/lib/share';
import { toast } from '@/store/useToast';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import { Txt } from './Txt';

export interface ViewerItem { uri: string; label?: string }

function NativeBoundary({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useNativeOverlayBack(visible, onClose);
  return null;
}

type Size = { w: number; h: number };

/** One page: the picture at its natural size (never enlarged, shrunk only to fit the screen). `actual` = 1:1 pixels, scrollable. */
function Page({ item, width, height, actual, onSize, onZoom }: { item: ViewerItem; width: number; height: number; actual: boolean; onSize: (size: Size) => void; onZoom: () => void }) {
  const [size, setSize] = React.useState<Size | null>(null);
  const [failed, setFailed] = React.useState(false);
  const { t } = useT();
  const fit = size ? Math.min(1, width / size.w, height / size.h) : 1;
  const shown = size ? { width: Math.round(size.w * fit), height: Math.round(size.h * fit) } : { width, height };
  const image = (
    <Image
      source={{ uri: item.uri }}
      testID="viewer-image"
      style={actual && size ? { width: size.w, height: size.h } : shown}
      contentFit="contain"
      transition={0}
      onLoad={(e) => { const next = { w: e.source.width, h: e.source.height }; setSize(next); onSize(next); }}
      onError={() => setFailed(true)}
    />
  );
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      {!size && !failed ? <View style={{ position: 'absolute' }}><Spinner /></View> : null}
      {failed ? <Txt className="text-white text-[14px]">{t('improve.videoError')}</Txt> : actual && size ? (
        <ScrollView style={{ width, height }} contentContainerStyle={{ minWidth: width, minHeight: height, alignItems: 'center', justifyContent: 'center' }} horizontal={false} nestedScrollEnabled bounces={false}>
          <ScrollView horizontal nestedScrollEnabled bounces={false} contentContainerStyle={{ minWidth: width, alignItems: 'center', justifyContent: 'center' }}>{image}</ScrollView>
        </ScrollView>
      ) : (
        <Pressable onPress={onZoom} accessibilityRole="imagebutton" accessibilityLabel={t('md.viewer.actual')}>{image}</Pressable>
      )}
    </View>
  );
}

/**
 * Full-screen picture viewer shared by the admin (request photo / AI result / final design) and the chat.
 * - opens at the tapped picture, shown at its exact original size (only shrunk when it would not fit the screen)
 * - swipe left/right (or the arrows / arrow keys on a computer) to move to the other picture(s) of the set
 * - the zoom button (or a tap on the picture) toggles real 1:1 pixels, scrollable
 */
export function ImageViewer({ items, index, onIndexChange, onClose }: { items: ViewerItem[]; index: number | null; onIndexChange?: (index: number) => void; onClose: () => void }) {
  const visible = index != null && items.length > 0;
  useBackCheckpoint(visible, onClose, 3);
  const { style, colors } = useTheme();
  const { rtl, t } = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scroller = React.useRef<ScrollView>(null);
  const [current, setCurrent] = React.useState(index ?? 0);
  const [actual, setActual] = React.useState(false);
  const [sizes, setSizes] = React.useState<Record<number, Size>>({});
  const top = Math.max(insets.top, 8) + 52, bottom = Math.max(insets.bottom, 8) + 56;
  const pageHeight = Math.max(200, height - top - bottom + 40);
  // The scroll offset of page n. A horizontal ScrollView in an RTL layout starts from the right edge on the web.
  const offsetOf = React.useCallback((n: number) => (Platform.OS === 'web' && rtl ? -n * width : n * width), [rtl, width]);

  const go = React.useCallback((n: number, animated = true) => {
    const next = Math.max(0, Math.min(items.length - 1, n));
    setCurrent(next); setActual(false); onIndexChange?.(next);
    scroller.current?.scrollTo({ x: offsetOf(next), animated });
  }, [items.length, offsetOf, onIndexChange]);

  // Opening (or switching the tapped picture): jump to it without animation.
  React.useEffect(() => {
    if (index == null) return;
    setCurrent(index); setActual(false);
    const timer = setTimeout(() => scroller.current?.scrollTo({ x: offsetOf(index), animated: false }), 0);
    return () => clearTimeout(timer);
  }, [index, offsetOf, width]);

  React.useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') go(current + (rtl ? -1 : 1));
      else if (event.key === 'ArrowLeft') go(current + (rtl ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, current, go, onClose, rtl]);

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const raw = event.nativeEvent.contentOffset.x;
    const n = Math.max(0, Math.min(items.length - 1, Math.round(Math.abs(raw) / width)));
    if (n !== current) { setCurrent(n); setActual(false); onIndexChange?.(n); }
  };

  if (!visible) return null;
  const item = items[Math.min(current, items.length - 1)];
  const size = sizes[current];
  const many = items.length > 1;
  const save = async () => { toast((await saveImage(item.uri)) ? t('md.viewer.saved') : t('md.viewer.saveFailed')); };
  const arrow = (dir: -1 | 1) => {
    const target = current + dir;
    if (!many || target < 0 || target >= items.length || width < 520) return null;
    // Logical direction: "next" is on the reading-end side; physical left/right follow the scroll direction used above.
    const physicalRight = (dir === 1) !== (Platform.OS === 'web' && rtl);
    return (
      <Pressable testID={dir === 1 ? 'viewer-next' : 'viewer-prev'} accessibilityRole="button" accessibilityLabel={dir === 1 ? t('md.viewer.next') : t('md.viewer.prev')} onPress={() => go(target)}
        style={{ position: 'absolute', top: '50%', marginTop: -22, [physicalRight ? 'right' : 'left']: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={physicalRight ? 'chevron-right' : 'chevron-left'} size={26} color="#fff" />
      </Pressable>
    );
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[style, { flex: 1, backgroundColor: '#000', direction: rtl ? 'rtl' : 'ltr' } as any]} testID="image-viewer">
        <NativeBoundary visible={visible} onClose={onClose} />
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3, paddingTop: Math.max(insets.top, 8), paddingHorizontal: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <Pressable testID="viewer-close" accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={22} color="#fff" /></Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt className="text-white text-[15px] leading-[21px] font-bold" numberOfLines={1}>{item.label || ' '}</Txt>
            {many ? <Txt className="text-[12px] leading-[17px]" style={{ color: 'rgba(255,255,255,0.7)' }}>{current + 1} / {items.length}</Txt> : null}
          </View>
          <Pressable testID="viewer-save" accessibilityRole="button" accessibilityLabel={t('md.viewer.save')} onPress={save} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}><Icon name="download-outline" size={21} color="#fff" /></Pressable>
        </View>
        <View style={{ flex: 1, marginTop: top - 40, marginBottom: bottom - 40 }}>
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            scrollEnabled={many && !actual}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
            onScrollEndDrag={Platform.OS === 'web' ? onScrollEnd : undefined}
            scrollEventThrottle={32}
            keyboardShouldPersistTaps="handled"
            testID="viewer-pager"
          >
            {items.map((entry, i) => (
              <Page key={`${i}:${entry.uri}`} item={entry} width={width} height={pageHeight} actual={actual && i === current}
                onSize={(next) => setSizes((all) => (all[i]?.w === next.w && all[i]?.h === next.h ? all : { ...all, [i]: next }))}
                onZoom={() => setActual(true)} />
            ))}
          </ScrollView>
          {arrow(-1)}{arrow(1)}
        </View>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.55)' }}>
          {many ? (
            <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
              {items.map((entry, i) => <Pressable key={i} testID={`viewer-dot-${i}`} accessibilityRole="button" accessibilityLabel={entry.label || String(i + 1)} onPress={() => go(i)} hitSlop={8} style={{ width: i === current ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === current ? colors.primary : 'rgba(255,255,255,0.4)' }} />)}
            </View>
          ) : null}
          <Txt className="text-[12px] leading-[18px]" style={{ color: 'rgba(255,255,255,0.75)' }} testID="viewer-size">{size ? `${size.w} × ${size.h}px` : ''}</Txt>
          <Pressable testID="viewer-zoom" accessibilityRole="button" accessibilityLabel={actual ? t('md.viewer.fit') : t('md.viewer.actual')} onPress={() => setActual((v) => !v)} hitSlop={8} style={{ height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
            <Icon name={actual ? 'fit-to-screen-outline' : 'magnify-plus-outline'} size={18} color="#fff" />
            <Txt className="text-white text-[12px] leading-[18px] font-bold">{actual ? t('md.viewer.fit') : t('md.viewer.actual')}</Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
