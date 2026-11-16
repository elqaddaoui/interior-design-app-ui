import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import type { LibItem } from '@/lib/mediaLibrary';
import { MediaPreview } from './MediaPreview';

const GAP = 10;
export const nameOf = (m: LibItem) => m.title || m.alt || decodeURIComponent((m.url.split('?')[0].split('/').pop() || '').slice(0, 60));

/**
 * Square tiles that fill the row. Pictures show the picture; videos show their first frame (or play, muted, when `autoplay` is on) with a small
 * play mark. `selected` ids get a ring and a check; `onOpen` is called with the tapped file.
 */
export function MediaGrid({ items, selected, onOpen, minTile = 120, autoplay = false }: { items: LibItem[]; selected?: Set<string>; onOpen: (m: LibItem) => void; minTile?: number; autoplay?: boolean }) {
  const [width, setWidth] = useState(0);
  const cols = Math.max(2, Math.floor((width + GAP) / (minTile + GAP)));
  const tile = width ? Math.floor((width - GAP * (cols - 1)) / cols) : 0;
  return (
    <View testID="ml-grid" onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
      {tile > 0 ? items.map((m) => {
        const on = !!selected?.has(m.id);
        return (
          <Pressable key={m.id} testID={`ml-tile-${m.id}`} accessibilityRole="button" accessibilityLabel={nameOf(m)} accessibilityState={{ selected: on }} onPress={() => onOpen(m)}
            className={`rounded-2xl overflow-hidden bg-surface2 active:opacity-80 ${on ? 'border-2 border-primary' : 'border border-line'}`} style={{ width: tile, height: tile }}>
            <MediaPreview item={m} autoplay={autoplay} />
            {m.kind === 'video' ? <View pointerEvents="none" className="absolute bottom-1.5 start-1.5 rounded-full items-center justify-center" style={{ width: 24, height: 24, backgroundColor: 'rgba(0,0,0,0.55)' }}><Icon name="play" size={14} color="#fff" /></View> : null}
            {m.linked ? <View pointerEvents="none" className="absolute top-1.5 start-1.5 rounded-full items-center justify-center" style={{ width: 22, height: 22, backgroundColor: 'rgba(0,0,0,0.55)' }}><Icon name="link-variant" size={13} color="#fff" /></View> : null}
            {on ? <View className="absolute top-1.5 end-1.5 rounded-full bg-primary items-center justify-center" style={{ width: 22, height: 22 }}><Icon name="check" size={15} tone="onprimary" /></View> : null}
            {m.kind === 'audio' ? <Txt numberOfLines={1} className="absolute bottom-1 start-2 end-2 text-muted text-[11px]">{nameOf(m)}</Txt> : null}
          </Pressable>
        );
      }) : null}
    </View>
  );
}
