import { Platform } from 'react-native';
import { storage } from '@/data/mock/storage';

/**
 * Client signup link of a company: `/lead?tenant=<slug>` (or any app address with `?tenant=<slug>`).
 * The slug is read once at startup and kept on the device, so the person can wander through the app (the lead page sends
 * people back to the start until a design is chosen) and the sign-in still lands in the right company's workspace.
 * No slug = the default workspace. The server validates the slug and refuses unknown or suspended companies.
 */
const KEY = 'client-tenant';
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
let current: string | null | undefined;

/** The slug in an address (`?tenant=` or `&tenant=`), or null when there is none or it is not a valid slug. */
export function tenantFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /[?&]tenant=([^&#]*)/.exec(url);
  if (!match) return null;
  let value = '';
  try { value = decodeURIComponent(match[1]).trim().toLowerCase(); } catch { return null; }
  return SLUG.test(value) ? value : null;
}

/** Remember the company of the opened link. Called once at startup with the address the app was opened with. */
export async function captureTenant(url?: string | null): Promise<string | null> {
  const found = tenantFromUrl(url ?? (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : null));
  if (!found) return clientTenant();
  current = found;
  await storage.write(KEY, found);
  return found;
}

/** The company this device signs clients up under (null = default workspace). */
export async function clientTenant(): Promise<string | null> {
  if (current === undefined) current = (await storage.read<string>(KEY)) ?? null;
  return current;
}

/** Back to the default workspace (e.g. after the company link turned out to be unknown). */
export async function forgetTenant() { current = null; await storage.write(KEY, null); }
