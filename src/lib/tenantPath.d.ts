export function baseFromPath(pathname: string): string;
export function withBase(base: string, path: string): string;
export function stripBase(base: string, path: string): string;
export function storagePrefix(base: string): string;
export function isForeignKey(base: string, key: string): boolean;
export function mediaUrl<T>(base: string, value: T): T;
export function canonicalMediaUrl<T>(base: string, value: T): T;
export function mapStrings<T>(value: T, fn: (text: string) => string): T;
export function shellScript(): string;
