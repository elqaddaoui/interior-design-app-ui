import { Platform } from 'react-native';
import * as paths from './tenantPath';

/**
 * Which tenant this web page belongs to. The HTML shell sets `window.__DWIRA_BASE__` ('' or the slug) before any JavaScript runs
 * (scripts/postexport.js, src/lib/tenantPath.js shellScript); the Babel plugin (scripts/babel-tenant-base.js) hands the same value to
 * expo-router so every link and URL carries the prefix. Native apps and custom domains live at the root: base ''.
 * In the Metro dev server the shell script does not run, so development always shows the default tenant.
 */
declare global { interface Window { __DWIRA_BASE__?: string; __DWIRA_PFX?: string } }

/** '' or '/slug'. */
export const tenantBase = (): string => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  const slug = window.__DWIRA_BASE__;
  return slug ? `/${slug}` : '';
};
export const withBase = (path: string) => paths.withBase(tenantBase(), path);
export const stripBase = (path: string) => paths.stripBase(tenantBase(), path);
export const storagePrefix = () => paths.storagePrefix(tenantBase());
export const isForeignKey = (key: string) => paths.isForeignKey(tenantBase(), key);
export const mediaUrl = <T,>(value: T): T => paths.mediaUrl(tenantBase(), value);
export const canonicalMediaUrl = <T,>(value: T): T => paths.canonicalMediaUrl(tenantBase(), value);
export const canonicalMedia = <T,>(value: T): T => (tenantBase() ? paths.mapStrings(value, paths.canonicalMediaUrl.bind(null, tenantBase()) as (text: string) => string) : value);
