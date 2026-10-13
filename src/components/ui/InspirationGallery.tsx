import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from '@/hooks/useLeaveGuard';
import { SearchTarget } from '@/hooks/useViewState';
import type { GalleryLayout, InspirationItem } from '@/data/types';
import { useBp } from '@/hooks/useBp';
import { MediaView } from './MediaView';
import { Carousel } from './Carousel';

/** Four distinct cross-platform gallery compositions, preserving the admin's item order. */
export function InspirationGallery({ items, layout }: { items: InspirationItem[]; layout: GalleryLayout }) {
  const { pick, desktop } = useBp();
  const cols = pick(2, 3, 4);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const tile = (it: InspirationItem, index: number, ratio = 0.85) => <SearchTarget key={it.id} id={it.id}><Pressable testID={`ins-${it.id}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/explore/item/[id]', params: { id: it.id } })}>
    <MediaView uri={it.image} className="rounded-2xl" style={{ aspectRatio: ratio }} onAspectRatio={layout === 'masonry' ? (r) => setRatios((old) => old[it.id] === r ? old : { ...old, [it.id]: r }) : undefined} />
  </Pressable></SearchTarget>;
  if (layout === 'carousel') return <Carousel>{items.map((it, i) => <View key={it.id} style={{ width: desktop ? 320 : 240 }}>{tile(it, i, 0.8)}</View>)}</Carousel>;
  if (layout === 'masonry') return <View testID="gallery-masonry" className="flex-row gap-2.5">
    {Array.from({ length: cols }, (_, col) => <View key={col} className="flex-1 gap-2.5" style={{ minWidth: 0 }}>{items.filter((_, i) => i % cols === col).map((it, i) => tile(it, i, ratios[it.id] ?? (i % 2 ? 0.75 : 1.15)))}</View>)}
  </View>;
  return <View testID={`gallery-${layout}`} style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 }}>
    {items.map((it, i) => { const hero = layout === 'editorial' && i % 5 === 0; return <View key={it.id} style={{ width: hero ? '100%' : `${100 / cols}%`, padding: 5 }}>{tile(it, i, hero ? 1.85 : layout === 'editorial' ? 1 : 0.85)}</View>; })}
  </View>;
}
