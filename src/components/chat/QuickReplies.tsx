import React from 'react';
import { Pressable, ScrollView } from 'react-native';
import { Txt } from '@/components/ui/Txt';

export interface QuickReply { id: string; label: string }

/** The owner's quick-reply buttons: a row of chips above the message box. Touching one sends its label and runs its automation. */
export function QuickReplies({ items, busy, onPick }: { items: QuickReply[]; busy: boolean; onPick: (item: QuickReply) => void }) {
  return (
    <ScrollView testID="chat-buttons" horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
      {items.map((b) => (
        <Pressable key={b.id} testID={`chat-button-${b.id}`} accessibilityRole="button" disabled={busy} onPress={() => onPick(b)} className="rounded-full border border-primary/50 bg-surface px-3.5 py-2 active:opacity-70" style={{ opacity: busy ? 0.5 : 1 }}>
          <Txt className="text-[13px] leading-[18px] font-semibold text-primary">{b.label}</Txt>
        </Pressable>
      ))}
    </ScrollView>
  );
}
