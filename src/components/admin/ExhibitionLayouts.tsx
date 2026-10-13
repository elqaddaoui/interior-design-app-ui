import React from 'react';
import { Pressable, View } from 'react-native';
import { Icon, MediaView, Txt } from '@/components/ui';
import { useStore } from '@/store/useStore';
import type { GalleryLayout } from '@/data/types';

const layouts: { id: GalleryLayout; title: string; description: string }[] = [
  { id: 'grid', title: 'Classic Grid', description: 'Balanced, uniform tiles' },
  { id: 'masonry', title: 'Masonry Columns', description: 'Natural image proportions' },
  { id: 'editorial', title: 'Editorial · Featured Images', description: 'A hero image, curated details' },
  { id: 'carousel', title: 'Slideshow', description: 'One image in the spotlight' },
];
export function ExhibitionLayouts({ value, onChange }: { value: GalleryLayout; onChange: (layout: GalleryLayout) => void }) {
  const inspirations = useStore((s) => s.inspirations);
  const images = inspirations.slice(0, 6).map((i) => i.image);
  const photo = (i: number, height: number) => <MediaView uri={images[i % images.length]} style={{ height, borderRadius: 5 }} />;
  return <View testID="exhibition-layouts" style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -4 }}>
    {layouts.map(({ id, title, description }) => <View key={id} style={{ width: '50%', padding: 4 }}>
      <Pressable testID={`layout-${id}`} accessibilityRole="radio" accessibilityState={{ selected: value === id }} onPress={() => onChange(id)} className={`rounded-xl border-2 p-2 ${value === id ? 'border-primary bg-soft' : 'border-line bg-surface'}`}>
        <View className="rounded-lg bg-surface2 overflow-hidden p-1.5 mb-2" style={{ height: 132 }}>
          {id === 'grid' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{[0, 1, 2, 3].map((i) => <View key={i} style={{ width: '48%', flexGrow: 1 }}>{photo(i, 56)}</View>)}</View> : null}
          {id === 'masonry' ? <View className="flex-row gap-1"><View className="flex-1 gap-1">{photo(0, 73)}{photo(1, 40)}</View><View className="flex-1 gap-1">{photo(2, 44)}{photo(3, 69)}</View><View className="flex-1 gap-1">{photo(4, 64)}{photo(5, 49)}</View></View> : null}
          {id === 'editorial' ? <View className="gap-1">{photo(0, 73)}<View className="flex-row gap-1"><View className="flex-1">{photo(1, 40)}</View><View className="flex-1">{photo(2, 40)}</View></View></View> : null}
          {id === 'carousel' ? <View>{photo(0, 116)}<View className="absolute inset-0 flex-row items-center justify-between px-1"><View className="bg-surface rounded-full p-1"><Icon name="chevron-left" size={16} /></View><View className="bg-surface rounded-full p-1"><Icon name="chevron-right" size={16} /></View></View><View className="absolute bottom-2 self-center flex-row gap-1">{[0, 1, 2].map((i) => <View key={i} className={i === 0 ? 'bg-primary' : 'bg-white'} style={{ width: 5, height: 5, borderRadius: 3 }} />)}</View></View> : null}
        </View>
        <View className="flex-row items-start gap-1"><Txt className="flex-1 font-bold text-[13px] leading-[19px]" style={{ minHeight: 38 }}>{title}</Txt><Icon name={value === id ? 'check-circle' : 'radiobox-blank'} size={17} tone={value === id ? 'primary' : 'muted'} /></View>
        <Txt className="text-muted text-[11px]" numberOfLines={2}>{description}</Txt>
      </Pressable>
    </View>)}
  </View>;
}
