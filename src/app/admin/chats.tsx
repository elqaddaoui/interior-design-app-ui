import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { ImageViewer } from '@/components/ui/ImageViewer';
import { VoiceBubble, useVoicePlayback, type Recorded } from '@/components/chat/voice';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { RightClick, sep, type MenuItem } from '@/components/admin/ContextMenu';
import { SearchTarget, useViewState } from '@/hooks/useViewState';
import { useT } from '@/i18n';
import { waLink } from '@/lib/share';
import { useAdminChats, type AdminConversation } from '@/store/useAdminChats';
import { toast } from '@/store/useToast';
import { MessageBadge } from '@/components/admin/assistant/MessageBadge';

const preview = (chat: AdminConversation, photo: string) => {
  const last = chat.messages[chat.messages.length - 1];
  return last ? (last.text || (last.audio ? '🎤' : `📷 ${photo}`)) : '';
};

function Thread({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useT();
  const chat = useAdminChats(s => s.chats.find(c => c.id === id));
  const [text, setText] = useViewState('admin-chat-reply', '');
  const [busy, setBusy] = React.useState(false);
  const [viewer, setViewer] = React.useState<number | null>(null);
  const playback = useVoicePlayback();
  if (!chat) return <Sheet visible={false} onClose={onClose}><View /></Sheet>;
  const pictures = chat.messages.filter(m => m.image);
  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try { await useAdminChats.getState().reply(chat.id, value); setText(''); toast(t('inbox.sent')); }
    catch { toast(t('inbox.sendFailed')); }
    finally { setBusy(false); }
  };
  const sendVoice = async (voice: Recorded) => {
    if (busy) return;
    setBusy(true);
    try { await useAdminChats.getState().reply(chat.id, '', { uri: voice.dataUrl, durationMs: voice.durationMs }); toast(t('inbox.sent')); }
    catch { toast(t('inbox.sendFailed')); }
    finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title={chat.guest ? t('inbox.guest') : chat.clientName} wide
      footer={<ChatComposer value={text} onChange={setText} onSend={send} canSend={!!text.trim()} busy={busy} maxLength={4000} placeholder={t('inbox.replyPlaceholder')}
        onVoice={sendVoice} ids={{ input: 'admin-chat-input', send: 'admin-chat-send', mic: 'admin-chat-mic' }} />}>
      {chat.guest ? null : <View className="flex-row items-center justify-between mb-2 gap-3">
        <Txt className="text-muted flex-1">{chat.whatsapp}</Txt>
        <Button safe testID="admin-chat-wa" icon="whatsapp" size="sm" variant="soft" title={t('inbox.openWa')} onPress={() => Linking.openURL(waLink(chat.whatsapp, ''))} />
      </View>}
      {chat.messages.map(m => (
        <View key={m.id} testID={`admin-msg-${m.role}`} className={`mb-2 max-w-[86%] ${m.role === 'user' ? 'self-start' : 'self-end'}`}>
          <View className={`rounded-2xl px-3 py-2 ${m.role === 'admin' ? 'bg-primary rounded-ee-md' : m.role === 'user' ? 'bg-surface2 rounded-es-md' : 'bg-soft rounded-ee-md'}`}>
            {m.image ? <Pressable testID={`admin-image-${m.id}`} accessibilityRole="imagebutton" accessibilityLabel={t('md.viewer.open')} onPress={() => setViewer(Math.max(0, pictures.findIndex(x => x.id === m.id)))} className="active:opacity-90"><Image source={{ uri: m.image }} style={{ width: 200, height: 140, borderRadius: 12, marginBottom: m.text ? 8 : 0 }} contentFit="cover" /></Pressable> : null}
            {m.audio ? <VoiceBubble id={m.id} audio={m.audio} playback={playback} own={m.role === 'admin'} /> : null}
            {m.text ? <Txt className={`text-[14px] leading-[20px] ${m.role === 'admin' ? 'text-onprimary' : ''}`}>{m.text}</Txt> : null}
          </View>
          {m.role === 'assistant' && m.meta ? <MessageBadge id={m.id} meta={m.meta} /> : null}
        </View>
      ))}
      <ImageViewer items={pictures.map(m => ({ uri: m.image as string, label: m.role === 'user' ? chat.clientName || t('inbox.guest') : t('inbox.team') }))} index={viewer} onIndexChange={setViewer} onClose={() => setViewer(null)} />
    </Sheet>
  );
}

