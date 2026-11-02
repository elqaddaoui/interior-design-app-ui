import { optimizeImage } from './imageOptimize';

/** Card pictures are small: max 800px wide, WebP (the same rule as the shared optimiser's `card` purpose). */
export const CARD_IMAGE_WIDTH = 800;

/**
 * Re-encodes a picked picture for a card: downscaled to at most 800px wide and saved as compressed WebP. The picture is NEVER cropped:
 * it keeps its own aspect ratio (the card only centre-fills it when it is displayed, so the original is never lost and the same picture
 * still works if the card height is changed later).
 * Returns a data URL (the admin upload then stores it in media storage) or the input unchanged if re-encoding fails.
 */
export async function toCardWebp(uri: string): Promise<string> {
  try { return await optimizeImage(uri, 'card', null); } catch { return uri; }
}
