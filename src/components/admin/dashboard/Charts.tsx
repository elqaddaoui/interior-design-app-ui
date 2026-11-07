import React from 'react';
import { View } from 'react-native';
import { Txt } from '@/components/ui/Txt';
import { useProgress } from '@/hooks/useCountUp';

/** Ranked horizontal bars ("best features"); the leader uses the accent colour, the others the ink colour. */
export function RankBars({ rows, unit }: { rows: { id: string; label: string; count: number }[]; unit: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = Math.max(1, rows.reduce((a, r) => a + r.count, 0));
  const p = useProgress(rows.map((r) => r.count).join(','), 800);
  return (
    <View testID="dash-rank" style={{ gap: 12 }}>
      {rows.map((r, i) => (
        <View key={r.id}>
          <View className="flex-row items-center mb-1.5 gap-2">
            <View className={`w-5 h-5 rounded-full items-center justify-center ${i === 0 ? 'bg-primary' : 'bg-surface2'}`}><Txt className={`text-[10px] font-black ${i === 0 ? 'text-onprimary' : 'text-muted'}`}>{i + 1}</Txt></View>
            <Txt numberOfLines={1} className={`text-[13px] flex-1 ${i === 0 ? 'font-extrabold' : 'font-semibold'}`}>{r.label}</Txt>
            <Txt className="text-muted text-[11px]">{unit(r.count)}</Txt>
            <Txt className="text-[12px] font-extrabold" style={{ width: 38, textAlign: 'right' }}>{Math.round((r.count / total) * 100)}%</Txt>
          </View>
          <View className="h-2 rounded-full bg-surface2 overflow-hidden">
            <View className={i === 0 ? 'bg-primary' : 'bg-ink'} style={{ width: `${Math.round((r.count / max) * 100 * p)}%`, height: 8, borderRadius: 4, opacity: i === 0 ? 1 : 0.5 }} />
          </View>
        </View>
      ))}
    </View>
  );
}
