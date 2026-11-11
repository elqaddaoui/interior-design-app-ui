export const ROUTES: string[];
export const INFRA: string[];
export const PLATFORM: string[];
export const RESERVED: Set<string>;
export const SLUG: RegExp;
export function slugProblem(slug: unknown): 'invalid' | 'reserved' | null;
export function looksLikeSlug(segment: unknown): boolean;
export function isReserved(value: string): boolean;
