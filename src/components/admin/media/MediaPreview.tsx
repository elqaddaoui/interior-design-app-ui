import React, { useEffect } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon } from '@/components/ui/Icon';
import type { LibItem } from '@/lib/mediaLibrary';

/** A frame of the video is enough for a thumbnail: `#t=0.1` makes browsers paint it without playing. */
const frameUrl = (url: string) => (url.includes('#') ? url : `${url}#t=0.1`);

function NativeVideo({ uri, play, controls, fit }: { uri: string; play: boolean; controls: boolean; fit: 'cover' | 'contain' }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = !controls; });
  useEffect(() => { if (play) player.play(); else player.pause(); }, [player, play]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={controls} allowsPictureInPicture={false} playsInline />;
}

/**
 * Preview of one library file. Pictures are plain images. Videos always show a picture: their first frame, or playing (muted, looping) when
 * `autoplay` is on. `controls` (the details sheet) adds the player's own controls.
 */
export function MediaPreview({ item, autoplay = false, controls = false, fit = 'cover', style }: { item: Pick<LibItem, 'kind' | 'url' | 'id'>; autoplay?: boolean; controls?: boolean; fit?: 'cover' | 'contain'; style?: StyleProp<ViewStyle> }) {
  if (item.kind === 'image') return <Image source={{ uri: item.url }} contentFit={fit} recyclingKey={item.id} style={[{ width: '100%', height: '100%' }, style as object]} />;
  if (item.kind === 'audio') return <View className="flex-1 items-center justify-center"><Icon name="music-note-outline" size={32} tone="muted" /></View>;
  return (
    <View style={[StyleSheet.absoluteFill, style]}>
      {Platform.OS === 'web'
        ? React.createElement('video', { key: `${item.url}:${autoplay}:${controls}`, src: frameUrl(item.url), muted: !controls, loop: true, playsInline: true, preload: 'metadata', autoPlay: autoplay, controls, style: { width: '100%', height: '100%', objectFit: fit, background: 'transparent' } })
        : <NativeVideo uri={item.url} play={autoplay} controls={controls} fit={fit} />}
    </View>
  );
}
