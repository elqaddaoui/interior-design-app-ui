import React from 'react';
import { View } from 'react-native';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import type { ProvState } from '@/lib/assistantAdmin';

const COLOR: Record<string, string> = { active: '#16a34a', ready: '#2563eb', failed: '#dc2626', cooling: '#d97706', off: '#9ca3af', paid: '#7c3aed', automation: '#0d9488', fallback: '#d97706', local: '#9ca3af' };

/** One coloured pill for a provider state (off / cooling / ready / active / failed) or a reply status. */
export function StateBadge({ state, text, testID }: { state: ProvState | 'paid' | 'automation' | 'fallback' | 'local'; text?: string; testID?: string }) {
  const { t } = useT();
  const c = COLOR[state] ?? COLOR.off;
  return (
    <View testID={testID} className="flex-row items-center gap-1.5 px-2 h-6 rounded-full" style={{ backgroundColor: `${c}22` }}>
      <View className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
      <Txt className="text-[11.5px] font-extrabold" style={{ color: c }} numberOfLines={1}>{text ?? t(`asx.p.state.${state}`)}</Txt>
    </View>
  );
}

export const dateOf = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
