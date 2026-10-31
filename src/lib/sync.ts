import { AppState, Platform } from 'react-native';
import type { UserPrefs } from '@/data/types';
import { api, backendEnabled, BackendError } from '@/lib/backend';
import { contentVersion } from '@/data/repositories/remoteContent';
import { onLangChosen, useLang } from '@/i18n';
import { reconcileDevice, syncLanguage } from '@/lib/notifications';
import { reloadUserSpace, useStore } from '@/store/useStore';
import { useLocal } from '@/store/useLocal';
import { usePrefs } from '@/store/usePrefs';
import { useUserSession } from '@/store/useUserSession';
import { useAdminChats } from '@/store/useAdminChats';
import { useAdminCampaigns } from '@/store/useAdminCampaigns';

/** What `GET /api/sync` returns: one monotonically increasing version per kind of data (null = not visible to this session). */
interface SyncState { content: number; requests: number | null; clients: number | null; chats?: number | null; campaigns?: number | null; admin: number | null; client: number | null; parts?: Partial<Record<UserPart, number>> | null; guest?: number | null; user: { id: string; blocked: boolean } | null; isAdmin: boolean }
const POLL_MS = 4000;
/** The parts of a client's own space the server versions separately (`parts` in the sync answer). */
type UserPart = 'conversations' | 'history' | 'requests';
const USER_PARTS: UserPart[] = ['conversations', 'history', 'requests'];
let seenParts: Partial<Record<UserPart, number>> | null = null;

type Seen = Partial<Record<'content' | 'requests' | 'clients' | 'chats' | 'campaigns' | 'admin' | 'client' | 'guest', number | null>>;
let seen: Seen = {};
let identity = '';
let running = false;

/** Loads the admin's saved preferences (also proves the stored admin session is still valid on the server). */
export async function refreshAdminSession() {
  const local = useLocal.getState();
  if (!backendEnabled || !local.adminSession || local.adminOffline) return;
  try {
    const result = await api<{ ok: true; prefs?: UserPrefs }>('/admin/session');
    usePrefs.getState().hydrate('admin', result.prefs ?? {});
  } catch (error) {
    if (error instanceof BackendError && error.status === 401) { useLocal.getState().set({ adminSession: false }); usePrefs.getState().clear('admin'); }
  }
}

/** One sync round: compare versions and reload only what changed, on every device, for every signed-in role. */
export async function syncOnce() {
  if (!backendEnabled || running) return;
  running = true;
  try {
    const state = await api<SyncState>('/sync', { client: true });
    const store = useStore.getState();
    const local = useLocal.getState();
    const session = useUserSession.getState();
    // A different person on this device: forget what the previous one had already seen.
    const now = `${local.adminSession && state.isAdmin ? 'a' : ''}:${session.user?.id ?? ''}`;
    if (now !== identity) { identity = now; seen = { content: seen.content }; seenParts = null; }
    const changed = (key: keyof Seen) => { const was = seen[key]; seen[key] = state[key]; return was !== undefined && was !== state[key] && state[key] != null; };
    // The first round compares against the snapshot the app booted with, so a change made in between is not lost.
    if (seen.content === undefined) seen.content = contentVersion();
    const jobs: Promise<unknown>[] = [];

    if (changed('content')) jobs.push(store.reloadContent(state.content));
    // The server forgot the admin session (expired / signed out elsewhere): leave the admin panel.
    if (local.adminSession && !local.adminOffline && !state.isAdmin) { useLocal.getState().set({ adminSession: false }); usePrefs.getState().clear('admin'); useAdminChats.getState().clear(); useAdminCampaigns.getState().clear(); }
    if (state.isAdmin && local.adminSession) {
      if (changed('requests')) jobs.push(store.reload('requests'));
      if (changed('clients')) jobs.push(store.reload('users'));
      if (changed('chats')) jobs.push(useAdminChats.getState().load());
      if (changed('campaigns') && useAdminCampaigns.getState().loaded) jobs.push(useAdminCampaigns.getState().load());
      if (changed('admin')) jobs.push(refreshAdminSession());
    }
    if (session.user) {
      if (state.user?.blocked) jobs.push(session.refresh()); // signs this device out
      else if (state.parts) {
        // Finer versions: only the part that changed is fetched (a chat message no longer reloads designs and requests). The profile/credits are refreshed whenever anything about this client changed.
        const before = seenParts;
        seenParts = state.parts;
        const parts = before ? USER_PARTS.filter(part => before[part] !== state.parts![part]) : [];
        const profile = changed('client');
        if (profile) jobs.push(session.refresh());
        if (parts.length) jobs.push(reloadUserSpace(parts));
      }
      else if (changed('client')) jobs.push(session.refresh().then(() => reloadUserSpace()));
    } else if (state.guest != null && changed('guest')) {
      // A signed-out visitor's chats are in the database too: an admin answer (or another tab) shows up here.
      jobs.push(store.reload('conversations'));
    } else if (state.client != null && !state.user?.blocked) {
      // The server recognises a client session this device has not loaded (signed in from the cookie).
      // A blocked account is skipped: retrying it every poll would only re-announce the block.
      jobs.push(session.refresh().then(() => reloadUserSpace()));
    }
    await Promise.allSettled(jobs);
  } catch { /* offline or server restarting: try again on the next tick */ }
  finally { running = false; }
}

