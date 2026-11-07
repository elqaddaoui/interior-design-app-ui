import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { DAY, ago, type Ev, type EventKind } from '@/lib/stats';
import type { Insight } from '@/lib/analytics';

export const EV_ICON: Record<EventKind, { icon: string; tone: string }> = {
  request: { icon: 'inbox-arrow-down-outline', tone: 'bg-danger' },
  delivered: { icon: 'check-circle-outline', tone: 'bg-success' },
  design: { icon: 'image-auto-adjust', tone: 'bg-primary' },
  user: { icon: 'account-plus-outline', tone: 'bg-ink' },
};

/** The sentences of the dashboard (events, waiting time, insights), shared by the panels and the quick-view popup. */
export function useDashFormat() {
  const { t, lang } = useT();
  const L = useL();
  const tools = useStore((s) => s.tools);
  const loc = lang === 'fr' ? 'fr-FR' : lang === 'ar' || lang === 'dar' ? 'ar-MA-u-nu-latn' : 'en-GB';
  const toolName = (id?: string) => L(tools.find((x) => x.id === id)?.title) || '';
  return {
    loc,
    toolName,
    date: (at: number) => new Date(at).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' }),
    dayLabel: (at: number) => new Date(at).toLocaleDateString(loc, { day: 'numeric', month: 'short' }),
    evText: (e: Ev) => {
      const name = e.name || t('admin.dash.anonymous');
      return e.kind === 'request' ? t('admin.dash.evRequest', { name }) : e.kind === 'delivered' ? t('admin.dash.evDelivered', { name }) : e.kind === 'design' ? t('admin.dash.evDesign', { tool: toolName(e.toolId) }) : t('admin.dash.evUser', { name });
    },
    agoText: (at: number) => { const a = ago(at); return a.key === 'now' ? t('admin.dash.now') : t(`admin.dash.${a.key}`, { n: a.n }); },
    waitText: (ms: number) => (ms <= 0 ? t('dx.waitNone') : ms >= DAY ? t('dx.waitD', { n: Math.round(ms / DAY) }) : t('dx.waitH', { n: Math.max(1, Math.round(ms / 3600000)) })),
    insightText: (i: Insight) => t(`dx.insight.${i.key}`, { n: i.n, pct: i.pct, tool: toolName(i.id), day: i.day !== undefined ? t(`dx.f${i.day}`) : '' }),
  };
}
