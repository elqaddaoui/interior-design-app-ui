/**
 * Notification centre of the console (the bell, the toasts and the browser notifications).
 *
 * The server keeps one small row per warning (a code + numbers, see server/notices.js); this module asks for them every few seconds,
 * writes the sentence in the owner's language (`noticeText`) and shows a toast for each new one. Once the owner turned notifications on for a
 * phone or browser, the server also pushes every notice to it (Web Push through public/sa-sw.js), so it appears even when Chrome is closed.
 * No e-mail and no server setup: the push keys are created automatically.
 */
import { Platform } from 'react-native';
import { create } from 'zustand';
import { sa, SaError, saMessage } from './api';
import { saLang, tr } from './i18n';
import type { Notice, NoticeList } from './types';

export const LIMIT_TITLE: Record<string, string> = {
  'neon.storage': 'Neon database storage', 'neon.compute': 'Neon compute hours', 'neon.egress': 'Neon network transfer',
  'r2.storage': 'R2 file storage', 'r2.classA': 'R2 write operations (Class A)', 'r2.classB': 'R2 read operations (Class B)',
};
export const API_RULE_NAME: Record<string, string> = {
  burst: 'Burst of API calls', daily: 'Daily API cap reached', spike: 'Usage spike', failures: 'Many failing API calls', probe: 'Repeated attempts while AI is switched off',
};
const WHERE: Record<string, string> = { vault: 'your backup vault', gdrive: 'Google Drive', dropbox: 'Dropbox' };

const GB = 1e9;
const bytes = (v: number) => (v >= GB ? `${(v / GB).toFixed(2)} GB` : `${(v / 1e6).toFixed(1)} MB`);
const figure = (id: string, v: number) => (/\.(storage|egress)$/.test(id) ? bytes(v) : id.endsWith('.compute') ? `${v.toFixed(1)} h` : Math.round(v).toLocaleString('en'));
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

/** The title and the sentence of a notification, in the language of the console. Unknown codes (a newer server) still show something. */
export function noticeText(n: Notice): { title: string; body: string } {
  const p = n.params;
  const s = (key: string) => String(p[key] ?? '');
  const x = (key: string) => Number(p[key]) || 0;
  if (n.code === 'limits.alert') {
    const id = s('id');
    const name = tr(LIMIT_TITLE[id] || id);
    const lines = [p.exceeded ? tr('The limit is reached. Back up all your data now.')
      : p.level === 'critical' ? tr('Very close to the limit. Back up all your data now.')
        : p.level === 'urgent' ? tr('Time to back up your data.') : tr('Getting close to the limit. Plan a backup soon.')];
    if (p.days != null && p.at != null) lines.push(tr('At the current pace it runs out around {date} (in about {days} days).', { date: day(x('at')), days: x('days') }));
    if (p.reserveNeed != null) lines.push(tr('Only {left} of transfer is left and a full backup needs about {need}. Back up now.', { left: figure(id, x('reserveLeft')), need: figure(id, x('reserveNeed')) }));
    const title = p.why === 'reminder' ? tr('{name} at {pct} % (reminder)', { name, pct: x('pct') }) : tr('{name} at {pct} %', { name, pct: x('pct') });
    return { title, body: lines.join(' ') };
  }
  if (n.code === 'limits.blind') {
    return { title: tr('{name} cannot be read', { name: s('service') === 'cloudflare' ? 'Cloudflare' : 'Neon' }), body: tr('The monitor could not read this service for more than 12 hours. Check the key or token in the server settings.') };
  }
  if (n.code === 'backup.auto.done') {
    return { title: tr('Automatic backup made'), body: tr('Saved to {where}. Nothing else to do: you can restore it from Backup & restore.', { where: tr(WHERE[s('destination')] || 'your backup vault') }) };
  }
  if (n.code === 'backup.auto.failed') {
    const why = saMessage(new SaError(0, s('error')));
    return { title: tr('Automatic backup failed'), body: tr('{why} It is tried again later. If this keeps happening, open Backup & restore and make a backup by hand.', { why }) };
  }
  if (n.code === 'api.alert') {
    const rule = s('rule');
    const what = rule === 'failures'
      ? tr('{value} % of calls failed (alert level {limit} %)', { value: x('value'), limit: x('limit') })
      : tr('{value} calls in about {min} min (alert level {limit})', { value: x('value'), min: x('windowMin'), limit: x('limit') });
    return { title: `${tr(API_RULE_NAME[rule] || 'API warning')} · ${s('store')}`, body: p.paused ? `${what}. ${tr('Its API was paused automatically. Resume it from the warning.')}` : what };
  }
  if (n.code === 'system.test') return { title: tr('Notifications are working'), body: tr('This is a test. Warnings about your free limits, backups and API use appear here and in your browser.') };
  return { title: n.code, body: '' };
}

