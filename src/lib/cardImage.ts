import { Image as RNImage } from 'react-native';
import * as Manipulator from 'expo-image-manipulator';
import { cropToRatio } from './toolCardFx';

export { cropToRatio };

/** Card pictures are small: max 800px wide, WebP. */
export const CARD_IMAGE_WIDTH = 800;

const dims = (uri: string) => new Promise<{ w: number; h: number }>((resolve) => RNImage.getSize(uri, (w, h) => resolve({ w, h }), () => resolve({ w: 0, h: 0 })));

/**
 * Re-encodes a picked picture for a card: auto-cropped (centered) to the card's aspect ratio when `ratio` is given, then
 * downscaled to at most 800px wide (never enlarged) and saved as compressed WebP, so every image of a card has the card's shape
 * and the reveal never has to re-crop anything.
 * Returns a data URL (the admin upload then stores it in media storage) or the input unchanged if re-encoding fails.
 */
export async function toCardWebp(uri: string, ratio?: number): Promise<string> {
  try {
    const { w, h } = await dims(uri);
    const actions: Manipulator.Action[] = [];
    const crop = ratio ? cropToRatio(w, h, ratio) : null;
    if (crop) actions.push({ crop });
    const outW = crop ? crop.width : w;
    if (outW > CARD_IMAGE_WIDTH) actions.push({ resize: { width: CARD_IMAGE_WIDTH } });
    const out = await Manipulator.manipulateAsync(uri, actions, { compress: 0.8, format: Manipulator.SaveFormat.WEBP, base64: true });
    return out.base64 ? `data:image/webp;base64,${out.base64}` : out.uri;
  } catch { return uri; }
}
