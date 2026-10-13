import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, Platform, ScrollView, View, type ScrollViewProps } from 'react-native';
import { useFocusEffect, useLocalSearchParams, usePathname, useRoute, useIsFocused } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';

const states = new Map<string, unknown>();
const positions = new Map<string, { x: number; y: number }>();
function usePageKey() {
  const path = usePathname(); const route = useRoute();
  return `${route.key}:${path}`;
}
/** Visit-scoped state survives remounts without leaking into another history entry. */
export function useViewState<T>(name: string, initial: T | (() => T)): [T, React.Dispatch<React.SetStateAction<T>>] {
  const key = `${usePageKey()}:${name}`;
  const read = () => states.has(key) ? states.get(key) as T : typeof initial === 'function' ? (initial as () => T)() : initial;
  const [record, update] = useState<{ key: string; value: T }>(() => ({ key, value: read() }));
  if (record.key !== key) update({ key, value: read() });
  const value = record.key === key ? record.value : read();
  const set: React.Dispatch<React.SetStateAction<T>> = useCallback((next) => update((old) => {
    const previous = old.key === key ? old.value : states.get(key) as T;
    const value = typeof next === 'function' ? (next as (old: T) => T)(previous) : next;
    states.set(key, value); return { key, value };
  }), [key]);
  return [value, set];
}
const ScrollContext = createContext<React.RefObject<ScrollView | null> | null>(null);
export function RememberScroll({ stateKey = 'page', children, onScroll, onContentSizeChange, ...props }: ScrollViewProps & { stateKey?: string }) {
  const page = usePageKey(); const key = stateKey.startsWith('shared:') ? stateKey : `${page}:${stateKey}`;
  const ref = useRef<ScrollView>(null); const restoring = useRef(true);
  const restore = useCallback(() => { const p = positions.get(key); if (p) ref.current?.scrollTo({ ...p, animated: false }); }, [key]);
  useFocusEffect(useCallback(() => {
    restoring.current = true;
    const frame = requestAnimationFrame(restore);
    const timer = setTimeout(() => { restore(); restoring.current = false; }, 150);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [restore]));
  return <ScrollContext.Provider value={ref}><ScrollView {...props} ref={ref} scrollEventThrottle={16}
    contentOffset={positions.get(key)} onContentSizeChange={(w, h) => { if (restoring.current) restore(); onContentSizeChange?.(w, h); }}
    onScroll={(e) => { if (!restoring.current) positions.set(key, e.nativeEvent.contentOffset); onScroll?.(e); }}>{children}</ScrollView></ScrollContext.Provider>;
}
/** Search targets reveal themselves after layout, including nested scrolling panes. */
export function SearchTarget({ id, children }: { id: string; children: React.ReactNode }) {
  const { target, focus } = useLocalSearchParams<{ target?: string; focus?: string }>();
  const focused = useIsFocused();
  const ref = useRef<View>(null); const scroll = useContext(ScrollContext);
  const opacity = useRef(new Animated.Value(0)).current;
  const revealed = useRef('');
  const token = `${id}:${focus ?? target ?? ''}`;
  const { colors } = useTheme();
  const reveal = useCallback(() => {
    if (target !== id || !focused || revealed.current === token) return;
    revealed.current = token;
    if (Platform.OS === 'web') {
      const node = ref.current as unknown as HTMLElement;
      node?.scrollIntoView?.({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' });
    } else if (scroll?.current) {
      const parent = scroll.current.getInnerViewNode();
      if (parent) ref.current?.measureLayout(parent, (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - 16), animated: true }), () => {});
    }
    opacity.setValue(0.35);
    Animated.timing(opacity, { toValue: 0, duration: 1800, useNativeDriver: true }).start();
  }, [target, id, focused, scroll, opacity, token]);
  useFocusEffect(useCallback(() => { const timer = setTimeout(reveal, 200); return () => clearTimeout(timer); }, [reveal, focus]));
  return <View ref={ref} collapsable={false} onLayout={reveal} testID={`target-${id}`} style={{ minWidth: 0 }}>
    {children}
    <Animated.View pointerEvents="none" style={{ position: 'absolute', inset: 0, borderRadius: 12, backgroundColor: colors.primary, opacity }} />
  </View>;
}
