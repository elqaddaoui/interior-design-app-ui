import React, { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { useViewState } from '@/hooks/useViewState';
import { useStore } from '@/store/useStore';
import { useUserSession } from '@/store/useUserSession';
import { services, VISITOR } from '@/data/repositories';
import { useL, useT } from '@/i18n';
import { Icon } from '@/components/ui/Icon';
import { ImageViewer, type ViewerItem } from '@/components/ui/ImageViewer';
import { Txt, useAppFont } from '@/components/ui/Txt';
import { pickPhoto, pickPhotos } from '@/lib/photo';
import { uid } from '@/lib/uid';
import { replyDelayMs, typeStep } from '@/lib/chatPace';
import { useTheme } from '@/theme/ThemeProvider';
import { toast } from '@/store/useToast';
import { MAX_VOICE_MS, VoiceBubble, formatVoiceTime, useVoicePlayback, useVoiceRecorder } from './voice';
import type { ChatMessage, Conversation } from '@/data/types';

const MAX_IMAGES = 10;

/**
 * Web only: Enter sends, Shift+Enter adds a line. Not while an input method is composing (Arabic / Chinese / Japanese keyboards use Enter to
 * confirm a word) and not on touch screens, where the on-screen Enter key means "new line" and the send button is right there.
 */
function enterSends(e: { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number } | undefined) {
  if (Platform.OS !== 'web' || !e || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return false;
  return !(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
}

function Dot({ d }: { d: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => { v.value = withDelay(d, withRepeat(withSequence(withTiming(1, { duration: 350 }), withTiming(0.3, { duration: 350 })), -1)); }, [d, v]);
  const s = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={s} className="w-2 h-2 rounded-full bg-muted" />;
}

const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayKey = (time: number) => { const d = new Date(time); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
/** "Today" / "Yesterday" / the date. Outside the component: it reads the clock. */
function dayName(time: number, t: (key: string) => string) {
  const now = Date.now(), key = dayKey(time);
  return key === dayKey(now) ? t('md.chat.today') : key === dayKey(now - 86400000) ? t('md.chat.yesterday') : new Date(time).toLocaleDateString();
}

/** Pulsing red dot while a voice note is being recorded. */
function RecDot() {
  const v = useSharedValue(1);
  useEffect(() => { v.value = withRepeat(withSequence(withTiming(0.25, { duration: 600 }), withTiming(1, { duration: 600 })), -1); }, [v]);
  const s = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[s, { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' }]} />;
}

/**
 * WhatsApp-style chat: plain messages, voice notes (tap the mic, tap send), pictures that show at once and open in the viewer
 * with one tap, several pictures sent together with a caption. Same conversations, same AI replies, same admin inbox as the
 * classic chat; the admin switches between the two in Interface.
 */
export function WaChat({ conversationId, onCreated, header }: { conversationId?: string; onCreated?: (id: string) => void; header?: React.ReactNode }) {
  const { t } = useT();
  const L = useL();
  const { colors } = useTheme();
  const fontFamily = useAppFont();
  const config = useStore((s) => s.doc.assistant);
  const userId = useUserSession((s) => s.user?.id) || VISITOR;
  const conv = useStore((s) => s.conversations.find((c) => c.id === conversationId && c.userId === userId));
  const key = conversationId ?? 'new';
  const [text, setText] = useViewState(`wa:${key}:text`, '');
  const [staged, setStaged] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [typing, setTyping] = useState<{ id: string; shown: number } | null>(null);
  const [optimistic, setOptimistic] = useState<ChatMessage[] | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const list = useRef<FlatList>(null);
  const playUris = useRef<Record<string, string>>({});
  const playback = useVoicePlayback();
  const voice = useVoiceRecorder();
  const stored = conv?.messages;
  const messages = React.useMemo(() => optimistic ?? stored ?? [], [optimistic, stored]);

  const [offset, setOffset] = useViewState(`wa:${key}:scroll`, -1);
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
    const timer = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [messages.length, busy]);

  // Every picture of the thread, in order: the viewer swipes through all of them.
  const shots: ViewerItem[] = React.useMemo(() => messages.filter((m) => m.image).map((m) => ({ uri: m.image as string, label: m.role === 'user' ? t('md.chat.photoMsg') : t('inbox.team') })), [messages, t]);
  const openShot = (message: ChatMessage) => setViewer(Math.max(0, messages.filter((m) => m.image).findIndex((m) => m.id === message.id)));

  /** Camera: one picture, staged at once. Gallery: the system picker lets the person tick several. */
  const addPictures = async (source: 'camera' | 'gallery') => {
    setPanel(false);
    const room = MAX_IMAGES - staged.length;
    if (room <= 0) return;
    if (source === 'camera') {
      const r = await pickPhoto('camera', { purpose: 'chat' });
      if ('uri' in r) setStaged((all) => [...all, r.uri].slice(0, MAX_IMAGES)); else if (r.error === 'permission') toast(t('wizard.permission')); else if (r.error === 'failed') toast(t('wizard.photoFailed'));
      return;
    }
    const r = await pickPhotos({ purpose: 'chat', limit: room });
    if ('uris' in r) { setStaged((all) => [...all, ...r.uris].slice(0, MAX_IMAGES)); if (r.failed) toast(t('wizard.photoFailed')); } else if (r.error === 'failed') toast(t('wizard.photoFailed'));
  };

  /** Saves the new messages, then (for text / pictures) asks the assistant, paced like a person. */
  const deliver = async (fresh: ChatMessage[], askAssistant: boolean) => {
    setBusy(true);
    const st = useStore.getState();
    let c: Conversation | undefined = conv;
    const base = c?.messages ?? [];
    const next = [...base, ...fresh];
    setOptimistic(next);
    const first = fresh[0];
    const title = (fresh.find((m) => m.text)?.text || '').slice(0, 40) || (first.audio ? t('md.chat.voiceMsg') : t('history.newChat'));
    try {
      if (!c) {
        c = await st.create('conversations', { userId, title, messages: next, updatedAt: Date.now() });
        onCreated?.(c.id);
      } else await st.update('conversations', c.id, { messages: next, updatedAt: Date.now() });
    } catch {
      setOptimistic(null); setBusy(false); toast(t('md.chat.failedSend'));
      return;
    }
    // From here the saved copy (with /api/media URLs) is what the list shows; the local file keeps playing the voice note.
    setOptimistic(null);
    if (!askAssistant) { setBusy(false); return; }
    const started = Date.now();
    let answer = '';
    try { answer = await services.chat.reply({ messages: next, config }); } catch { answer = t('assistant.error'); }
    const wait = replyDelayMs(config, answer) - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const am: ChatMessage = { id: uid('m'), role: 'assistant', text: answer, createdAt: Date.now() };
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

  const canSend = !busy && (!!text.trim() || staged.length > 0);
  const send = async () => {
    if (!canSend) return;
    const caption = text.trim();
    const pictures = staged;
    setText(''); setStaged([]);
    const now = Date.now();
    // WhatsApp: every picture is its own message; the caption goes with the last one.
    const fresh: ChatMessage[] = pictures.length
      ? pictures.map((image, i) => ({ id: uid('m'), role: 'user' as const, text: i === pictures.length - 1 ? caption : '', image, createdAt: now + i }))
      : [{ id: uid('m'), role: 'user', text: caption, createdAt: now }];
    await deliver(fresh, true);
  };

  const startVoice = async () => {
    if (busy) return;
    setPanel(false);
    const error = await voice.start();
    if (error === 'permission') toast(t('md.chat.micDenied')); else if (error) toast(t('md.chat.micFailed'));
  };
  const sendVoice = async () => {
    const result = await voice.send();
    if (!result) return;
    if (typeof result === 'string') { toast(result === 'short' ? t('md.chat.tooShort') : t('md.chat.micFailed')); return; }
    const id = uid('m');
    playUris.current[id] = result.playUri;
    // The assistant cannot hear: a voice note goes to the team (they are notified) and no automatic answer is made.
    await deliver([{ id, role: 'user', text: '', audio: { uri: result.dataUrl, durationMs: result.durationMs }, createdAt: Date.now() }], false);
  };
  // A recording ends by itself at the cap, and is dropped (not sent) when the screen goes away.
  const sendVoiceRef = useRef(sendVoice);
  useEffect(() => { sendVoiceRef.current = sendVoice; });
  useEffect(() => { if (voice.recording && voice.elapsedMs >= MAX_VOICE_MS) void sendVoiceRef.current(); }, [voice.recording, voice.elapsedMs]);
  const cancelRef = useRef(voice.cancel);
  useEffect(() => { cancelRef.current = voice.cancel; });
  useEffect(() => () => { void cancelRef.current(); }, []);

  const lastDay = (index: number) => (index === 0 ? '' : dayKey(messages[index - 1].createdAt));
  const dayLabel = (time: number) => dayName(time, t);

  const renderItem = ({ item: m, index }: { item: ChatMessage; index: number }) => {
    const own = m.role === 'user';
    const showDay = dayKey(m.createdAt) !== lastDay(index);
    const bubble = own ? 'bg-primary rounded-ee-md' : m.role === 'admin' ? 'bg-surface2 rounded-es-md border border-primary/40' : 'bg-surface2 rounded-es-md';
    const body = typing && typing.id === m.id ? m.text.slice(0, typing.shown) : m.text;
    return (
      <View>
        {showDay ? <View className="self-center rounded-full bg-surface2 px-3 py-1 my-2"><Txt className="text-muted text-[11px] leading-[16px] font-semibold">{dayLabel(m.createdAt)}</Txt></View> : null}
        <Animated.View entering={FadeInDown.duration(180)} className={`mb-1.5 ${own ? 'self-end' : 'self-start'}`} style={{ maxWidth: '84%' }}>
          {m.role === 'admin' ? <View testID={`chat-admin-${m.id}`} className="flex-row items-center gap-1 mb-1 ms-1"><Icon name="face-agent" size={14} tone="primary" /><Txt className="text-[11px] font-bold text-primary">{t('inbox.team')}</Txt></View> : null}
          <View testID={`wa-msg-${m.role}`} className={`rounded-2xl overflow-hidden ${bubble}`} style={{ padding: m.image && !m.text ? 3 : 8, paddingHorizontal: m.image && !m.text ? 3 : 11 }}>
            {m.image ? (
              <Pressable testID={`wa-image-${m.id}`} onPress={() => openShot(m)} accessibilityRole="imagebutton" accessibilityLabel={t('md.viewer.open')} className="active:opacity-90">
                <Image source={{ uri: m.image }} style={{ width: 232, height: 232, borderRadius: 14, marginBottom: m.text ? 6 : 0 }} contentFit="cover" transition={0} cachePolicy="memory-disk" recyclingKey={m.id} />
              </Pressable>
            ) : null}
            {m.audio ? <VoiceBubble id={m.id} audio={m.audio} playUri={playUris.current[m.id]} playback={playback} own={own} /> : null}
            {body ? <Txt className={`text-[15px] leading-[22px] ${own ? 'text-onprimary' : ''}`}>{body}</Txt> : null}
            <Txt className="text-[10px] leading-[14px] self-end mt-0.5" style={{ color: own ? 'rgba(255,255,255,0.75)' : undefined, opacity: own ? 1 : 0.55, position: m.image && !m.text ? 'absolute' : 'relative', bottom: m.image && !m.text ? 9 : undefined, end: m.image && !m.text ? 10 : undefined, ...(m.image && !m.text ? { color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 } : null) } as any}>{clock(m.createdAt)}</Txt>
          </View>
        </Animated.View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      {header}
      <FlatList
        ref={list}
        extraData={[typing, playback.activeId, playback.playingId, playback.seconds]}
        scrollEventThrottle={16}
        onScroll={(event) => { if (!restoring.current) setOffset(event.nativeEvent.contentOffset.y); }}
        onContentSizeChange={() => { if (restoring.current) restore(); }}
        onScrollBeginDrag={() => setPanel(false)}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Animated.View entering={FadeInDown.duration(400)} className="flex-1 items-center justify-center py-12">
            <Icon name="star-four-points" size={34} tone="primary" />
            <Txt className="text-[22px] font-extrabold text-center mt-3">{t('assistant.hello')}</Txt>
            {L(config.welcome) ? <Txt className="text-muted text-center mt-2 px-6">{L(config.welcome)}</Txt> : <Txt className="text-muted text-center mt-2 px-6">{t('md.chat.empty')}</Txt>}
          </Animated.View>
        }
        renderItem={renderItem}
        ListFooterComponent={busy && !optimistic ? <View testID="chat-typing" accessibilityLabel={t('assistant.typing')} className="self-start bg-surface2 rounded-2xl px-4 py-3.5 flex-row gap-1.5 items-center mt-1"><Dot d={0} /><Dot d={150} /><Dot d={300} /></View> : null}
      />

      {staged.length ? (
        <View testID="wa-staged" className="px-3 pt-2 pb-1 border-t border-line bg-bg">
          <FlatList horizontal data={staged} keyExtractor={(uri, i) => `${i}:${uri.slice(-24)}`} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 8, paddingEnd: 8 }}
            renderItem={({ item: uri, index }) => (
              <View style={{ width: 76, height: 76 }}>
                <Image source={{ uri }} style={{ width: 76, height: 76, borderRadius: 12 }} contentFit="cover" transition={0} />
                <Pressable testID={`wa-unstage-${index}`} accessibilityRole="button" accessibilityLabel={t('md.chat.cancel')} onPress={() => setStaged((all) => all.filter((_, i) => i !== index))} hitSlop={6} className="absolute -top-2 -end-2 w-6 h-6 rounded-full bg-danger items-center justify-center"><Icon name="close" size={14} color="#fff" /></Pressable>
              </View>
            )}
            ListFooterComponent={staged.length < MAX_IMAGES ? <Pressable testID="wa-add-more" accessibilityRole="button" accessibilityLabel={t('md.chat.photos')} onPress={() => addPictures('gallery')} className="items-center justify-center rounded-xl bg-surface2" style={{ width: 76, height: 76 }}><Icon name="plus" size={26} tone="muted" /></Pressable> : null}
          />
        </View>
      ) : null}

      {panel ? (
        <View testID="wa-panel" className="mx-3 mb-1.5 rounded-2xl bg-surface border border-line flex-row justify-around py-3.5 px-2" style={{ shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 5 }}>
          {([['camera', 'camera-outline', '#e0457b'], ['gallery', 'image-multiple-outline', '#7c5cff']] as const).map(([k, icon, tint]) => (
            <Pressable key={k} testID={`wa-pick-${k}`} accessibilityRole="button" onPress={() => addPictures(k)} className="items-center gap-1.5 active:opacity-70" style={{ minWidth: 92 }}>
              <View className="items-center justify-center rounded-full" style={{ width: 54, height: 54, backgroundColor: tint }}><Icon name={icon} size={26} color="#fff" /></View>
              <Txt className="text-[12px] leading-[18px] font-semibold">{t(`md.chat.${k}`)}</Txt>
            </Pressable>
          ))}
        </View>
      ) : null}

      {voice.recording ? (
        <View testID="wa-recording" className="flex-row items-center gap-2 px-3 py-2.5">
          <Pressable testID="wa-voice-cancel" accessibilityRole="button" accessibilityLabel={t('md.chat.cancel')} onPress={() => voice.cancel()} className="w-12 h-12 rounded-full bg-surface2 items-center justify-center"><Icon name="trash-can-outline" size={22} tone="danger" /></Pressable>
          <View className="flex-1 flex-row items-center gap-2.5 bg-surface2 rounded-3xl px-4" style={{ minHeight: 48 }}>
            <RecDot />
            <Txt testID="wa-voice-timer" className="text-[16px] leading-[22px] font-bold" style={{ fontVariant: ['tabular-nums'] }}>{formatVoiceTime(voice.elapsedMs)}</Txt>
            <Txt className="text-muted text-[12px] leading-[18px] flex-1" numberOfLines={1}>{t('md.chat.recording')}</Txt>
          </View>
          <Pressable testID="wa-voice-send" accessibilityRole="button" accessibilityLabel={t('md.chat.send')} onPress={sendVoice} className="w-12 h-12 rounded-full bg-primary items-center justify-center"><Icon name="send" size={20} tone="onprimary" flip /></Pressable>
        </View>
      ) : (
        <View className="flex-row items-end gap-2 px-3 py-2.5">
          <View className="flex-1 flex-row items-end bg-surface2 rounded-3xl ps-1 pe-2" style={{ minHeight: 48 }}>
            <Pressable testID="chat-attach" accessibilityRole="button" accessibilityLabel={t('assistant.attach')} onPress={() => setPanel((v) => !v)} className="h-12 w-10 items-center justify-center"><Icon name={panel ? 'close' : 'paperclip'} size={22} tone="muted" /></Pressable>
            <TextInput testID="chat-input" value={text} onChangeText={setText} onFocus={() => setPanel(false)} placeholder={staged.length ? t('md.chat.caption') : t('assistant.placeholder')} placeholderTextColor={colors.muted} multiline
              onKeyPress={(e: any) => { if (enterSends(e.nativeEvent)) { e.preventDefault?.(); void send(); } }}
              style={{ fontFamily, flex: 1, color: colors.fg, fontSize: 16, maxHeight: 110, paddingVertical: 13, outlineStyle: 'none' } as any} />
            {!text.trim() && !staged.length ? <Pressable testID="chat-camera" accessibilityRole="button" accessibilityLabel={t('md.chat.camera')} onPress={() => addPictures('camera')} className="h-12 w-9 items-center justify-center"><Icon name="camera-outline" size={22} tone="muted" /></Pressable> : null}
          </View>
          {text.trim() || staged.length ? (
            <View>
              <Pressable testID="chat-send" accessibilityRole="button" accessibilityLabel={t('md.chat.send')} disabled={!canSend} onPress={send} className="w-12 h-12 rounded-full bg-primary items-center justify-center active:opacity-80"><Icon name="send" size={20} tone="onprimary" flip /></Pressable>
              {staged.length > 1 ? <View testID="wa-count" className="absolute -top-1 -end-1 min-w-[22px] h-[22px] px-1 rounded-full bg-ink items-center justify-center border-2 border-bg"><Txt className="text-onink text-[11px] leading-[14px] font-black">{staged.length}</Txt></View> : null}
            </View>
          ) : (
            <Pressable testID="chat-mic" accessibilityRole="button" accessibilityLabel={t('md.chat.voice')} disabled={busy} onPress={startVoice} className="w-12 h-12 rounded-full bg-primary items-center justify-center active:opacity-80"><Icon name="microphone" size={22} tone="onprimary" /></Pressable>
          )}
        </View>
      )}
      <ImageViewer items={shots} index={viewer} onIndexChange={setViewer} onClose={() => setViewer(null)} />
    </KeyboardAvoidingView>
  );
}
