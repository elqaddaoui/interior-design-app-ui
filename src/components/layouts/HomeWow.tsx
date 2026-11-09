import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, Easing } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import type { Tool } from '@/data/types';
import { Carousel } from '@/components/ui/Carousel';
import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/ui/PressableScale';
import { Txt } from '@/components/ui/Txt';
import { SearchTarget } from '@/hooks/useViewState';
import { useL, useT } from '@/i18n';
import { columnsFor } from '@/lib/layouts';
import type { HomeLayoutProps } from './HomeLayouts';
import { Aurora, Coverflow, Float, Poster, StoryBars, Tilt, blur, useMotion, useSign } from './Motion';
import { ToolFace, ToolMedia } from './Tiles';
import { useTheme } from '@/theme/ThemeProvider';

const web = typeof document !== 'undefined';
const paintOf = (onPaint: ((i: number) => void) | undefined, i: number) => (i < 2 && onPaint ? () => onPaint(i) : undefined);

/** "Try" call-to-action pill used by the cinematic layouts. */
function Cta({ onPress, testID, light }: { onPress: () => void; testID?: string; light?: boolean }) {
  const { t } = useT();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} className={`rounded-full px-6 h-11 flex-row items-center justify-center gap-2 ${light ? 'bg-white' : 'bg-primary'}`} style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.35)' } as any}>
      <Txt className={`font-extrabold text-[14px] ${light ? 'text-black' : 'text-onprimary'}`}>{t('common.try')}</Txt>
      <Icon name="arrow-right" size={18} color={light ? '#000' : undefined} tone="onprimary" flip />
    </Pressable>
  );
}

/* ============================================================== 1. Coverflow ============================================================== */
/** 3D coverflow on a dark stage lit by the colours of the tool in front of you (Apple Music / Cover Flow). */
export function FlowLayout({ params, device, tools, onOpen, onPaint }: HomeLayoutProps) {
  const L = useL();
  const desktop = device === 'desktop';
  const H = (desktop ? params.heightD : params.heightM) ?? (desktop ? 420 : 340);
  const radius = params.radius ?? 24;
  const itemW = Math.round(H * (desktop ? 1.0 : 0.74));
  const [cur, setCur] = React.useState(tools.length > 2 ? 1 : 0);
  const active = tools[Math.min(cur, tools.length - 1)];
  if (!active) return null;
  const items = tools.map((tool, i) => ({ key: tool.id, testID: `tool-${tool.id}`, onPress: () => onOpen(tool.id), render: () => <ToolFace tool={tool} radius={radius} index={i} still badge={false} onReady={paintOf(onPaint, i)} /> }));
  return (
    <View style={{ borderRadius: radius + 10, overflow: 'hidden', backgroundColor: '#090b12', paddingTop: 22, paddingBottom: 22 }}>
      <Animated.View key={active.id} entering={FadeIn.duration(700)} exiting={FadeOut.duration(700)} pointerEvents="none" style={[StyleSheet.absoluteFill, blur(50), { opacity: 0.6, transform: [{ scale: 1.5 }] }]}>
        <Poster tool={active} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <LinearGradient pointerEvents="none" colors={['rgba(9,11,18,0.15)', 'rgba(9,11,18,0.85)']} style={StyleSheet.absoluteFill} />
      <Coverflow dark items={items} itemW={itemW} height={H} onChange={setCur}
        caption={(i) => {
          const tool = tools[i] ?? active;
          return (
            <Animated.View key={tool.id} entering={FadeInDown.duration(380)} style={{ alignItems: 'center', paddingHorizontal: 20, maxWidth: 560 }}>
              <Txt className="text-white font-black" style={{ fontSize: desktop ? 32 : 23, textAlign: 'center' }} numberOfLines={1}>{L(tool.title)}</Txt>
              {tool.subtitle ? <Txt className="text-white mt-1" style={{ fontSize: desktop ? 15 : 13.5, opacity: 0.78, textAlign: 'center' }} numberOfLines={2}>{L(tool.subtitle)}</Txt> : null}
              <View style={{ marginTop: 14 }}><Cta testID="flow-open" light onPress={() => onOpen(tool.id)} /></View>
            </Animated.View>
          );
        }} />
    </View>
  );
}

