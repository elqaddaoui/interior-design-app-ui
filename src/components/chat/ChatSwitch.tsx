import React from 'react';
import { ChatView } from '@/components/ChatView';
import { WaChat } from '@/components/chat/WaChat';
import { useStore } from '@/store/useStore';

/** The admin picks the chat in Interface (`settings.waChat`, on unless false): WhatsApp-style chat or the classic one. */
export function ChatSwitch(props: { conversationId?: string; onCreated?: (id: string) => void; header?: React.ReactNode }) {
  const wa = useStore((s) => s.doc.settings.waChat) !== false;
  return wa ? <WaChat {...props} /> : <ChatView {...props} />;
}
