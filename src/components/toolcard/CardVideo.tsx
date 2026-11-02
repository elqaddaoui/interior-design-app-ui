import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';

/**
 * The pre-rendered animation of a card (Admin > Performance): a muted, looping MP4 that fills the image zone.
 * It plays ONLY while `run` is true (the card has a pixel on screen, the tab and the app are in front) and pauses otherwise, so cards outside the
 * viewport cost nothing. The first picture is the poster: it is what shows until the first video frame, and what stays if the video cannot play
 * (`onFail` then lets the card fall back to the live animation).
 */
export function CardVideo({ uri, poster, run, onReady, onFail }: { uri: string; poster?: string; run: boolean; onReady?: () => void; onFail: () => void }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" /> : null}
      {Platform.OS === 'web' ? <WebLayer uri={uri} run={run} onReady={onReady} onFail={onFail} /> : <NativeLayer uri={uri} run={run} onReady={onReady} onFail={onFail} />}
    </View>
  );
}

type Layer = { uri: string; run: boolean; onReady?: () => void; onFail: () => void };

function WebLayer({ uri, run, onReady, onFail }: Layer) {
  const ref = useRef<HTMLVideoElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (run) void video.play().catch(() => { /* autoplay refused: the poster stays */ });
    else video.pause();
  }, [run, uri]);
  return React.createElement('video', {
    ref, src: uri, muted: true, loop: true, playsInline: true, preload: run ? 'auto' : 'metadata', 'aria-hidden': true, tabIndex: -1,
    style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: shown ? 1 : 0, pointerEvents: 'none' },
    onLoadedData: () => { setShown(true); onReady?.(); },
    onError: onFail,
  });
}

function NativeLayer({ uri, run, onReady, onFail }: Layer) {
  const [shown, setShown] = useState(false);
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; });
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => { if (status === 'error') onFail(); });
    return () => sub.remove();
  }, [player, onFail]);
  useEffect(() => { if (run) player.play(); else player.pause(); }, [run, player]);
  return <VideoView player={player} style={[StyleSheet.absoluteFill, { opacity: shown ? 1 : 0 }]} contentFit="cover" nativeControls={false} playsInline surfaceType="textureView" allowsPictureInPicture={false} onFirstFrameRender={() => { setShown(true); onReady?.(); }} />;
}
