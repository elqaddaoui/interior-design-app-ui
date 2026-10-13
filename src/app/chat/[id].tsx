import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatView } from '@/components/ChatView';
import { PageHeader } from '@/components/ui';
import { useStore } from '@/store/useStore';

export default function ChatPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const conv = useStore((s) => s.conversations.find((c) => c.id === id));
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="w-full self-center flex-1" style={{ maxWidth: 820 }}>
        <ChatView conversationId={id} header={<View className="px-4"><PageHeader title={conv?.title ?? ''} onBack={() => router.back()} /></View>} />
      </View>
    </View>
  );
}
