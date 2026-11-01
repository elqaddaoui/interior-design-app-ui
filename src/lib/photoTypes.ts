/**
 * 'permission' = the OS really refused camera access (only possible on native).
 * 'failed'     = the picker or the image could not be read: never reported as a permission problem.
 */
export type PickResult = { uri: string } | { error: 'permission' | 'failed' | 'cancelled' };
export type PickOptions = { preserveTransparency?: boolean };
/** Several pictures at once (gallery multi-select). `uris` keeps the order the person chose; `failed` counts pictures that could not be read. */
export type PickManyResult = { uris: string[]; failed: number } | { error: 'failed' | 'cancelled' };
export type PickManyOptions = PickOptions & { limit?: number };
