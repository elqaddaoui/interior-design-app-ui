import { Image as RNImage } from 'react-native';
import * as Manipulator from 'expo-image-manipulator';

/** Card pictures are small: max ~600px wide, WebP. */
export const CARD_IMAGE_WIDTH = 600;

const sizeOf = (uri: string) => new Promise<number>((resolve) => RNImage.getSize(uri, (w) => resolve(w), () => resolve(0)));

/**
 * Re-encodes a picked picture as compressed WebP, max 600px wide (never enlarged).
 * Returns a data URL (the admin upload then stores it in media storage) or the input unchanged if re-encoding fails.
 */
export async function toCardWebp(uri: string): Promise<string> {
  try {
    const width = await sizeOf(uri);
    const out = await Manipulator.manipulateAsync(uri, width > CARD_IMAGE_WIDTH ? [{ resize: { width: CARD_IMAGE_WIDTH } }] : [], { compress: 0.8, format: Manipulator.SaveFormat.WEBP, base64: true });
    return out.base64 ? `data:image/webp;base64,${out.base64}` : out.uri;
  } catch { return uri; }
}
