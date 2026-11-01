import { useViewState } from '@/hooks/useViewState';
import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router } from '@/hooks/useLeaveGuard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/store/useStore';
import { useT } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { ChatView } from '@/components/ChatView';
import { waLink } from '@/lib/share';
import { useBp } from '@/hooks/useBp';

export default function Assistant() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { desktop } = useBp();
  const cfg = useStore((s) => s.doc.assistant);
  const [cid, setCid] = useViewState<string | undefined>('conversation', undefined);
  const [key, setKey] = useViewState('chat-key', 0);

  if (cfg.type === 'whatsapp') {
    return (
      <Screen max={520} scroll={false}>
        <View className="flex-1 items-center justify-center px-4">
          <View className="w-24 h-24 rounded-full bg-[#25D366] items-center justify-center mb-6"><Icon name="whatsapp" size={54} color="#fff" /></View>
          <Txt className="text-[24px] font-black text-center">{t('assistant.waTitle')}</Txt>
          <Txt className="text-muted text-[15px] text-center mt-2 mb-8">{t('assistant.waDesc')}</Txt>
          <Button testID="open-wa" icon="whatsapp" title={t('assistant.waOpen')} size="lg" full onPress={() => Linking.openURL(waLink(cfg.whatsappNumber, t('assistant.waDefaultMsg')))} />
        </View>
      </Screen>
    );
  }
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: desktop ? 0 : insets.top }}>
      <View className="w-full self-center flex-1" style={{ maxWidth: 820 }}>
        <ChatView key={key} conversationId={cid} onCreated={setCid} header={
          <View className="flex-row items-center justify-between h-14 px-4">
            <Txt className="text-[22px] font-black">{t('tabs.assistant')}</Txt>
            <View className="flex-row items-center gap-2">
              <View className="bg-ink rounded-md px-2 py-0.5"><Txt className="text-onink font-black text-[11px]">{t('assistant.pro')}</Txt></View>
              <Pressable testID="new-chat" accessibilityLabel={t('assistant.newChat')} onPress={() => { setCid(undefined); setKey((k) => k + 1); }} hitSlop={8}><Icon name="plus-circle-outline" size={24} /></Pressable>
              <Pressable onPress={() => router.navigate('/history')} hitSlop={8}><Icon name="history" size={24} /></Pressable>
            </View>
          </View>
        } />
      </View>
    </View>
  );
}
