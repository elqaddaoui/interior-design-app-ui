import React from 'react';
import { View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import type { Shape as DecoShape } from '@/lib/toolCardFx';
import type { PieceShape as StudioShape } from '@/lib/fxStudio';

/**
 * The flat shapes of the transition pieces, drawn with plain views (no images). The six classic shapes of the Creative tier are pure views;
 * the Studio adds star / spark / heart / hexagon / moon / bolt, drawn from the icon font (one glyph, coloured, so they stay sharp at any size).
 */
const GLYPH: Record<string, string> = { star: 'star', spark: 'star-four-points', heart: 'heart', hex: 'hexagon', moon: 'moon-waning-crescent', bolt: 'lightning-bolt' };

export function Shape({ shape, size, color }: { shape: DecoShape | StudioShape; size: number; color: string }) {
  const t = Math.max(2, Math.round(size / 7));
  if (GLYPH[shape]) return <Icon name={GLYPH[shape]} size={Math.round(size * 1.15)} color={color} />;
  switch (shape) {
    case 'ring': return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: t, borderColor: color }} />;
    case 'diamond': { const d = size * 0.72; return <View style={{ width: d, height: d, backgroundColor: color, borderRadius: 2, transform: [{ rotate: '45deg' }] }} />; }
    case 'plus': return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: size, height: t + 1, borderRadius: 2, backgroundColor: color }} />
        <View style={{ position: 'absolute', width: t + 1, height: size, borderRadius: 2, backgroundColor: color }} />
      </View>
    );
    case 'bar': return <View style={{ width: size * 0.34, height: size * 1.5, borderRadius: size * 0.17, backgroundColor: color }} />;
    case 'tri': return <View style={{ width: 0, height: 0, borderLeftWidth: size * 0.5, borderRightWidth: size * 0.5, borderBottomWidth: size * 0.86, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color }} />;
    default: return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
  }
}
