import { uploadDataUrl } from '@/lib/media';

/** First frame of a video (local file or URL) -> stored image URL (`/api/media/...`), or '' when it cannot be captured. Never throws. */
export async function posterForVideo(source: string | Blob): Promise<string> {
  if (typeof source !== 'string') return '';
  try {
    const { createVideoPlayer } = await import('expo-video');
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    const player = createVideoPlayer(source);
    try {
      const [frame] = await player.generateThumbnailsAsync([0.1], { maxWidth: 640 });
      if (!frame) return '';
      const image = await (await ImageManipulator.manipulate(frame).renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
      return image.base64 ? await uploadDataUrl(`data:image/jpeg;base64,${image.base64}`, 'poster') : '';
    } finally { player.release(); }
  } catch { return ''; }
}
