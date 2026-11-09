import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { InspirationCategory, Tool } from '@/data/types';
import { MediaView } from '@/components/ui/MediaView';
import { PressableScale } from '@/components/ui/PressableScale';
import { Txt } from '@/components/ui/Txt';
import { CardStage } from '@/components/toolcard/CardStage';
import { SearchTarget } from '@/hooks/useViewState';
import i18n, { isRtl, useL, useLang } from '@/i18n';
import { mediaFx, slideshowImages } from '@/lib/toolCards';
import { Poster, usePreview } from './Motion';

/**
 * The picture side of a tool tile (no press handling): the tool's slideshow / video / image filling the tile, title + subtitle on a gradient.
 * `still` shows one static picture instead of the live slideshow (used where tiles are moved in 3D, so the GPU only has one thing to do).
 * Without `height` the face fills its parent (`flex: 1`).
 */
export function ToolMedia({ tool, index = 0, still, onReady }: { tool: Tool; index?: number; still?: boolean; onReady?: () => void }) {
  const lang = useLang((s) => s.lang);
  const inPreview = usePreview();
  const fx = React.useMemo(() => mediaFx(tool.media), [tool.media]);
  const images = React.useMemo(() => slideshowImages(tool.media), [tool.media]);
  if (still ?? inPreview) return <Poster tool={tool} style={StyleSheet.absoluteFill} priority={index < 2 ? 'high' : undefined} onReady={onReady} />;
  return images.length > 0
    ? <CardStage images={images} fx={fx} rtl={isRtl(lang)} first={index === 0} video={tool.media.video ? { uri: tool.media.video, sig: tool.media.videoSig } : undefined} onReady={onReady} style={StyleSheet.absoluteFill} />
    : <MediaView media={tool.media.type === 'slideshow' ? { type: 'image', uri: tool.media.uri } : tool.media} style={StyleSheet.absoluteFill} priority={index < 2 ? 'high' : undefined} onReady={onReady} />;
}

/**
 * The picture side of a tool tile (no press handling): the tool's slideshow / video / image filling the tile, title + subtitle on a gradient.
 * `still` shows one static picture instead of the live slideshow (used where tiles are moved in 3D, so the GPU only has one thing to do).
 * Without `height` the face fills its parent (`flex: 1`).
 */
export function ToolFace({ tool, height, radius, index = 0, compact, onReady, still, big, badge = true }: {
  tool: Tool; height?: number; radius: number; index?: number; compact?: boolean; onReady?: () => void; still?: boolean; big?: boolean; badge?: boolean;
}) {
  const lang = useLang((s) => s.lang);
  const pick = (v?: Tool['title']) => (v ? v[lang] || v.fr || v.ar || v.dar || '' : '');
  const tryLabel = String(i18n.getFixedT(lang)('common.try'));
  return (
    <View className="overflow-hidden bg-surface2" style={[{ borderRadius: radius }, height ? { height } : { flex: 1 }]}>
      <ToolMedia tool={tool} index={index} still={still} onReady={onReady} />
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.68)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: compact ? '60%' : '70%' }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: compact ? 10 : big ? 22 : 14 }}>
        <Txt className="text-white font-extrabold" style={{ fontSize: compact ? 14 : big ? 30 : 19, lineHeight: compact ? 19 : big ? 36 : 25, textShadowColor: 'rgba(0,0,0,.35)', textShadowRadius: 4 }} numberOfLines={2}>{pick(tool.title)}</Txt>
        {!compact && tool.subtitle ? <Txt className="text-white mt-0.5" style={{ fontSize: big ? 15 : 12.5, opacity: 0.92 }} numberOfLines={2}>{pick(tool.subtitle)}</Txt> : null}
      </View>
      {!compact && badge ? <View pointerEvents="none" className="bg-primary rounded-full px-3 h-7 items-center justify-center" style={{ position: 'absolute', top: 12, end: 12 } as any}><Txt className="text-onprimary font-bold text-[12px]">{tryLabel}</Txt></View> : null}
    </View>
  );
}

/** Free-size tool tile for the demo layouts: a pressable `ToolFace`. */
export function ToolTile({ tool, height, radius, onPress, index = 0, compact, onReady, search = true }: {
  tool: Tool; height: number; radius: number; onPress: () => void; index?: number; compact?: boolean; onReady?: () => void; search?: boolean;
}) {
  const lang = useLang((s) => s.lang);
  const label = tool.title ? tool.title[lang] || tool.title.fr || tool.title.ar || tool.title.dar || '' : '';
  const body = (
    <PressableScale testID={`tool-${tool.id}`} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <ToolFace tool={tool} height={height} radius={radius} index={index} compact={compact} onReady={onReady} />
    </PressableScale>
  );
  return search ? <SearchTarget id={tool.id}>{body}</SearchTarget> : body;
}

/** The picture side of an Explore category tile (no press handling). Without `height` (and not `square`) it fills its parent. */
export function CatFace({ cat, count, height, radius, caption = 'inside', square, large }: {
  cat: InspirationCategory; count: number; height?: number; radius: number; caption?: 'inside' | 'below'; square?: boolean; large?: boolean;
}) {
  const L = useL();
  const size = square ? { aspectRatio: 1 } : height ? { height } : { flex: 1 };
  return (
    <View style={height || square ? undefined : { flex: 1 }}>
      <MediaView uri={cat.cover} style={[{ width: '100%', borderRadius: radius }, size]}>
        {caption === 'inside' ? <>
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '65%' }} />
          <View pointerEvents="none" className="absolute inset-0 justify-end" style={{ padding: large ? 18 : 12 }}>
            <Txt className="text-white font-bold" style={{ fontSize: large ? 15 : 12.5, opacity: 0.9 }}>+{count}</Txt>
            <Txt className="text-white font-black" style={{ fontSize: large ? 26 : 16, lineHeight: large ? 32 : 21 }} numberOfLines={2}>{L(cat.title)}</Txt>
          </View>
        </> : null}
      </MediaView>
      {caption === 'below' ? <View className="pt-2 px-0.5">
        <Txt className="font-extrabold text-[15px]" numberOfLines={1}>{L(cat.title)}</Txt>
        <Txt className="text-muted text-[12.5px]" numberOfLines={1}>+{count}</Txt>
      </View> : null}
    </View>
  );
}

/** Free-size Explore category tile: a pressable `CatFace`. `caption='below'` puts the title under the picture (Airbnb / Houzz style) instead of over it. */
export function CategoryTile({ cat, count, height, radius, onPress, caption = 'inside', square, large }: {
  cat: InspirationCategory; count: number; height?: number; radius: number; onPress: () => void; caption?: 'inside' | 'below'; square?: boolean; large?: boolean;
}) {
  const L = useL();
  return (
    <PressableScale testID={`cat-${cat.id}`} accessibilityRole="button" accessibilityLabel={L(cat.title)} onPress={onPress}>
      <CatFace cat={cat} count={count} height={height} radius={radius} caption={caption} square={square} large={large} />
    </PressableScale>
  );
}
