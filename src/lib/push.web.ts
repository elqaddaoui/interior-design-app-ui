import type { Lang } from '@/data/types';

import { api, backendEnabled } from './backend';
import { tenantBase } from './tenant';

/** Whose notifications a device subscription is for. A browser can serve an admin and a client at once. */
export type PushOwner = 'admin' | 'client';
const ownerBody = (owner: PushOwner) => (owner === 'client' ? { owner } : {});

/** `install`: iPhone/iPad Safari only delivers web push to an app added to the Home Screen. */
export type PushStatus = 'enabled' | 'disabled' | 'blocked' | 'unsupported' | 'unconfigured' | 'install';

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);
const isIos = () => /iPad|iPhone|iPod/.test(ua()) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => (typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true));
const supported = () => typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}
// One service worker registration PER TENANT (scope `/slug/`): tenants share an origin, so a shared worker would share push subscriptions.
const scopePath = () => `${tenantBase()}/`;
async function existingRegistration() {
  const worker = await navigator.serviceWorker.getRegistration(scopePath());
  // getRegistration answers with the closest registration, which may be the default tenant's (scope `/`): only an exact scope is ours.
  return worker && new URL(worker.scope).pathname === scopePath() ? worker : undefined;
}
async function registration() {
  const base = tenantBase();
  const registered = await navigator.serviceWorker.register(`/push-sw.js${base ? `?b=${base.slice(1)}` : ''}`, { scope: scopePath(), updateViaCache: 'none' });
  // `ready` resolves once a worker controls the scope, including on the very first visit.
  const ready = await navigator.serviceWorker.ready;
  return new URL(ready.scope).pathname === scopePath() ? ready : registered;
}
export async function pushStatus(): Promise<PushStatus> {
  if (!backendEnabled) return 'unconfigured';
  if (!supported()) return isIos() && !standalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const worker = await existingRegistration();
  return worker && await worker.pushManager.getSubscription() ? 'enabled' : 'disabled';
}
/** True when the browser already allows notifications (no prompt needed to subscribe this device). */
export async function pushGranted() { return backendEnabled && supported() && Notification.permission === 'granted'; }
/**
 * Subscribes this device for `owner`. With `prompt` (default) it must be called from a tap/click handler and asks for
 * permission; with `prompt: false` it only works when permission was already granted and never shows UI.
 * Throws a BackendError when the server is unreachable or the session is missing.
 */
export async function enablePush(language: Lang, owner: PushOwner = 'admin', prompt = true): Promise<PushStatus> {
  if (!backendEnabled || !supported()) return pushStatus();
  // Must be the first await: browsers (notably Safari) only show the prompt inside the user gesture.
  const permission = prompt ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'disabled';
  const config = await api<{ publicKey: string | null }>('/push/config');
  if (!config.publicKey) return 'unconfigured';
  const worker = await registration();
  let subscription = await worker.pushManager.getSubscription();
  const expected = keyBytes(config.publicKey);
  const existing = subscription?.options.applicationServerKey;
  if (subscription && existing && Array.from(new Uint8Array(existing)).join(',') !== Array.from(expected).join(',')) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ||= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expected });
  // Only "enabled" once the authenticated backend has stored it.
  await api('/push/subscriptions', { method: 'POST', body: { kind: 'web', subscription: subscription.toJSON(), language, ...ownerBody(owner) } });
  return 'enabled';
}
export async function syncPushLanguage(language: Lang, owner: PushOwner = 'admin') {
  if (!backendEnabled || !supported() || Notification.permission !== 'granted') return;
  const worker = await existingRegistration();
  const subscription = await worker?.pushManager.getSubscription();
  if (subscription) await api('/push/subscriptions', { method: 'POST', body: { kind: 'web', subscription: subscription.toJSON(), language, ...ownerBody(owner) } });
}
/** Stops notifications for `owner` on this device. The browser subscription itself is only dropped when `keepDevice` is false. */
export async function disablePush(owner: PushOwner = 'admin', keepDevice = false) {
  if (!supported()) return;
  const worker = await existingRegistration();
  const subscription = await worker?.pushManager.getSubscription();
  if (!subscription) return;
  try { await api('/push/subscriptions', { method: 'DELETE', body: { kind: 'web', subscription: subscription.toJSON(), ...ownerBody(owner) } }); }
  finally { if (!keepDevice) await subscription.unsubscribe(); }
}
/** Sends a real notification through the server to every registered device. */
export async function sendTestPush() { return api<{ ok: boolean; devices: number }>('/push/test', { method: 'POST', body: {} }); }
