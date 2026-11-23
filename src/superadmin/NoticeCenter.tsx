/** The console's own notification UI: a bell with a count, a panel, toasts that slide in, and the card that turns browser notifications on. */
import React, { useEffect } from 'react';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { SA } from './tokens';
import { tr } from './i18n';
import { Icon, IconBtn, type IconName } from './icons';
import { saMessage } from './api';
import { Btn, Card, ErrorLine, Row, T, ago } from './ui';
import { goTo, noticeText, useNotices } from './notices';
import type { Notice, NoticeKind, NoticeSeverity } from './types';

const POLL_MS = 5000;
const KIND_ICON: Record<NoticeKind, IconName> = { limits: 'chartLine', backup: 'shieldCheckOutline', api: 'lockOutline', system: 'bellRingOutline' };
const tone = (severity: NoticeSeverity) => ({
  info: { fg: SA.color.accent, bg: SA.color.accentSoft },
  ok: { fg: SA.color.ok, bg: SA.color.okSoft },
  warn: { fg: SA.color.warn, bg: SA.color.warnSoft },
  danger: { fg: SA.color.danger, bg: SA.color.dangerSoft },
})[severity];

/** Asks the server for new notifications while the console is open (and right away when the tab comes back). */
export function useNoticePolling(active: boolean) {
  const refresh = useNotices(s => s.refresh);
  useEffect(() => {
    if (!active) return undefined;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    const wake = () => { void refresh(); };
    if (Platform.OS === 'web' && typeof document !== 'undefined') { document.addEventListener('visibilitychange', wake); window.addEventListener('focus', wake); }
    return () => {
      clearInterval(timer);
      if (Platform.OS === 'web' && typeof document !== 'undefined') { document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); }
    };
  }, [active, refresh]);
}

function Medallion({ notice, size = 36 }: { notice: Notice; size?: number }) {
  const c = tone(notice.severity);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={KIND_ICON[notice.kind] || 'bellOutline'} size={size * 0.5} color={c.fg} />
    </View>
  );
}

/** The bell. A small dot with the number of unread notifications sits on it. */
export function NoticeBell({ size = 36 }: { size?: number }) {
  const unread = useNotices(s => s.unread), open = useNotices(s => s.open), setOpen = useNotices(s => s.setOpen);
  return (
    <View>
      <IconBtn testID="sa-bell" icon={unread ? 'bellRingOutline' : 'bellOutline'} active={open} quiet={open} size={size}
        label={unread ? tr('Notifications ({n} new)', { n: unread }) : tr('Notifications')} onPress={() => setOpen(!open)} />
      {unread ? (
        <View pointerEvents="none" testID="sa-bell-count" style={{ position: 'absolute', top: -2, end: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: SA.color.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: SA.color.panel }}>
          <T size="xs" weight="bold" color={SA.color.panel} style={{ fontSize: 10, lineHeight: 12 }}>{unread > 9 ? '9+' : String(unread)}</T>
        </View>
      ) : null}
    </View>
  );
}

function NoticeRow({ notice, onOpen }: { notice: Notice; onOpen: (n: Notice) => void }) {
  const { title, body } = noticeText(notice);
  const c = tone(notice.severity);
  return (
    <Pressable testID="sa-notice-row" accessibilityRole="button" onPress={() => onOpen(notice)}
      style={({ pressed }) => ({ flexDirection: 'row', gap: SA.space.md, padding: SA.space.md, borderRadius: SA.radius.md, backgroundColor: pressed ? SA.color.panel2 : notice.read ? 'transparent' : SA.color.accentSoft, opacity: notice.read ? 0.78 : 1 })}>
      <Medallion notice={notice} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row style={{ flexWrap: 'nowrap', justifyContent: 'space-between', gap: SA.space.sm }}>
          <T size="sm" weight="bold" numberOfLines={2} style={{ flexShrink: 1 }}>{title}</T>
          {!notice.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.fg }} /> : null}
        </Row>
        {body ? <T size="sm" color={SA.color.muted} style={{ marginTop: 2 }} numberOfLines={4}>{body}</T> : null}
        <T size="xs" color={SA.color.muted} style={{ marginTop: 4 }}>{ago(notice.at)}</T>
      </View>
    </Pressable>
  );
}