/** Client conversations: a notification opens `?target=<id>&open=<id>` straight into that thread, where the admin replies. */
export default function Chats() {
  const { t } = useT();
  const chats = useAdminChats(s => s.chats);
  const loaded = useAdminChats(s => s.loaded);
  const [open, setOpen] = useViewState<string | null>('open', null);
  const { target, open: requested } = useLocalSearchParams<{ target?: string; open?: string }>();
  useFocusEffect(React.useCallback(() => { void useAdminChats.getState().load().catch(() => {}); }, []));
  const opened = React.useRef('');
  React.useEffect(() => {
    if (requested && opened.current !== requested && chats.some(c => c.id === requested)) { opened.current = requested; setOpen(requested); }
  }, [requested, chats, setOpen]);
  const menuOf = (chat: AdminConversation): MenuItem[] => [
    { key: 'open', label: t('inbox.reply'), icon: 'message-reply-text-outline', onPress: () => setOpen(chat.id) },
    ...(chat.guest || !chat.whatsapp ? [] : [
      sep('s1'),
      { key: 'wa', label: t('inbox.openWa'), icon: 'whatsapp', onPress: () => Linking.openURL(waLink(chat.whatsapp, '')) } as MenuItem,
      { key: 'copy', label: t('ax.copyNumber'), icon: 'content-copy', onPress: () => { try { void (globalThis as any).navigator?.clipboard?.writeText(chat.whatsapp); toast(t('ax.copied')); } catch { /* clipboard unavailable */ } } } as MenuItem,
    ]),
  ];
  const missing = !!requested && loaded && !chats.some(c => c.id === requested);
  return (
    <AdminPage title={t('inbox.chatsTitle')}>
      {missing ? <Txt testID="admin-chat-missing" className="text-muted text-[13px] mb-3">{t('inbox.notFound')}</Txt> : null}
      {!chats.length && !loaded ? <AdminLoading /> : !chats.length ? <EmptyState icon="message-text-outline" title={t('inbox.empty')} subtitle={t('inbox.emptySub')} /> : (
        <View className="gap-2.5">
          {chats.map(chat => (
            <SearchTarget key={chat.id} id={chat.id}><RightClick items={() => menuOf(chat)}>
              <Pressable testID={`admin-chat-${chat.id}`} accessibilityRole="button" onPress={() => setOpen(chat.id)} className="active:opacity-70">
                <Card className={`p-3.5 flex-row items-center gap-3 ${target === chat.id ? 'border-primary' : ''}`}>
                  <View className="w-11 h-11 rounded-full bg-soft items-center justify-center"><Icon name="account-outline" size={22} tone="primary" /></View>
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between gap-2">
                      <Txt className="font-bold text-[15px] flex-1" numberOfLines={1}>{chat.guest ? t('inbox.guest') : chat.clientName}</Txt>
                      <Txt className="text-muted text-[11px]">{new Date(chat.updatedAt).toLocaleDateString()}</Txt>
                    </View>
                    <Txt className="text-muted text-[13px] mt-0.5" numberOfLines={1}>{preview(chat, t('inbox.photo'))}</Txt>
                  </View>
                </Card>
              </Pressable>
            </RightClick></SearchTarget>
          ))}
        </View>
      )}
      <Thread id={open} onClose={() => setOpen(null)} />
    </AdminPage>
  );
}
