import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, cancelAnimation, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import type { InspirationCategory } from '@/data/types';
import { Carousel } from '@/components/ui/Carousel';
import { Icon } from '@/components/ui/Icon';
import { MediaView } from '@/components/ui/MediaView';
import { Txt } from '@/components/ui/Txt';
import { useL, useT } from '@/i18n';
import { columnsFor } from '@/lib/layouts';
import type { ExploreLayoutProps } from './ExploreLayouts';
import { Coverflow, blur, useMotion } from './Motion';
import { CatFace } from './Tiles';
import { SectionHead, countOf, openCat } from './shared';

const web = typeof document !== 'undefined';
const lift = (px: number) => (web ? ({ boxShadow: `0 ${px}px ${px * 2.4}px rgba(0,0,0,0.32)` } as object) : { elevation: Math.round(px / 2) });

/* ============================================================== 1. Coverflow ============================================================== */
/** One 3D coverflow per section, on a dark stage lit by the blurred cover of the category in front. */
export function FlowLayout({ params, device, sections, categories, items }: ExploreLayoutProps) {
  const L = useL(); const { t } = useT();
  const desktop = device === 'desktop';
  const H = (desktop ? params.heightD : params.heightM) ?? (desktop ? 340 : 280);
  const radius = params.radius ?? 22;
  const itemW = Math.round(H * (desktop ? 0.82 : 0.74));
  return <>{sections.map((sec) => {
    const list = categories.filter((c) => c.sectionId === sec.id);
    if (!list.length) return null;
    return (
      <View key={sec.id} className="mt-5">
        <SectionHead sec={sec} big={desktop} />
        <FlowStage list={list} H={H} itemW={itemW} radius={radius} desktop={desktop} L={L} more={t('common.seeAll')} count={(c) => countOf(items, c)} />
      </View>
    );
  })}</>;
}
function FlowStage({ list, H, itemW, radius, desktop, L, count }: { list: InspirationCategory[]; H: number; itemW: number; radius: number; desktop: boolean; L: (v: InspirationCategory['title']) => string; more: string; count: (c: InspirationCategory) => number }) {
  const [cur, setCur] = React.useState(list.length > 2 ? 1 : 0);
  const active = list[Math.min(cur, list.length - 1)];
  const flow = list.map((c) => ({ key: c.id, testID: `cat-${c.id}`, onPress: () => openCat(c), render: () => <CatFace cat={c} count={count(c)} radius={radius} large={desktop} /> }));
  return (
    <View style={{ borderRadius: radius + 10, overflow: 'hidden', backgroundColor: '#090b12', paddingVertical: 18 }}>
      <Animated.View key={active.id} entering={FadeIn.duration(700)} exiting={FadeOut.duration(700)} pointerEvents="none" style={[StyleSheet.absoluteFill, blur(50), { opacity: 0.55, transform: [{ scale: 1.5 }] }]}>
        <MediaView uri={active.cover} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <LinearGradient pointerEvents="none" colors={['rgba(9,11,18,0.1)', 'rgba(9,11,18,0.85)']} style={StyleSheet.absoluteFill} />
      <Coverflow dark items={flow} itemW={itemW} height={H} onChange={setCur} auto={0}
        caption={(i) => { const c = list[i] ?? active; return (
          <Animated.View key={c.id} entering={FadeInDown.duration(360)} style={{ alignItems: 'center' }}>
            <Txt className="text-white font-black" style={{ fontSize: desktop ? 26 : 20 }} numberOfLines={1}>{L(c.title)}</Txt>
            <Txt className="text-white text-[13px]" style={{ opacity: 0.7 }}>+{count(c)}</Txt>
          </Animated.View>
        ); }} />
    </View>
  );
}

/* ============================================================== 2. Polaroid ============================================================== */
const TILT = [-4.5, 3, -2, 5, -3.5, 2.2, -5, 3.8];
function Polaroid({ cat, count, size, i, onPress }: { cat: InspirationCategory; count: number; size: number; i: number; onPress: () => void }) {
  const L = useL();
  const motion = useMotion();
  const up = useSharedValue(0);
  const rot = TILT[i % TILT.length];
  const a = useAnimatedStyle(() => ({ zIndex: Math.round(up.get() * 10), transform: [{ rotate: `${interpolate(up.get(), [0, 1], [rot, 0])}deg` }, { scale: 1 + up.get() * 0.1 }, { translateY: -up.get() * 10 }] }));
  const hover = motion && web ? { onPointerEnter: () => up.set(withSpring(1, { damping: 14 })), onPointerLeave: () => up.set(withSpring(0)) } : {};
  const card = (
    <Animated.View style={[{ width: size }, a]} {...(hover as object)}>
      <Pressable testID={`cat-${cat.id}`} accessibilityRole="button" accessibilityLabel={L(cat.title)} onPress={onPress} onPressIn={() => up.set(withSpring(1, { damping: 14 }))} onPressOut={() => up.set(withSpring(0))}>
        <View style={[{ backgroundColor: '#fbfaf6', padding: Math.max(8, size * 0.06), paddingBottom: 0, borderRadius: 4 }, lift(10)]}>
          <MediaView uri={cat.cover} style={{ width: '100%', aspectRatio: 1, borderRadius: 2 }} />
          <View style={{ height: Math.max(40, size * 0.26), justifyContent: 'center', alignItems: 'center' }}>
            <Txt className="font-black" style={{ color: '#1c1b17', fontSize: size > 170 ? 16 : 13.5 }} numberOfLines={1}>{L(cat.title)}</Txt>
            <Txt style={{ color: '#7d7a70', fontSize: 11.5 }}>+{count}</Txt>
          </View>
          <View pointerEvents="none" style={{ position: 'absolute', top: -9, alignSelf: 'center', width: 54, height: 18, backgroundColor: 'rgba(255,226,140,0.78)', transform: [{ rotate: `${-rot * 1.4}deg` }] }} />
        </View>
      </Pressable>
    </Animated.View>
  );
  return card;
}