/** The list that opens under the bell. */
export function NoticePanel({ anchor }: { anchor: 'side' | 'top' }) {
  const { notices, unread, open, loaded, setOpen, markRead, clear } = useNotices();
  const { width } = useWindowDimensions();
  if (!open) return null;
  const go = (n: Notice) => { setOpen(false); if (!n.read) void markRead([n.id]); if (n.href) goTo(n.href); };
  const panelWidth = Math.min(380, width - 24);
  return (
    <>
      <Pressable accessibilityLabel={tr('Close')} onPress={() => setOpen(false)} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, zIndex: 40 }} />
      <View testID="sa-notice-panel" style={{
        position: 'absolute', zIndex: 41, width: panelWidth, maxHeight: '78%', backgroundColor: SA.color.panel, borderRadius: SA.radius.lg, borderWidth: 1, borderColor: SA.color.line,
        ...(anchor === 'side' ? { bottom: 120, start: 12 } : { top: 56, end: 12 }),
        ...(Platform.OS === 'web' ? ({ boxShadow: '0 18px 48px rgba(10,14,30,0.28)' } as object) : {}),
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SA.space.lg, paddingVertical: SA.space.md, borderBottomWidth: 1, borderColor: SA.color.line }}>
          <T weight="bold">{tr('Notifications')}</T>
          <Row style={{ gap: 4, flexWrap: 'nowrap' }}>
            {unread ? <IconBtn testID="sa-notice-readall" icon="checkAll" label={tr('Mark all as read')} onPress={() => { void markRead('all'); }} size={32} /> : null}
            {notices.length ? <IconBtn testID="sa-notice-clear" icon="deleteOutline" label={tr('Clear the list')} onPress={() => { void clear(); }} size={32} /> : null}
            <IconBtn icon="close" label={tr('Close')} onPress={() => setOpen(false)} size={32} />
          </Row>
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: SA.space.sm, gap: 2 }}>
          {!notices.length ? (
            <View testID="sa-notice-empty" style={{ alignItems: 'center', paddingVertical: SA.space.xxl, paddingHorizontal: SA.space.lg, gap: SA.space.sm }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: SA.color.panel2, alignItems: 'center', justifyContent: 'center' }}><Icon name="bellOutline" size={26} color={SA.color.muted} /></View>
              <T weight="bold">{loaded ? tr('All quiet') : tr('Loading')}</T>
              <T size="sm" color={SA.color.muted} style={{ textAlign: 'center' }}>{tr('Warnings about your free limits, backups and API use will appear here.')}</T>
            </View>
          ) : notices.map(n => <NoticeRow key={n.id} notice={n} onOpen={go} />)}
        </ScrollView>
      </View>
    </>
  );
}

function Toast({ notice }: { notice: Notice }) {
  const dismiss = useNotices(s => s.dismissToast), markRead = useNotices(s => s.markRead);
  const { title, body } = noticeText(notice);
  const c = tone(notice.severity);
  useEffect(() => { const t = setTimeout(() => dismiss(notice.id), notice.severity === 'danger' ? 14000 : 9000); return () => clearTimeout(t); }, [notice.id, notice.severity, dismiss]);
  const open = () => { dismiss(notice.id); void markRead([notice.id]); if (notice.href) goTo(notice.href); };
  return (
    <View testID="sa-toast" style={{ flexDirection: 'row', backgroundColor: SA.color.panel, borderRadius: SA.radius.lg, borderWidth: 1, borderColor: SA.color.line, overflow: 'hidden', ...(Platform.OS === 'web' ? ({ boxShadow: '0 12px 36px rgba(10,14,30,0.26)' } as object) : {}) }}>
      <View style={{ width: 5, backgroundColor: c.fg }} />
      <Pressable accessibilityRole="button" onPress={open} style={{ flex: 1, flexDirection: 'row', gap: SA.space.md, padding: SA.space.md }}>
        <Medallion notice={notice} size={34} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T size="sm" weight="bold" numberOfLines={2}>{title}</T>
          {body ? <T size="sm" color={SA.color.muted} style={{ marginTop: 2 }} numberOfLines={3}>{body}</T> : null}
        </View>
      </Pressable>
      <View style={{ padding: 4 }}><IconBtn icon="close" label={tr('Close')} onPress={() => dismiss(notice.id)} size={28} /></View>
    </View>
  );
}

/** The pop-ups in the corner. */
export function ToastHost() {
  const toasts = useNotices(s => s.toasts);
  const { width } = useWindowDimensions();
  if (!toasts.length) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 12, end: 12, width: Math.min(400, width - 24), gap: SA.space.sm, zIndex: 60 }}>
      {toasts.map(n => <Toast key={n.id} notice={n} />)}
    </View>
  );
}

/** One line + one button: turns the browser's own notifications on or off (and sends a test). Shown where the warnings are managed. */
export function BrowserNotifyCard() {
  const { perm, browser, busy, error, enableBrowser, disableBrowser, sendTest } = useNotices();
  const on = browser && perm === 'granted';
  const c = on ? tone('ok') : perm === 'denied' ? tone('warn') : tone('info');
  const text = perm === 'unsupported' ? tr('This browser cannot show notifications. Warnings still appear in the bell.')
    : perm === 'denied' ? tr('Notifications are blocked for this site. Allow them in the browser settings (the lock next to the address), then come back.')
      : on ? tr('On. A warning pops up on your screen, even when this tab is in the background.')
        : tr('Off. Turn it on to get a pop-up on your screen when a limit gets close, a backup finishes or an API is misused.');
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SA.space.md, flexWrap: 'wrap' }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={on ? 'bellRingOutline' : perm === 'denied' || perm === 'unsupported' ? 'bellOffOutline' : 'bellOutline'} size={22} color={c.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 200 }}>
          <T weight="bold">{tr('Browser notifications')}</T>
          <T testID="sa-notify-state" size="sm" color={SA.color.muted} style={{ marginTop: 2 }}>{text}</T>
        </View>
        <Row>
          {perm === 'unsupported' || perm === 'denied' ? null : on
            ? <Btn testID="sa-notify-off" kind="ghost" small label={tr('Turn off')} onPress={disableBrowser} />
            : <Btn testID="sa-notify-on" small icon="bellRingOutline" label={tr('Turn on')} onPress={() => { void enableBrowser(); }} />}
          <Btn testID="sa-notify-test" kind="ghost" small icon="sendOutline" label={tr('Send a test')} busy={busy} onPress={() => { void sendTest(); }} />
        </Row>
      </View>
      {error ? <View style={{ marginTop: SA.space.md }}><ErrorLine error={saMessage(error)} /></View> : null}
    </Card>
  );
}
