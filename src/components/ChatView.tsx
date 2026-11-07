import { useAppFont, Txt } from '@/components/ui/Txt';
import { QuickReplies } from '@/components/chat/QuickReplies';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { useViewState } from '@/hooks/useViewState';
import { useStore } from '@/store/useStore';
import { useUserSession } from '@/store/useUserSession';
import { services, VISITOR } from '@/data/repositories';
import { useL, useT } from '@/i18n';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { ImageViewer } from '@/components/ui/ImageViewer';
import { VoiceBubble, useVoicePlayback } from '@/components/chat/voice';
import { pickPhoto } from '@/lib/photo';
import { uid } from '@/lib/uid';
import { replyDelayMs, typeStep } from '@/lib/chatPace';
import { useTheme } from '@/theme/ThemeProvider';
import { toast } from '@/store/useToast';
import type { ChatMessage, Conversation } from '@/data/types';

function Dot({ d }: { d: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => { v.value = withDelay(d, withRepeat(withSequence(withTiming(1, { duration: 350 }), withTiming(0.3, { duration: 350 })), -1)); }, [d, v]);
  const s = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={s} className="w-2 h-2 rounded-full bg-muted" />;
}

/** AI chat: persisted conversations, image attach, free-provider replies (Darija / Arabic / French aware) paced like a person. */
export function ChatView({ conversationId, onCreated, header }: { conversationId?: string; onCreated?: (id: string) => void; header?: React.ReactNode }) {
  const { t } = useT();
  const L = useL();
  const { colors } = useTheme();
  const fontFamily = useAppFont();
  const config = useStore((s) => s.doc.assistant);
  const userId = useUserSession(s => s.user?.id) || VISITOR;
  const conv = useStore((s) => s.conversations.find((c) => c.id === conversationId && c.userId === userId));
  const [text, setText] = useViewState(`chat:${conversationId ?? 'new'}:text`, '');
  const [image, setImage] = useViewState(`chat:${conversationId ?? 'new'}:image`, '');
  const [busy, setBusy] = useState(false);
  // The assistant message currently being "typed" (cosmetic: the full text is already saved) and how much of it shows.
  const [typing, setTyping] = useState<{ id: string; shown: number } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const [attach, setAttach] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const playback = useVoicePlayback();
  const list = useRef<FlatList>(null);
  const [local, setLocal] = useState<ChatMessage[]>([]);
  const messages = conv?.messages ?? local;

  const [offset, setOffset] = useViewState(`chat:${conversationId ?? 'new'}:scroll`, -1);
  const restoring = useRef(true);
  const latestOffset = useRef(offset);
  React.useLayoutEffect(() => { latestOffset.current = offset; }, [offset]);
  const restore = React.useCallback(() => {
    if (latestOffset.current < 0) list.current?.scrollToEnd({ animated: false });
    else list.current?.scrollToOffset({ offset: latestOffset.current, animated: false });
  }, []);
  useFocusEffect(React.useCallback(() => {
    restoring.current = true;
    const timer = setTimeout(() => { restore(); restoring.current = false; }, 150);
    return () => { clearTimeout(timer); restoring.current = true; };
  }, [restore]));
  const previous = useRef({ length: messages.length, busy });
  useEffect(() => {
    const changed = previous.current.length !== messages.length || previous.current.busy !== busy;
    previous.current = { length: messages.length, busy };
    if (!changed) return;
    const timer = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [messages.length, busy]);

  const pick = async (src: 'camera' | 'gallery') => {
    setAttach(false);
    const r = await pickPhoto(src, { purpose: 'chat' });
    if ('uri' in r) setImage(r.uri); else if (r.error === 'permission') toast(t('wizard.permission')); else if (r.error === 'failed') toast(t('wizard.photoFailed'));
  };

  const [buttons, setButtons] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => { let on = true; services.chat.buttons().then((list) => { if (on) setButtons(list); }); return () => { on = false; }; }, []);

  const send = async (button?: { id: string; label: string }) => {
    const msg = button ? button.label : text.trim();
    const buttonId = button?.id;
    if ((!msg && !image) || busy) return;
    const um: ChatMessage = { id: uid('m'), role: 'user', text: msg, image: button ? undefined : image || undefined, createdAt: Date.now() };
    if (!button) setText('');
    setImage(''); setBusy(true);
    const st = useStore.getState();
    let c: Conversation | undefined = conv;
    const base = c?.messages ?? [];
    const next = [...base, um];
    if (!c) {
      c = await st.create('conversations', { userId, title: msg.slice(0, 40) || t('history.newChat'), messages: next, updatedAt: Date.now() });
      onCreated?.(c.id);
    } else await st.update('conversations', c.id, { messages: next, updatedAt: Date.now() });
    setLocal(next);
    // The typing indicator is already showing (busy). The answer is requested right away; it is then held back just
    // long enough to feel written by a person, counting the time the request itself took.
    const started = Date.now();
    let answer = '';
    let meta: ChatMessage['meta'];
    try { const out = await services.chat.reply({ messages: next, config, ...(buttonId ? { buttonId } : {}) }); answer = out.text; meta = out.meta; } catch { answer = t('assistant.error'); }
    const wait = replyDelayMs(config, answer) - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const am: ChatMessage = { id: uid('m'), role: 'assistant', text: answer, createdAt: Date.now(), ...(meta ? { meta } : {}) };
    const animate = config.typewriter !== false && config.replyDelayMode !== 'off' && alive.current && answer.length > 0;
    if (animate) setTyping({ id: am.id, shown: 0 });
    await useStore.getState().update('conversations', c.id, { messages: [...next, am], updatedAt: Date.now() });
    setBusy(false);
    if (!animate) return;
    const step = typeStep(answer.length);
    for (let shown = step; alive.current; shown += step) {
      setTyping({ id: am.id, shown });
      if (shown >= answer.length) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    if (alive.current) setTyping(null);
  };

  const data = messages;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      {header}
      <FlatList
        ref={list}
        extraData={[typing, playback.activeId, playback.playingId, playback.seconds]}
        scrollEventThrottle={16}
        onScroll={(event) => { if (!restoring.current) setOffset(event.nativeEvent.contentOffset.y); }}
        onContentSizeChange={() => { if (restoring.current) restore(); }}
        data={data}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        ListEmptyComponent={
          <Animated.View entering={FadeInDown.duration(400)} className="flex-1 items-center justify-center py-12">
            <Icon name="star-four-points" size={34} tone="primary" />
            <Txt className="text-[22px] font-extrabold text-center mt-3">{t('assistant.hello')}</Txt>
            {L(config.welcome) ? <Txt className="text-muted text-center mt-2 px-6">{L(config.welcome)}</Txt> : null}
          </Animated.View>
        }
        renderItem={({ item: m }) => (
          <Animated.View entering={FadeInDown.duration(250)} className={`mb-2.5 max-w-[82%] ${m.role === 'user' ? 'self-end' : 'self-start'}`}>
            {m.role === 'admin' ? <View testID={`chat-admin-${m.id}`} className="flex-row items-center gap-1 mb-1 ms-1"><Icon name="face-agent" size={14} tone="primary" /><Txt className="text-[11px] font-bold text-primary">{t('inbox.team')}</Txt></View> : null}
            <View className={`rounded-2xl px-3.5 py-2.5 ${m.role === 'user' ? 'bg-primary rounded-ee-md' : m.role === 'admin' ? 'bg-surface2 rounded-es-md border border-primary/40' : 'bg-surface2 rounded-es-md'}`}>
              {m.image ? <Pressable testID={`chat-image-${m.id}`} accessibilityRole="imagebutton" onPress={() => setViewer(Math.max(0, messages.filter((x) => x.image).findIndex((x) => x.id === m.id)))}><Image source={{ uri: m.image }} style={{ width: 200, height: 140, borderRadius: 12, marginBottom: m.text ? 8 : 0 }} contentFit="cover" /></Pressable> : null}
              {m.audio ? <VoiceBubble id={m.id} audio={m.audio} playback={playback} own={m.role === 'user'} /> : null}
              {m.text ? <Txt className={`text-[15px] leading-[22px] ${m.role === 'user' ? 'text-onprimary' : ''}`}>{typing && typing.id === m.id ? m.text.slice(0, typing.shown) : m.text}</Txt> : null}
            </View>
          </Animated.View>
        )}
        ListFooterComponent={busy ? <View testID="chat-typing" accessibilityLabel={t('assistant.typing')} className="self-start bg-surface2 rounded-2xl px-4 py-3.5 flex-row gap-1.5 items-center"><Dot d={0} /><Dot d={150} /><Dot d={300} /></View> : null}
      />
      {buttons.length && !image && !text.trim() ? <QuickReplies items={buttons} busy={busy} onPick={send} /> : null}
      {image ? (
        <View className="px-4 pb-2 flex-row"><View><Image source={{ uri: image }} style={{ width: 64, height: 64, borderRadius: 12 }} /><Pressable onPress={() => setImage('')} className="absolute -top-2 -end-2 w-6 h-6 rounded-full bg-danger items-center justify-center"><Icon name="close" size={14} color="#fff" /></Pressable></View></View>
      ) : null}
      <View className="flex-row items-end gap-2 px-3 py-2.5">
        <View className="flex-1 flex-row items-end bg-surface2 rounded-3xl px-3 min-h-[48px]">
          <Pressable testID="chat-attach" onPress={() => setAttach(true)} className="h-12 w-9 items-center justify-center"><Icon name="image-plus" size={22} tone="muted" /></Pressable>
          <TextInput testID="chat-input" value={text} onChangeText={setText} placeholder={t('assistant.placeholder')} placeholderTextColor={colors.muted} multiline onSubmitEditing={() => send()}
            style={{ fontFamily, flex: 1, color: colors.fg, fontSize: 16, maxHeight: 110, paddingVertical: 13, outlineStyle: 'none' } as any} />
        </View>
        <Pressable testID="chat-send" onPress={() => send()} className={`w-12 h-12 rounded-full items-center justify-center ${text.trim() || image ? 'bg-primary' : 'bg-surface2'}`}>
          <Icon name="arrow-up" size={22} tone={text.trim() || image ? 'onprimary' : 'muted'} />
        </Pressable>
      </View>
      <Sheet visible={attach} onClose={() => setAttach(false)} title={t('assistant.attach')}>
        <View className="flex-row gap-3">
          {(['camera', 'gallery'] as const).map((k) => (
            <Pressable key={k} onPress={() => pick(k)} className="flex-1 items-center py-6 rounded-2xl bg-surface2 active:opacity-70"><Icon name={k === 'camera' ? 'camera-outline' : 'image-multiple-outline'} size={30} /><Txt className="font-bold mt-2">{t(`wizard.${k}`)}</Txt></Pressable>
          ))}
        </View>
      </Sheet>
      <ImageViewer items={messages.filter((m) => m.image).map((m) => ({ uri: m.image as string }))} index={viewer} onIndexChange={setViewer} onClose={() => setViewer(null)} />
    </KeyboardAvoidingView>
  );
}
