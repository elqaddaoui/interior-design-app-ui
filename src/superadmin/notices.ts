/**
 * Notification centre of the console (the bell, the toasts and the browser notifications).
 *
 * The server keeps one small row per warning (a code + numbers, see server/notices.js); this module asks for them every few seconds,
 * writes the sentence in the owner's language (`noticeText`), shows a toast for each new one and, once the owner allowed it, a native
 * browser notification when the console is not the window in front. No e-mail, no server setup, no service worker: the browser
 * notification works while the console is open in a tab of this browser (hidden tabs included).
 */
import { Platform } from 'react-native';
import { create } from 'zustand';
import { sa, SaError, saMessage } from './api';
import { tr } from './i18n';
import { CONSOLE_ICONS } from './brand';
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

// ---------------------------------------------------------------- browser notifications

type Perm = 'unsupported' | 'default' | 'granted' | 'denied';
const KEY = 'sa-browser-notify';
const web = Platform.OS === 'web';
const native = () => (web ? (globalThis as any).Notification : undefined);
const readPerm = (): Perm => { const N = native(); return N ? (N.permission as Perm) : 'unsupported'; };
const readPref = () => { try { return (globalThis as any).localStorage?.getItem(KEY) === '1'; } catch { return false; } };
const writePref = (on: boolean) => { try { (globalThis as any).localStorage?.setItem(KEY, on ? '1' : '0'); } catch { /* private mode: for this visit only */ } };
/** Is the console the window the owner is looking at? Then the toast is enough. */
const inFront = () => web && typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();

function showNative(n: Notice, go: (href: string) => void) {
  const N = native();
  if (!N || N.permission !== 'granted') return;
  const { title, body } = noticeText(n);
  const options = { body, tag: n.id, icon: CONSOLE_ICONS.p192, badge: CONSOLE_ICONS.p192, lang: undefined as string | undefined };
  const open = () => { try { (globalThis as any).window?.focus?.(); } catch { /* ignore */ } if (n.href) go(n.href); };
  try {
    const shown = new N(title, options);
    shown.onclick = () => { open(); shown.close?.(); };
  } catch {
    // Android Chrome only allows notifications made by a service worker: use one if the page already has it, otherwise the toast has to do.
    (globalThis as any).navigator?.serviceWorker?.getRegistration?.().then((reg: any) => reg?.showNotification?.(title, options)).catch(() => {});
  }
}

// ---------------------------------------------------------------- the store

type S = {
  notices: Notice[]; unread: number; loaded: boolean; toasts: Notice[]; open: boolean;
  perm: Perm; browser: boolean; busy: boolean; error: unknown;
  refresh: () => Promise<void>; setOpen: (open: boolean) => void; dismissToast: (id: string) => void;
  markRead: (ids: string[] | 'all') => Promise<void>; clear: () => Promise<void>;
  enableBrowser: () => Promise<void>; disableBrowser: () => void; sendTest: () => Promise<void>;
};

const seen = new Set<string>();
let primed = false, inflight = false;
let go: (href: string) => void = () => {};
/** The console shell tells the store how to open a page (the store itself knows nothing about the router). */
export const setNoticeNavigator = (fn: (href: string) => void) => { go = fn; };
export const goTo = (href: string) => go(href);

export const useNotices = create<S>((set, get) => ({
  notices: [], unread: 0, loaded: false, toasts: [], open: false, perm: readPerm(), browser: readPref(), busy: false, error: null,
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
      if (get().browser) for (const n of news.slice().reverse()) if (n.code === 'system.test' || !inFront()) showNative(n, go);
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
    const N = native();
    if (!N) { set({ perm: 'unsupported' }); return; }
    // Must run from a tap: browsers refuse to ask for the permission otherwise.
    let result: string = N.permission;
    if (result === 'default') { try { result = await N.requestPermission(); } catch { result = N.permission; } }
    writePref(result === 'granted');
    set({ perm: readPerm(), browser: result === 'granted' });
  },
  disableBrowser: () => { writePref(false); set({ browser: false }); },
  sendTest: async () => {
    set({ busy: true, error: null });
    try { await sa('/notices/test', { method: 'POST', body: {} }); await get().refresh(); } catch (error) { set({ error }); } finally { set({ busy: false }); }
  },
}));
