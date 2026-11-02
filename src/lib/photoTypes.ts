import type { ImagePurpose } from './imageOptimizeCore';

/**
 * 'permission' = the OS really refused camera access (only possible on native).
 * 'failed'     = the picker or the image could not be read: never reported as a permission problem.
 */
export type PickResult = { uri: string } | { error: 'permission' | 'failed' | 'cancelled' };
export type PickOptions = { preserveTransparency?: boolean; /** What the picture is for (sets the size cap and format, see imageOptimizeCore). Default: 'photo', or 'asset' when transparency is preserved. */ purpose?: ImagePurpose };
/** Several pictures at once (gallery multi-select). `uris` keeps the order the person chose; `failed` counts pictures that could not be read. */
export type PickManyResult = { uris: string[]; failed: number } | { error: 'failed' | 'cancelled' };
export type PickManyOptions = PickOptions & { limit?: number };
