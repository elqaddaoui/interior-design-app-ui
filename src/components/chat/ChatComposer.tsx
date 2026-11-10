import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { Txt, useAppFont } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { toast } from '@/store/useToast';
import { useReadOnly } from '@/components/ui/ReadOnly';
import { MAX_VOICE_MS, formatVoiceTime, useVoiceRecorder, type Recorded } from './voice';

/**
 * Web only: Enter sends, Shift+Enter adds a line. Not while an input method is composing (Arabic / Chinese / Japanese keyboards use Enter
 * to confirm a word) and not on touch screens, where the on-screen Enter key means "new line" and the send button is right there.
 */
export function enterSends(e: { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number } | undefined) {
  if (Platform.OS !== 'web' || !e || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return false;
  return !(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
}

/** Pulsing red dot while a voice note is being recorded. */
function RecDot() {
  const v = useSharedValue(1);
  useEffect(() => { v.value = withRepeat(withSequence(withTiming(0.25, { duration: 600 }), withTiming(1, { duration: 600 })), -1); }, [v]);
  const s = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[s, { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' }]} />;
}

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Sends what is typed (and anything staged by the caller). */
  onSend: () => void;
  /** Something is ready to send: text, or staged pictures. */
  canSend: boolean;
  placeholder: string;
  busy?: boolean;
  maxLength?: number;
  /** Paperclip: the caller opens its own attachment panel. Omit for a text-only bar. */
  onAttach?: () => void;
  attachOpen?: boolean;
  /** Camera shortcut inside the field while it is empty. */
  onCamera?: () => void;
  onFocus?: () => void;
  /** Number of staged pictures (shown on the send button when more than one). */
  badge?: number;
  /** Voice notes: the microphone replaces send while nothing is typed. Called with the finished recording. */
  onVoice?: (recorded: Recorded) => void | Promise<void>;
  ids?: { input?: string; send?: string; mic?: string; attach?: string; camera?: string };
}

const ROUND = 'w-12 h-12 rounded-full items-center justify-center';

/**
 * The ONE message bar of the app (client chat and admin inbox):
 *   [ + | text field ............ camera ]  (send | microphone)
 * Same 48 px height, same send glyph, same recording strip everywhere. Optional parts (attach, camera, voice) simply do not render.
 */
export function ChatComposer({ value, onChange, onSend, canSend, placeholder, busy, maxLength, onAttach, attachOpen, onCamera, onFocus, badge = 0, onVoice, ids, }: ChatComposerProps) {
  const { t } = useT();
  const { colors } = useTheme();
  const fontFamily = useAppFont();
  const locked = useReadOnly();
  const voice = useVoiceRecorder();
  const id = { input: 'chat-input', send: 'chat-send', mic: 'chat-mic', attach: 'chat-attach', camera: 'chat-camera', ...ids };
  const typed = !!value.trim();
  const showMic = !!onVoice && !typed && !canSend;

  const start = async () => {
    if (busy) return;
    const error = await voice.start();
    if (error === 'permission') toast(t('md.chat.micDenied')); else if (error) toast(t('md.chat.micFailed'));
  };
  const finish = async () => {
    const result = await voice.send();
    if (!result) return;
    if (typeof result === 'string') { toast(result === 'short' ? t('md.chat.tooShort') : t('md.chat.micFailed')); return; }
    await onVoice?.(result);
  };
  // A recording ends by itself at the cap, and is dropped (not sent) when the screen goes away.
  const finishRef = useRef(finish);
  useEffect(() => { finishRef.current = finish; });
  useEffect(() => { if (voice.recording && voice.elapsedMs >= MAX_VOICE_MS) void finishRef.current(); }, [voice.recording, voice.elapsedMs]);
  const cancelRef = useRef(voice.cancel);
  useEffect(() => { cancelRef.current = voice.cancel; });
  useEffect(() => () => { void cancelRef.current(); }, []);

  if (voice.recording) {
    return (
      <View testID="wa-recording" className="flex-row items-center gap-2 px-3 py-2.5">
        <Pressable testID="wa-voice-cancel" accessibilityRole="button" accessibilityLabel={t('md.chat.cancel')} onPress={() => voice.cancel()} className={`${ROUND} bg-surface2`}><Icon name="trash-can-outline" size={22} tone="danger" /></Pressable>
        <View className="flex-1 flex-row items-center gap-2.5 bg-surface2 rounded-3xl px-4" style={{ minHeight: 48 }}>
          <RecDot />
          <Txt testID="wa-voice-timer" className="text-[16px] leading-[22px] font-bold" style={{ fontVariant: ['tabular-nums'] }}>{formatVoiceTime(voice.elapsedMs)}</Txt>
          <Txt className="text-muted text-[12px] leading-[18px] flex-1" numberOfLines={1}>{t('md.chat.recording')}</Txt>
        </View>
        <Pressable testID="wa-voice-send" accessibilityRole="button" accessibilityLabel={t('md.chat.send')} onPress={finish} className={`${ROUND} bg-primary`}><Icon name="send" size={20} tone="onprimary" flip /></Pressable>
      </View>
    );
  }

  return (
    <View className="flex-row items-end gap-2 px-3 py-2.5">
      <View className="flex-1 flex-row items-end bg-surface2 rounded-3xl border border-line" style={{ minHeight: 48, paddingStart: onAttach ? 4 : 16, paddingEnd: 8 }}>
        {onAttach ? <Pressable testID={id.attach} accessibilityRole="button" accessibilityLabel={t('assistant.attach')} onPress={onAttach} className="h-12 w-10 items-center justify-center"><Icon name={attachOpen ? 'close' : 'paperclip'} size={22} tone="muted" /></Pressable> : null}
        <TextInput testID={id.input} editable={!locked} value={value} onChangeText={onChange} onFocus={onFocus} placeholder={placeholder} placeholderTextColor={colors.muted} multiline maxLength={maxLength}
          onKeyPress={(e: any) => { if (enterSends(e.nativeEvent)) { e.preventDefault?.(); if (!locked) onSend(); } }}
          style={{ fontFamily, flex: 1, color: colors.fg, fontSize: 16, maxHeight: 110, paddingVertical: 13, outlineStyle: 'none' } as any} />
        {onCamera && !typed && !canSend ? <Pressable testID={id.camera} accessibilityRole="button" accessibilityLabel={t('md.chat.camera')} onPress={onCamera} className="h-12 w-9 items-center justify-center"><Icon name="camera-outline" size={22} tone="muted" /></Pressable> : null}
      </View>
      {showMic ? (
        <Pressable testID={id.mic} accessibilityRole="button" accessibilityLabel={t('md.chat.voice')} disabled={busy || locked} onPress={start} className={`${ROUND} bg-primary active:opacity-80`} style={{ opacity: busy || locked ? 0.5 : 1 }}><Icon name="microphone" size={22} tone="onprimary" /></Pressable>
      ) : (
        <View>
          <Pressable testID={id.send} accessibilityRole="button" accessibilityLabel={t('md.chat.send')} accessibilityState={{ disabled: !canSend || !!busy || locked }} disabled={!canSend || !!busy || locked} onPress={onSend} className={`${ROUND} active:opacity-80 ${canSend ? 'bg-primary' : 'bg-surface2 border border-line'}`}>
            <Icon name="send" size={20} tone={canSend ? 'onprimary' : 'muted'} flip />
          </Pressable>
          {badge > 1 ? <View testID="wa-count" className="absolute -top-1 -end-1 min-w-[22px] h-[22px] px-1 rounded-full bg-ink items-center justify-center border-2 border-bg"><Txt className="text-onink text-[11px] leading-[14px] font-black">{badge}</Txt></View> : null}
        </View>
      )}
    </View>
  );
}