/** A pinboard: category photos as slightly rotated polaroids with tape; hover / press straightens and lifts one. */
export function PolaroidLayout({ params, device, tablet, sections, categories, items }: ExploreLayoutProps) {
  const gap = params.gap ?? 18;
  const desktop = device === 'desktop';
  const cols = columnsFor(device, tablet, params, 2, 4);
  const [w, setW] = React.useState(0);
  const size = w ? Math.floor((w - gap * (cols - 1) - 12) / cols) : 0;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {sections.map((sec) => (
        <View key={sec.id} className="mt-5">
          <SectionHead sec={sec} big={desktop} />
          <View style={{ borderRadius: 26, padding: 6, paddingTop: 16, backgroundColor: 'rgba(160,120,70,0.10)', overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, paddingBottom: 6, justifyContent: 'center' }}>
              {size > 0 ? categories.filter((c) => c.sectionId === sec.id).map((c, i) => <Polaroid key={c.id} cat={c} count={countOf(items, c)} size={size} i={i} onPress={() => openCat(c)} />) : null}
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

/* ============================================================== 3. Spotlight ============================================================== */
function KenBurns({ uri, run }: { uri: string; run: boolean }) {
  const p = useSharedValue(0);
  React.useEffect(() => {
    if (!run) return;
    p.set(withRepeat(withTiming(1, { duration: 14000, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(p);
  }, [run, p]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: 1.04 + p.get() * 0.14 }, { translateX: interpolate(p.get(), [0, 1], [-10, 10]) }, { translateY: interpolate(p.get(), [0, 1], [6, -6]) }] }));
  return <Animated.View style={[StyleSheet.absoluteFill, a]}><MediaView uri={uri} style={StyleSheet.absoluteFill} priority="high" /></Animated.View>;
}

function Spot({ list, H, radius, desktop, count }: { list: InspirationCategory[]; H: number; radius: number; desktop: boolean; count: (c: InspirationCategory) => number }) {
  const L = useL(); const { t } = useT();
  const motion = useMotion();
  const [i, setI] = React.useState(0);
  const cat = list[Math.min(i, list.length - 1)];
  const thumb = desktop ? 92 : 68;
  return (
    <View>
      <View testID="spot-stage" style={[{ height: H, borderRadius: radius, overflow: 'hidden', backgroundColor: '#000' }, lift(14)]}>
        <Animated.View key={cat.id} entering={FadeIn.duration(450)} style={StyleSheet.absoluteFill}><KenBurns uri={cat.cover} run={motion} /></Animated.View>
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' }} />
        <Animated.View key={`t-${cat.id}`} entering={FadeInDown.delay(150).duration(450)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: desktop ? 32 : 18 }}>
          <Txt className="text-white font-bold" style={{ fontSize: 13, opacity: 0.85, letterSpacing: 1.5 }}>{String(i + 1).padStart(2, '0')} · +{count(cat)}</Txt>
          <Txt className="text-white font-black" style={{ fontSize: desktop ? 44 : 28, lineHeight: desktop ? 50 : 34 }} numberOfLines={2}>{L(cat.title)}</Txt>
          <Pressable testID={`cat-${cat.id}`} accessibilityRole="button" onPress={() => openCat(cat)} className="self-start rounded-full bg-white px-5 h-10 flex-row items-center gap-2 mt-3">
            <Txt className="font-extrabold text-[13.5px]" style={{ color: '#000' }}>{t('common.seeAll')}</Txt>
            <Icon name="arrow-right" size={17} color="#000" flip />
          </Pressable>
        </Animated.View>
      </View>
      <View style={{ marginTop: 12, marginHorizontal: desktop ? -24 : 0 }}>
        <Carousel gap={10}>
          {list.map((c, k) => (
            <Pressable key={c.id} testID={`spot-thumb-${c.id}`} accessibilityRole="button" accessibilityLabel={L(c.title)} onPress={() => setI(k)} style={{ opacity: k === i ? 1 : 0.55 }}>
              <View className={k === i ? 'border-2 border-primary' : 'border-2 border-transparent'} style={{ width: thumb * 1.35, height: thumb, borderRadius: 16, overflow: 'hidden' }}>
                <MediaView uri={c.cover} style={StyleSheet.absoluteFill} />
              </View>
            </Pressable>
          ))}
        </Carousel>
      </View>
    </View>
  );
}

/** A cinematic stage per section: the chosen category fills it with a slow Ken Burns zoom and big type; a strip of thumbnails changes the scene. */
export function SpotlightLayout({ params, device, sections, categories, items }: ExploreLayoutProps) {
  const desktop = device === 'desktop';
  const H = (desktop ? params.heightD : params.heightM) ?? (desktop ? 460 : 340);
  const radius = params.radius ?? 28;
  return <>{sections.map((sec) => {
    const list = categories.filter((c) => c.sectionId === sec.id);
    if (!list.length) return null;
    return (
      <View key={sec.id} className="mt-5">
        <SectionHead sec={sec} big={desktop} />
        <Spot list={list} H={H} radius={radius} desktop={desktop} count={(c) => countOf(items, c)} />
      </View>
    );
  })}</>;
}

/* ============================================================== 4. Accordion ============================================================== */
function Panel({ cat, count, open, vertical, H, closed, radius, i, onSelect }: { cat: InspirationCategory; count: number; open: boolean; vertical: boolean; H: number; closed: number; radius: number; i: number; onSelect: () => void }) {
  const L = useL();
  const o = useSharedValue(open ? 1 : 0);
  React.useEffect(() => { o.set(withSpring(open ? 1 : 0, { damping: 18, stiffness: 120 })); }, [open, o]);
  const a = useAnimatedStyle(() => (vertical ? { height: interpolate(o.get(), [0, 1], [closed, H]) } : { flexGrow: interpolate(o.get(), [0, 1], [1, 5.2]) }));
  const fade = useAnimatedStyle(() => ({ opacity: o.get(), transform: [{ translateY: (1 - o.get()) * 14 }] }));
  const dim = useAnimatedStyle(() => ({ opacity: 0.58 * (1 - o.get()) }));
  return (
    <Animated.View style={[{ borderRadius: radius, overflow: 'hidden', ...(vertical ? null : { flexBasis: 0, minWidth: 0 }) }, a]}>
      <Pressable testID={`acc-${cat.id}`} accessibilityRole="button" accessibilityLabel={L(cat.title)} aria-expanded={open} onPress={onSelect} style={{ flex: 1 }}>
        <View style={{ position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, ...(vertical ? { height: H } : null) }}><MediaView uri={cat.cover} style={StyleSheet.absoluteFill} /></View>
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '75%' }} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, dim]} />
        {vertical ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, top: 0, height: closed, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Txt className="text-white font-black" style={{ fontSize: 15, opacity: 0.75 }}>{String(i + 1).padStart(2, '0')}</Txt>
            <Txt className="text-white font-black flex-1" style={{ fontSize: 17 }} numberOfLines={1}>{L(cat.title)}</Txt>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color="#fff" />
          </View>
        ) : (
          <View pointerEvents="none" style={{ position: 'absolute', top: 14, left: 0, right: 0, alignItems: 'center' }}><Txt className="text-white font-black" style={{ fontSize: 18, opacity: 0.8 }}>{String(i + 1).padStart(2, '0')}</Txt></View>
        )}
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: vertical ? 16 : 22 }, fade]}>
          <Txt className="text-white font-bold" style={{ fontSize: 13, opacity: 0.85 }}>+{count}</Txt>
          <Txt className="text-white font-black" style={{ fontSize: vertical ? 24 : 32, lineHeight: vertical ? 30 : 38 }} numberOfLines={2}>{L(cat.title)}</Txt>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