/* ============================================================== 2. Stories ============================================================== */
function Ring({ tool, active, size, onPress, index }: { tool: Tool; active: boolean; size: number; onPress: () => void; index: number }) {
  const L = useL();
  const d = size + 10;
  return (
    <Pressable testID={`story-ring-${tool.id}`} accessibilityRole="button" accessibilityLabel={L(tool.title)} onPress={onPress} style={{ width: d + 8, alignItems: 'center' }}>
      <LinearGradient colors={active ? ['#feda75', '#fa7e1e', '#d62976', '#962fbf'] : ['rgba(128,128,128,0.4)', 'rgba(128,128,128,0.4)']} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={{ width: d, height: d, borderRadius: d, alignItems: 'center', justifyContent: 'center' }}>
        <View className="bg-bg" style={{ width: d - 5, height: d - 5, borderRadius: d, alignItems: 'center', justifyContent: 'center' }}>
          <Poster tool={tool} priority={index < 3 ? 'high' : undefined} style={{ width: size - 2, height: size - 2, borderRadius: size }} />
        </View>
      </LinearGradient>
      <Txt className={`mt-1.5 text-[11.5px] ${active ? 'font-extrabold' : 'text-muted'}`} numberOfLines={1} style={{ maxWidth: d + 6 }}>{L(tool.title)}</Txt>
    </Pressable>
  );
}

/** Instagram-style stories: a ring per tool on top, then one full-bleed story with progress bars; tap the sides to move, hold to pause. */
export function StoriesLayout({ params, device, tools, onOpen, onPaint }: HomeLayoutProps) {
  const L = useL();
  const sign = useSign();
  const motion = useMotion();
  const desktop = device === 'desktop';
  const H = (desktop ? params.heightD : params.heightM) ?? (desktop ? 480 : 440);
  const radius = params.radius ?? 28;
  const list = tools.slice(0, 8);
  const n = list.length;
  const [idx, setIdx] = React.useState(0);
  const [hold, setHold] = React.useState(false);
  const go = React.useCallback((to: number) => setIdx(((to % n) + n) % n), [n]);
  const tool = list[idx];
  if (!tool) return null;
  const zones = { position: 'absolute', top: 0, bottom: 0, width: desktop ? '22%' : '30%' } as const;
  return (
    <View>
      <View style={{ marginBottom: 14, marginHorizontal: desktop ? -24 : -16 }}>
        <Carousel gap={10}>
          {list.map((x, i) => <Ring key={x.id} tool={x} index={i} size={desktop ? 66 : 58} active={i === idx} onPress={() => go(i)} />)}
        </Carousel>
      </View>
      <View testID="story-card" style={{ height: H, borderRadius: radius, overflow: 'hidden', backgroundColor: '#000' }}>
        <Animated.View key={tool.id} entering={FadeIn.duration(280)} style={StyleSheet.absoluteFill}>
          <ToolMedia tool={tool} index={idx} onReady={paintOf(onPaint, idx)} />
        </Animated.View>
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 110 }} />
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.82)']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '62%' }} />
        <View pointerEvents="none" style={{ position: 'absolute', top: 14, left: 14, right: 14 }}>
          <StoryBars count={n} index={idx} duration={6500} run={motion} paused={hold} onDone={() => go(idx + 1)} />
        </View>
        {/* tap zones: first side = previous, last side = next, middle = open (hold anywhere = pause) */}
        <Pressable testID="story-prev" accessibilityRole="button" onPress={() => go(idx - sign)} onPressIn={() => setHold(true)} onPressOut={() => setHold(false)} style={[zones, { left: 0 }]} />
        <Pressable testID="story-next" accessibilityRole="button" onPress={() => go(idx + sign)} onPressIn={() => setHold(true)} onPressOut={() => setHold(false)} style={[zones, { right: 0 }]} />
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: desktop ? 30 : 20 }}>
          <Animated.View key={tool.id} entering={FadeInDown.delay(120).duration(420)} pointerEvents="none">
            <View className="bg-primary rounded-full self-start px-3 h-6 items-center justify-center mb-2"><Txt className="text-onprimary font-bold text-[11px]">{String(idx + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}</Txt></View>
            <Txt className="text-white font-black" style={{ fontSize: desktop ? 40 : 28, lineHeight: desktop ? 46 : 34, textShadowColor: 'rgba(0,0,0,.4)', textShadowRadius: 8 }} numberOfLines={2}>{L(tool.title)}</Txt>
            {tool.subtitle ? <Txt className="text-white mt-1" style={{ fontSize: desktop ? 16 : 14, opacity: 0.9, maxWidth: 560 }} numberOfLines={2}>{L(tool.subtitle)}</Txt> : null}
          </Animated.View>
          <View style={{ marginTop: 14, alignSelf: 'flex-start' }}><SearchTarget id={tool.id}><Cta testID={`tool-${tool.id}`} onPress={() => onOpen(tool.id)} /></SearchTarget></View>
        </View>
      </View>
    </View>
  );
}