// ---------------------------------------------------------------- notifications on this device (Web Push)

/*
 * Why Web Push: Android Chrome refuses `new Notification()` from a page, and a page that is in the background or closed cannot ask the server
 * anything. So the phone registers with Google's push service through the console's service worker (public/sa-sw.js); the server pushes every
 * notice (server/notice-push.js) and the worker shows it, whether Chrome is open, in the background or closed.
 */
type Perm = 'unsupported' | 'default' | 'granted' | 'denied';
const KEY = 'sa-browser-notify';
const web = Platform.OS === 'web';
const g = globalThis as any;
const supported = () => web && !!g.window && g.window.isSecureContext && 'serviceWorker' in g.navigator && 'PushManager' in g.window && 'Notification' in g.window;
const readPerm = (): Perm => (supported() ? (g.Notification.permission as Perm) : 'unsupported');
const readPref = () => { try { return g.localStorage?.getItem(KEY) === '1'; } catch { return false; } };
const writePref = (on: boolean) => { try { g.localStorage?.setItem(KEY, on ? '1' : '0'); } catch { /* private mode: for this visit only */ } };
const SCOPE = '/super-admin/';

function keyBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = g.atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(decoded as string, ch => ch.charCodeAt(0));
}
/** The console's own worker (scope /super-admin/): never mixed with the tenant apps' worker. */
async function registration() {
  const registered = await g.navigator.serviceWorker.register('/sa-sw.js', { scope: SCOPE, updateViaCache: 'none' });
  const ready = await g.navigator.serviceWorker.ready;
  return new URL(ready.scope).pathname === SCOPE ? ready : registered;
}
async function existingRegistration() {
  const found = await g.navigator.serviceWorker.getRegistration(SCOPE);
  return found && new URL(found.scope).pathname === SCOPE ? found : undefined;
}
async function currentSubscription() {
  if (!supported()) return null;
  const found = await existingRegistration();
  return (await found?.pushManager.getSubscription()) || null;
}

// ---------------------------------------------------------------- the store

type S = {
  notices: Notice[]; unread: number; loaded: boolean; toasts: Notice[]; open: boolean;
  perm: Perm; browser: boolean; busy: boolean; error: unknown; testResult: { devices: number; sent: number } | null;
  refresh: () => Promise<void>; setOpen: (open: boolean) => void; dismissToast: (id: string) => void;
  markRead: (ids: string[] | 'all') => Promise<void>; clear: () => Promise<void>;
  enableBrowser: () => Promise<void>; disableBrowser: () => Promise<void>; syncBrowser: () => Promise<void>; sendTest: () => Promise<void>;
};

const seen = new Set<string>();
let primed = false, inflight = false;
let go: (href: string) => void = () => {};
/** The console shell tells the store how to open a page (the store itself knows nothing about the router). */
export const setNoticeNavigator = (fn: (href: string) => void) => { go = fn; };
export const goTo = (href: string) => go(href);

