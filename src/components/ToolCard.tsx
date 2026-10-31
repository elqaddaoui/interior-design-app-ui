import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SearchTarget } from '@/hooks/useViewState';
import type { Lang, LText, Tool } from '@/data/types';
import { MediaView } from '@/components/ui/MediaView';
import { PressableScale } from '@/components/ui/PressableScale';
import { Txt } from '@/components/ui/Txt';
import { CardStage } from '@/components/toolcard/CardStage';
import i18n, { isRtl, useLang } from '@/i18n';
import { useStore } from '@/store/useStore';
import { GRADIENT_PAD, gradientFor, imageHeight, mediaFx, resolveGlobal, slideshowImages } from '@/lib/toolCards';

/** Text zone height guess used until the real zone has been measured (outside text mode). */
const ZONE_GUESS = 72;

/**
 * Home tool card: full-width rounded card with an image zone and a text zone.
 *  - Total height and text-zone side (top / bottom) are GLOBAL (`settings.toolCards`): every card reads the same values.
 *  - Media = image | video | slideshow (several images played with the 20 before/after effects). A slideshow keeps its own
 *    animation, text placement and gradient settings in `tool.media.fx`; image and video cards use the defaults.
 *  - Text = the tool's own title and subtitle + the app's own "Try" button (`common.try`). Nothing is added, nothing is hardcoded.
 *  - Direction and theme follow the app (language / theme). `lang` and `preview` exist only for the admin preview and never touch app state.
 */
export function ToolCard({ tool, onPress, index = 0, onReady, lang, preview, onEffect }: {
  tool: Tool; onPress: () => void; index?: number; onReady?: () => void;
  /** Admin simulation: render in this language instead of the app's. */
  lang?: Lang;
  /** Admin preview: always animates (no animation-slot limit), no entrance animation, no search highlight. */
  preview?: boolean;
  /** Admin preview: reports the effect now playing. */
  onEffect?: (effect: number) => void;
}) {
  const appLang = useLang((s) => s.lang);
  const language = lang ?? appLang;
  const rtl = isRtl(language);
  const pick = (v?: LText) => (v ? v[language] || v.fr || v.ar || v.dar || '' : '');
  const tryLabel = String(i18n.getFixedT(language)('common.try'));

  // GLOBAL layout (primitives, so a change of anything else never re-renders the card).
  const height = useStore((s) => resolveGlobal(s.doc.settings.toolCards).height);
  const zone = useStore((s) => resolveGlobal(s.doc.settings.toolCards).textZone);
  const fx = React.useMemo(() => mediaFx(tool.media), [tool.media]);
  const images = React.useMemo(() => slideshowImages(tool.media), [tool.media]);
  const inside = fx.textPlacement === 'inside';
  const [zoneH, setZoneH] = useState(ZONE_GUESS);
  const measure = useCallback((h: number) => setZoneH((old) => (Math.abs(old - h) < 0.5 ? old : h)), []);
  const imgH = imageHeight(height, inside, zoneH);

  const media = images.length > 0
    ? <CardStage id={tool.id} images={images} fx={fx} rtl={rtl} force={preview} onReady={onReady} onEffect={onEffect} style={{ height: imgH }} />
    // Image / video (or a slideshow with no picture yet): shown exactly as before.
    : <MediaView media={tool.media.type === 'slideshow' ? { type: 'image', uri: tool.media.uri } : tool.media} style={{ height: imgH }} priority={index < 2 ? 'high' : undefined} onReady={onReady} />;

  // Title + subtitle on one side, the existing button on the opposite side (the app's direction mirrors the row in RTL).
  const text = (white: boolean) => (
    <View className="flex-row items-center justify-between gap-2">
      <View className="flex-1">
        <Txt className={`${white ? 'text-white' : 'text-fg'} text-[18px] leading-[24px] font-extrabold`} numberOfLines={2} style={white ? { textShadowColor: 'rgba(0,0,0,.35)', textShadowRadius: 4 } : undefined}>{pick(tool.title)}</Txt>
        <Txt className={`${white ? 'text-white' : 'text-muted'} text-[12.5px] mt-0.5`} numberOfLines={2}>{pick(tool.subtitle)}</Txt>
      </View>
      <Pressable onPress={onPress} className="bg-primary rounded-full px-4 h-8 items-center justify-center active:opacity-80 shrink-0">
        <Txt className="text-onprimary font-bold text-[13px]">{tryLabel}</Txt>
      </Pressable>
    </View>
  );

  const g = gradientFor(fx.gradient, zone);
  const body = inside ? (
    <View className="rounded-2xl overflow-hidden bg-surface2" style={{ height }}>
      {media}
      {/* Transparent gradient anchored to the zone edge: fully transparent on the image side, never a solid strip. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { justifyContent: zone === 'bottom' ? 'flex-end' : 'flex-start' }]}>
        <View style={{ paddingHorizontal: 12, paddingTop: zone === 'bottom' ? GRADIENT_PAD : 12, paddingBottom: zone === 'bottom' ? 12 : GRADIENT_PAD }} pointerEvents="none">
          <LinearGradient colors={g.colors} locations={[...g.locations]} start={g.start} end={g.end} style={StyleSheet.absoluteFill} />
          {text(true)}
        </View>
      </View>
    </View>
  ) : (
    <View className="rounded-2xl overflow-hidden bg-surface border border-line" style={{ height, flexDirection: zone === 'top' ? 'column' : 'column-reverse' }}>
      <View onLayout={(e) => measure(e.nativeEvent.layout.height)} style={{ padding: 12 }}>{text(false)}</View>
      {/* Image zone takes what the text zone leaves (min 80px); the card keeps its fixed height. */}
      <View style={{ height: imgH }}>{media}</View>
    </View>
  );

  const card = (
    <PressableScale testID={`tool-${tool.id}`} onPress={onPress}>
      {body}
    </PressableScale>
  );
  // Only the admin simulation forces a direction; the real home inherits the app's direction from the root view.
  const dir = lang ? ({ direction: rtl ? 'rtl' : 'ltr' } as object) : undefined;
  if (preview) return <View style={dir}>{card}</View>;
  return (
    // The first two cards are the page's largest content: they appear immediately (an opacity fade would push back LCP).
    <SearchTarget id={tool.id}><Animated.View entering={index < 2 ? undefined : FadeInDown.delay(Math.min(index, 8) * 70).duration(380)} style={dir}>{card}</Animated.View></SearchTarget>
  );
}
