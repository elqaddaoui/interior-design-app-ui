import React, { useMemo } from 'react';
import { View } from 'react-native';
import { ease } from '@/lib/toolCardFx';
import { useTheme } from '@/theme/ThemeProvider';

/** The easing curve (time across, progress up) drawn with dots; the two guide lines are 0 % and 100 % progress, so overshoot and anticipation are visible. */
export function CurvePreview({ kind, ep }: { kind: number; ep: number[] }) {
  const { colors } = useTheme();
  const epKey = ep.join(',');
  const pts = useMemo(() => {
    const N = 48;
    const ys = Array.from({ length: N + 1 }, (_, i) => ease(kind, i / N, ep));
    const lo = Math.min(0, ...ys), hi = Math.max(1, ...ys);
    return { ys, lo, hi, top0: (1 - (0 - lo) / (hi - lo)) * 100, top1: (1 - (1 - lo) / (hi - lo)) * 100 };
  }, [kind, epKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const N = pts.ys.length - 1;
  return (
    <View testID="st-curve" style={{ height: 96, borderRadius: 12, backgroundColor: colors.surface2, marginVertical: 2 }}>
      <View style={{ position: 'absolute', left: 8, right: 8, top: 8, bottom: 8 }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: `${pts.top0}%`, height: 1, backgroundColor: colors.line }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: `${pts.top1}%`, height: 1, backgroundColor: colors.line }} />
        {pts.ys.map((y, i) => (
          <View key={i} style={{ position: 'absolute', left: `${(i / N) * 100}%`, top: `${(1 - (y - pts.lo) / (pts.hi - pts.lo)) * 100}%`, width: 5, height: 5, marginLeft: -2.5, marginTop: -2.5, borderRadius: 3, backgroundColor: colors.primary }} />
        ))}
      </View>
    </View>
  );
}