export const useNotices = create<S>((set, get) => ({
  notices: [], unread: 0, loaded: false, toasts: [], open: false, perm: readPerm(), browser: readPref(), busy: false, error: null, testResult: null,
  refresh: async () => {
    if (inflight) return;
    inflight = true;
    try {
      const r = await sa<NoticeList>('/notices?limit=30');
      const fresh = r.notices.filter(n => !seen.has(n.id));
      for (const n of r.notices) seen.add(n.id);
      // What was already there when the console opened is only counted by the bell: nothing pops up for old news.
      const news = primed ? fresh.filter(n => !n.read) : [];
      primed = true;
      set(s => ({ notices: r.notices, unread: r.unread, loaded: true, perm: readPerm(), toasts: news.length ? [...news, ...s.toasts].slice(0, 3) : s.toasts }));
    } catch { /* offline or signed out: the shell handles that, the bell keeps what it had */ } finally { inflight = false; }
  },
  setOpen: open => set({ open }),
  dismissToast: id => set(s => ({ toasts: s.toasts.filter(n => n.id !== id) })),
  markRead: async ids => {
    set(s => {
      const notices = s.notices.map(n => (ids === 'all' || ids.includes(n.id) ? { ...n, read: true } : n));
      const newlyRead = s.notices.filter(n => !n.read && (ids === 'all' || ids.includes(n.id))).length;
      return { notices, unread: ids === 'all' ? 0 : Math.max(0, s.unread - newlyRead) };
    });
    try { await sa('/notices/read', { method: 'POST', body: ids === 'all' ? { all: true } : { ids } }); } catch { /* the next refresh brings the truth */ }
    void get().refresh();
  },
  clear: async () => {
    set({ notices: [], unread: 0, toasts: [] });
    try { await sa('/notices/clear', { method: 'POST', body: {} }); } catch { /* the next refresh brings the truth */ }
  },
  enableBrowser: async () => {
    set({ busy: true, error: null, testResult: null });
    try {
      if (!supported()) { set({ perm: 'unsupported' }); return; }
      // Must be the first await: the browser only shows the permission prompt inside the tap.
      const permission: Perm = g.Notification.permission === 'default' ? await g.Notification.requestPermission() : g.Notification.permission;
      if (permission !== 'granted') { writePref(false); set({ perm: readPerm(), browser: false }); return; }
      const config = await sa<{ publicKey: string | null }>('/push/config');
      if (!config.publicKey) throw new SaError(500, 'PUSH_UNAVAILABLE');
      const worker = await registration();
      let subscription = await worker.pushManager.getSubscription();
      const expected = keyBytes(config.publicKey);
      const existing = subscription?.options?.applicationServerKey;
      if (subscription && existing && Array.from(new Uint8Array(existing)).join(',') !== Array.from(expected).join(',')) { await subscription.unsubscribe(); subscription = null; }
      try { subscription ||= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expected }); } catch { throw new SaError(500, 'PUSH_UNAVAILABLE'); }
      // Only "on" once the server has stored this device.
      await sa('/push/subscribe', { method: 'POST', body: { subscription: subscription.toJSON(), language: saLang() } });
      writePref(true);
      set({ perm: readPerm(), browser: true });
    } catch (error) { writePref(false); set({ error, browser: false, perm: readPerm() }); } finally { set({ busy: false }); }
  },
  disableBrowser: async () => {
    writePref(false); set({ browser: false, testResult: null });
    try {
      const subscription = await currentSubscription();
      if (!subscription) return;
      try { await sa('/push/unsubscribe', { method: 'POST', body: { subscription: subscription.toJSON() } }); } finally { await subscription.unsubscribe(); }
    } catch { /* the server forgets a device that no longer answers */ }
  },
  /** On every start of the console: show the true state of this device and keep the server's copy (and its language) up to date. */
  syncBrowser: async () => {
    if (!supported()) { set({ perm: 'unsupported', browser: false }); return; }
    try {
      const subscription = g.Notification.permission === 'granted' ? await currentSubscription() : null;
      set({ perm: readPerm(), browser: !!subscription });
      writePref(!!subscription);
      if (subscription) await sa('/push/subscribe', { method: 'POST', body: { subscription: subscription.toJSON(), language: saLang() } });
    } catch { /* offline: try again next time */ }
  },
  sendTest: async () => {
    set({ busy: true, error: null, testResult: null });
    try {
      const r = await sa<{ push?: { devices: number; sent: number } }>('/notices/test', { method: 'POST', body: {} });
      set({ testResult: r.push || { devices: 0, sent: 0 } });
      await get().refresh();
    } catch (error) { set({ error }); } finally { set({ busy: false }); }
  },
}));