/**
 * Web only: how long to wait between polls given the time since the person last touched the page. 4 s while in use; a tab
 * left open but untouched slows to 15 s after 2 minutes and 30 s after 10 minutes. Any click, key, scroll, focus or the
 * tab becoming visible again polls at once and returns to 4 s, so nothing visible to an active user changes. Native apps
 * keep the fixed 4 s (they only poll while in the foreground).
 */
export function webPollDelay(idleMs: number) {
  if (idleMs < 2 * 60000) return POLL_MS;
  if (idleMs < 10 * 60000) return 15000;
  return 30000;
}

/** Starts polling while the app is visible; returns the stop function. Inbound websockets are unavailable on serverless and shared hosting, so this is the real-time channel. */
export function startSync() {
  if (!backendEnabled) return () => {};
  void refreshAdminSession();
  const tick = () => { void syncOnce(); };
  const web = Platform.OS === 'web' && typeof document !== 'undefined' && typeof window !== 'undefined';
  let lastInput = Date.now(), lastPoll = 0;
  const poll = () => { lastPoll = Date.now(); tick(); };
  // A 1 s check (no request) decides whether a poll is due; requests follow webPollDelay on web, POLL_MS on native.
  const timer = setInterval(() => {
    if (!web) { if (Date.now() - lastPoll >= POLL_MS - 500) poll(); return; }
    if (document.hidden || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    if (Date.now() - lastPoll >= webPollDelay(Date.now() - lastInput) - 500) poll();
  }, 1000);
  const wake = () => { lastInput = Date.now(); if (!web || !document.hidden) poll(); };
  // Interaction only resets the idle clock; it polls immediately only if the page had already slowed down.
  const input = () => { const wasIdle = Date.now() - lastInput >= 2 * 60000; lastInput = Date.now(); if (wasIdle && !document.hidden) poll(); };
  const inputEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
  if (web) {
    document.addEventListener('visibilitychange', wake); window.addEventListener('focus', wake); window.addEventListener('online', wake);
    for (const name of inputEvents) window.addEventListener(name, input, { passive: true });
  }
  const app = Platform.OS === 'web' ? null : AppState.addEventListener('change', s => { if (s === 'active') poll(); });
  poll();
  return () => {
    clearInterval(timer);
    if (web) {
      document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); window.removeEventListener('online', wake);
      for (const name of inputEvents) window.removeEventListener(name, input);
    }
    app?.remove();
  };
}

/** Wires language choices and notification defaults to the database-backed preferences. Call once at startup. */
export function startPreferenceBindings() {
  // A language chosen on this device is saved for every identity that is signed in on it.
  const stopLang = onLangChosen(lang => {
    const signedIn = { client: !!useUserSession.getState().user, admin: useLocal.getState().adminSession && !useLocal.getState().adminOffline };
    void usePrefs.getState().saveEverywhere({ lang }, signedIn);
    if (signedIn.client) void syncLanguage('client', lang);
    if (signedIn.admin) void syncLanguage('admin', lang);
  });
  // Default notifications: whenever the preferences or the identity change, make this device match the saved setting.
  const run = () => {
    const lang = useLang.getState().lang;
    void reconcileDevice('client', lang);
    void reconcileDevice('admin', lang);
  };
  const unsubscribe = [usePrefs.subscribe(run), useUserSession.subscribe((s, p) => { if (s.user?.id !== p.user?.id) run(); }), useLocal.subscribe((s, p) => { if (s.adminSession !== p.adminSession) run(); })];
  run();
  return () => { stopLang(); unsubscribe.forEach(fn => fn()); };
}