function Acc({ list, H, gap, radius, desktop, count }: { list: InspirationCategory[]; H: number; gap: number; radius: number; desktop: boolean; count: (c: InspirationCategory) => number }) {
  const [open, setOpen] = React.useState(0);
  const vertical = !desktop;
  const onSelect = (k: number) => () => { if (k === open) openCat(list[k]); else setOpen(k); };
  const closed = 58;
  return (
    <View style={vertical ? { gap } : { flexDirection: 'row', gap, height: H }}>
      {list.map((c, k) => <Panel key={c.id} cat={c} count={count(c)} open={k === open} vertical={vertical} H={H} closed={closed} radius={radius} i={k} onSelect={onSelect(k)} />)}
    </View>
  );
}

/** Expanding panels: one category open and tall, the others folded into slim strips; tap to open one, tap the open one to enter it. */
export function AccordionLayout({ params, device, sections, categories, items }: ExploreLayoutProps) {
  const desktop = device === 'desktop';
  const gap = params.gap ?? 10; const radius = params.radius ?? 22;
  const H = (desktop ? params.heightD : params.heightM) ?? (desktop ? 380 : 230);
  return <>{sections.map((sec) => {
    const list = categories.filter((c) => c.sectionId === sec.id);
    if (!list.length) return null;
    return (
      <View key={sec.id} className="mt-5">
        <SectionHead sec={sec} big={desktop} />
        <Acc list={list} H={H} gap={gap} radius={radius} desktop={desktop} count={(c) => countOf(items, c)} />
      </View>
    );
  })}</>;
}
