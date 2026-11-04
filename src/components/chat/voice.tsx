import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import type { ChatAudio } from '@/data/types';

/** A voice note is capped so its base64 stays far below the server's 4 MB request limit (mono 64 kbit/s is about 0.5 MB per minute). */
export const MAX_VOICE_MS = 120000;
export const MIN_VOICE_MS = 800;
const RECORDING = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
  web: { bitsPerSecond: 48000 },
};

const fmt = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(`data:${mime};base64,${String(reader.result).split(',')[1] || ''}`);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/** What the server verifies and stores: the recorded file as a data URL (its real type is checked from the bytes there). */
async function recordingToDataUrl(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  // Web: the browser knows its container (webm/ogg/mp4). Native: the preset records AAC in an MP4 container (.m4a).
  const mime = Platform.OS === 'web' ? (blob.type && blob.type.startsWith('audio/') ? blob.type : blob.type.startsWith('video/webm') ? 'audio/webm' : 'audio/webm') : 'audio/mp4';
  return blobToDataUrl(blob, mime);
}

export type Recorded = { playUri: string; dataUrl: string; durationMs: number };
export type RecordError = 'permission' | 'failed' | 'short';

/** Tap-to-record voice notes (expo-audio on every platform; the browser uses MediaRecorder). */
export function useVoiceRecorder() {
  const recorder = useAudioRecorder(RECORDING);
  const state = useAudioRecorderState(recorder, 200);
  const [active, setActive] = React.useState(false);
  const startedAt = React.useRef(0);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setElapsed(Date.now() - startedAt.current), 200);
    return () => clearInterval(timer);
  }, [active]);

  const start = React.useCallback(async (): Promise<RecordError | null> => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) return 'permission';
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setElapsed(0);
      setActive(true);
      return null;
    } catch {
      setActive(false);
      return 'failed';
    }
  }, [recorder]);

  const finish = React.useCallback(async (keep: boolean): Promise<Recorded | RecordError | null> => {
    if (!active) return null;
    setActive(false);
    const durationMs = Date.now() - startedAt.current;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      if (!keep) return null;
      if (durationMs < MIN_VOICE_MS) return 'short';
      const uri = recorder.uri;
      if (!uri) return 'failed';
      return { playUri: uri, dataUrl: await recordingToDataUrl(uri), durationMs };
    } catch {
      return keep ? 'failed' : null;
    }
  }, [active, recorder]);

  return { recording: active, elapsedMs: elapsed, level: state.metering, start, send: () => finish(true), cancel: () => finish(false) };
}

/** One shared player for a whole thread: only one voice note plays at a time (like WhatsApp). */
export function useVoicePlayback() {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [id, setId] = React.useState<string | null>(null);
  const loaded = React.useRef<string | null>(null);

  React.useEffect(() => { if (status.didJustFinish) setId(null); }, [status.didJustFinish]);

  const toggle = React.useCallback(async (messageId: string, uri: string) => {
    if (id === messageId && status.playing) { player.pause(); return; }
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      if (loaded.current !== messageId) {
        player.replace(uri);
        loaded.current = messageId;
      } else if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.05)) {
        await player.seekTo(0);
      }
      setId(messageId);
      player.play();
    } catch { setId(null); }
  }, [id, player, status.currentTime, status.didJustFinish, status.duration, status.playing]);

  const seek = React.useCallback((messageId: string, fraction: number) => {
    if (loaded.current !== messageId || !(status.duration > 0)) return;
    void player.seekTo(Math.max(0, Math.min(1, fraction)) * status.duration);
  }, [player, status.duration]);

  return {
    playingId: id && status.playing ? id : null,
    activeId: id,
    seconds: status.currentTime,
    duration: status.duration,
    toggle,
    seek,
  };
}

export type VoicePlayback = ReturnType<typeof useVoicePlayback>;

const BARS = 30;
const heights = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: BARS }, () => { h = Math.imul(h ^ (h >>> 13), 1274126177); return 5 + Math.abs(h % 15); });
};

/** Play button, bars that fill while playing (tap a bar to jump there) and the length. */
export function VoiceBubble({ id, audio, playUri, playback, own }: { id: string; audio: ChatAudio; playUri?: string; playback: VoicePlayback; own?: boolean }) {
  const bars = React.useMemo(() => heights(id), [id]);
  const active = playback.activeId === id;
  const playing = playback.playingId === id;
  const known = active && playback.duration > 0 ? playback.duration * 1000 : audio.durationMs || 0;
  const fraction = active && playback.duration > 0 ? Math.min(1, playback.seconds / playback.duration) : 0;
  const shown = playing || (active && playback.seconds > 0) ? playback.seconds * 1000 : known;
  const fg = own ? '#ffffff' : undefined;
  const dim = own ? 'rgba(255,255,255,0.45)' : 'rgba(128,128,128,0.45)';
  const on = own ? '#ffffff' : '#7c5cff';
  return (
    <View testID={`voice-${id}`} className="flex-row items-center gap-2.5" style={{ width: 210, paddingVertical: 2 }}>
      <Pressable testID={`voice-play-${id}`} accessibilityRole="button" accessibilityLabel={playing ? 'pause' : 'play'} onPress={() => playback.toggle(id, playUri || audio.uri)} hitSlop={8}
        className="items-center justify-center rounded-full" style={{ width: 38, height: 38, backgroundColor: own ? 'rgba(255,255,255,0.22)' : 'rgba(128,128,128,0.2)' }}>
        <Icon name={playing ? 'pause' : 'play'} size={22} color={fg} tone="fg" />
      </Pressable>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <View className="flex-row items-center" style={{ height: 24, gap: 2 }}>
          {bars.map((h, i) => (
            <Pressable key={i} onPress={() => { if (!active) void playback.toggle(id, playUri || audio.uri); else playback.seek(id, (i + 0.5) / BARS); }} style={{ flex: 1, height: 24, justifyContent: 'center' }}>
              <View style={{ height: h, borderRadius: 2, backgroundColor: i / BARS < fraction ? on : dim }} />
            </Pressable>
          ))}
        </View>
        <Txt testID={`voice-time-${id}`} className="text-[11px] leading-[15px] mt-0.5" style={{ color: own ? 'rgba(255,255,255,0.85)' : undefined, opacity: own ? 1 : 0.65 }}>{fmt(shown)}</Txt>
      </View>
    </View>
  );
}

export { fmt as formatVoiceTime };