/* ============================================================== 3. Aurora glass ============================================================== */
function GlassTile({ tool, i, H, radius, cols, onOpen, onPaint }: { tool: Tool; i: number; H: number; radius: number; cols: number; onOpen: (id: string) => void; onPaint?: (i: number) => void }) {
  const motion = useMotion();
  const body = (
    <Tilt radius={radius} max={7}>
      <PressableScale testID={`tool-${tool.id}`} accessibilityRole="button" accessibilityLabel={tool.id} onPress={() => onOpen(tool.id)}>
        <View style={[{ height: H, borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' }, web ? ({ boxShadow: '0 22px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.25)' } as object) : null]}>
          <ToolFace tool={tool} radius={0} index={i} badge={false} onReady={paintOf(onPaint, i)} />
          <View pointerEvents="none" style={{ position: 'absolute', top: 10, start: 10, paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' } as any}>
            <Txt className="text-white font-black text-[11px]">{String(i + 1).padStart(2, '0')}</Txt>
          </View>
        </View>
      </PressableScale>
    </Tilt>
  );
  const lifted = (i % cols) % 2 === 1 ? 22 : 0;
  return (
    <View style={{ marginTop: lifted }}>
      {motion ? <Animated.View entering={ZoomIn.delay(Math.min(i, 8) * 80).springify().damping(16)}><Float i={i}>{body}</Float></Animated.View> : body}
    </View>
  );
}

/** Tiles of glass floating over a slowly moving aurora; they levitate and (on a computer) tilt towards the pointer with a light that follows it. */
export function AuroraLayout({ params, device, tablet, tools, onOpen, onPaint }: HomeLayoutProps) {
  const { colors } = useTheme();
  const desktop = device === 'desktop';
  const gap = params.gap ?? 14; const radius = params.radius ?? 26;
  const H = (desktop ? params.heightD : params.heightM) ?? (desktop ? 240 : 190);
  const cols = columnsFor(device, tablet, params, 2, 3);
  return (
    <Aurora primary={colors.primary} radius={radius + 8} pad={desktop ? 28 : 14}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2, paddingBottom: cols > 1 ? 22 : 0 }}>
        {tools.map((tool, i) => (
          <View key={tool.id} style={{ width: `${100 / cols}%`, padding: gap / 2 }}>
            <GlassTile tool={tool} i={i} H={H} radius={radius} cols={cols} onOpen={onOpen} onPaint={onPaint} />
          </View>
        ))}
      </View>
    </Aurora>
  );
}

/* ============================================================== 4. Swipe deck ============================================================== */
/** True once: a card that was thrown away must not be thrown again by a second gesture event. */
class Once { private done = false; take() { if (this.done) return false; this.done = true; return true; } }

function DeckCard({ tool, pos, index, H, radius, W, onOpen, onNext, onPaint }: { tool: Tool; pos: number; index: number; H: number; radius: number; W: number; onOpen: () => void; onNext: () => void; onPaint?: (i: number) => void }) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const depth = useSharedValue(pos);
  const [S] = React.useState(() => new Once());
  React.useEffect(() => { depth.set(withSpring(pos, { damping: 16, stiffness: 140 })); }, [pos, depth]);
  const fly = (dir: number) => {
    if (!S.take()) return;
    tx.set(withTiming(dir * W * 1.4, { duration: 240, easing: Easing.out(Easing.quad) }, (fin) => { if (fin) runOnJS(onNext)(); }));
  };
  const pan = Gesture.Pan().runOnJS(true).enabled(pos === 0).activeOffsetX([-8, 8]).failOffsetY([-30, 30])
    .onUpdate((e) => { tx.set(e.translationX); ty.set(e.translationY * 0.25); })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > W * 0.28 || Math.abs(e.velocityX) > 700) fly(e.translationX < 0 ? -1 : 1);
      else { tx.set(withSpring(0)); ty.set(withSpring(0)); }
    });
  const a = useAnimatedStyle(() => {
    const p = depth.get();
    return {
      zIndex: 10 - Math.round(p * 2),
      opacity: interpolate(p, [0, 1, 2, 3], [1, 1, 0.85, 0], 'clamp'),
      transform: [{ translateX: tx.get() }, { translateY: ty.get() + p * 16 }, { rotate: `${(tx.get() / W) * 16}deg` }, { scale: 1 - p * 0.06 }],
    };
  });
  const front = pos === 0;
  return (
    <Animated.View entering={FadeIn.duration(220)} style={[{ position: 'absolute', top: 0, left: 0, right: 0, height: H }, a]}>
      <GestureDetector gesture={pan} touchAction="pan-y">
        <View style={{ flex: 1 }}>
          <Pressable testID={front ? 'deck-top' : undefined} accessibilityRole="button" onPress={() => { if (front && Math.abs(tx.get()) < 4) onOpen(); }} style={[{ flex: 1, borderRadius: radius, overflow: 'hidden' }, web ? ({ boxShadow: '0 20px 44px rgba(0,0,0,0.3)' } as object) : { elevation: 8 }]}>
            <View pointerEvents="none" style={{ flex: 1 }}><ToolFace tool={tool} radius={radius} index={index} still big badge={front} onReady={paintOf(onPaint, index)} /></View>
          </Pressable>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const Round = ({ icon, onPress, testID, flip, label }: { icon: string; onPress: () => void; testID: string; flip?: boolean; label: string }) => (
  <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} className="w-12 h-12 rounded-full bg-surface border border-line items-center justify-center" style={{ boxShadow: '0 6px 20px rgba(0,0,0,0.14)' } as any}>
    <Icon name={icon} size={22} flip={flip} />
  </Pressable>
);

