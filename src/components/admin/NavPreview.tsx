import React from 'react';
import { View } from 'react-native';
import { Icon } from '@/components/ui/Icon';

const ICONS = ['home-variant', 'compass-outline', 'clock-outline', 'face-agent'];

/** Tiny schematic mock-ups of each user bottom-bar variant. */
export function NavPreview({ id }: { kind?: 'user'; id: string }) {
  const row = (
    <View className="flex-row items-center justify-around" style={{ width: '100%' }}>
      {ICONS.map((n, i) => {
        const on = i === 0;
        if (id === 'floating') return <View key={n} className={`h-8 rounded-full items-center justify-center flex-row gap-1 ${on ? 'bg-ink px-3' : 'w-8'}`}><Icon name={n} size={16} tone={on ? 'onink' : 'muted'} />{on ? <View className="h-1.5 w-8 rounded-full bg-onink" /> : null}</View>;
        if (id === 'minimal') return <View key={n} className="items-center" style={{ width: 40 }}><View className={`h-[3px] w-6 rounded-b-full mb-1 ${on ? 'bg-primary' : ''}`} /><Icon name={n} size={17} tone={on ? 'fg' : 'muted'} /><View className="h-1 w-6 rounded-full bg-line mt-1" /></View>;
        return <View key={n} className="items-center" style={{ width: 40 }}><View className={`h-6 w-10 rounded-full items-center justify-center ${on ? 'bg-soft' : ''}`}><Icon name={n} size={16} tone={on ? 'fg' : 'muted'} /></View><View className="h-1 w-6 rounded-full bg-line mt-1" /></View>;
      })}
    </View>
  );
  return (
    <View className="flex-1 w-full justify-end">
      <View className="flex-1 p-3 gap-2"><View className="h-3 w-24 rounded bg-line" /><View className="flex-1 rounded-lg bg-line" style={{ opacity: 0.6 }} /></View>
      {id === 'floating'
        ? <View className="px-4 pb-3"><View className="bg-surface border border-line rounded-full py-1.5 px-1.5">{row}</View></View>
        : <View className={`${id === 'minimal' ? 'bg-bg' : 'bg-surface'} border-t border-line py-2 px-2`}>{row}</View>}
    </View>
  );
}