/** A stack of cards you can throw away left or right (Tinder-style): one tool at a time, big, with the next ones peeking from behind. */
export function DeckLayout({ params, device, tools, onOpen, onPaint }: HomeLayoutProps) {
  const L = useL();
  const { t } = useT();
  const desktop = device === 'desktop';
  const H = (desktop ? params.heightD : params.heightM) ?? (desktop ? 420 : 380);
  const radius = params.radius ?? 28;
  const n = tools.length;
  const [top, setTop] = React.useState(0);
  const [w, setW] = React.useState(desktop ? 420 : 340);
  const next = React.useCallback(() => setTop((x) => (x + 1) % Math.max(1, n)), [n]);
  const prev = () => setTop((x) => (x - 1 + n) % Math.max(1, n));
  const cur = tools[top];
  if (!cur) return null;
  const visible = tools.map((tool, i) => ({ tool, i, pos: (i - top + n) % n })).filter((c) => c.pos < 3).sort((a, b) => b.pos - a.pos);
  const deckW = desktop ? Math.min(w, 460) : w;
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: desktop ? 460 : undefined }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <View testID="deck" style={{ height: H + 34 }}>
          {visible.map(({ tool, i, pos }) => <DeckCard key={tool.id} tool={tool} pos={pos} index={i} H={H} radius={radius} W={deckW} onOpen={() => onOpen(tool.id)} onNext={next} onPaint={onPaint} />)}
        </View>
      </View>
      <Animated.View key={cur.id} entering={FadeInDown.duration(300)} style={{ alignItems: 'center', marginTop: 6, paddingHorizontal: 12 }}>
        <Txt className="text-muted text-[12px] font-bold">{top + 1} / {n}</Txt>
      </Animated.View>
      <View className="flex-row items-center gap-4" style={{ marginTop: 10 }}>
        <Round testID="deck-prev" icon="undo-variant" label={t('improve.previous')} onPress={prev} />
        <Cta testID="deck-open" onPress={() => onOpen(cur.id)} />
        <Round testID="deck-next" icon="arrow-right" flip label={t('improve.next')} onPress={next} />
      </View>
      <Txt className="text-muted text-[12px] mt-3 text-center" numberOfLines={1}>{L(cur.title)}</Txt>
    </View>
  );
}
