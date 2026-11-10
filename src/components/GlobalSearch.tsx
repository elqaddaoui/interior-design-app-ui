import React, { useDeferredValue, useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Href, usePathname } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { canOpen } from '@/lib/access';
import { ADMIN_NAV } from '@/lib/adminNav';
import { useAdminProfile } from '@/store/useAdminProfile';
import { SETTINGS_MAP } from '@/lib/settingsMap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSearchInset } from '@/hooks/useSearchInset';
import { useBp } from '@/hooks/useBp';
import { useShallow } from 'zustand/react/shallow';
import { requestLeave, router } from '@/hooks/useLeaveGuard';
import { useIsAdmin, useStore } from '@/store/useStore';
import { useLocal } from '@/store/useLocal';
import { inSuperArea } from '@/lib/superRoutes';
import { useL, useT } from '@/i18n';

const EMPTY = [] as never[];

/** Separate keyed instances discard queries/results when crossing the app/admin boundary. */
export function GlobalSearch() {
  const path = usePathname();
  const admin = path === '/admin' || path.startsWith('/admin/');
  const superArea = inSuperArea(path);
  const session = useLocal((s) => s.adminSession);
  const isAdmin = useIsAdmin();
  const enabled = useStore((s) => admin ? s.doc.settings.adminSearchEnabled !== false : s.doc.settings.appSearchEnabled !== false);
  if (superArea || !enabled || (admin && (!session || !isAdmin))) return null;
  return <SearchControl key={admin ? 'admin' : 'app'} admin={admin} />;
}
function SearchControl({ admin }: { admin: boolean }) {
  const [open, setOpen] = useState(false);
  const { rtl, t } = useT();
  const insets = useSafeAreaInsets();
  const { desktop } = useBp();
  const obstruction = useSearchInset();
  return <>
    <Pressable testID="global-search-open" accessibilityRole="button" accessibilityLabel={t('common.search')} onPress={() => setOpen(true)}
      className="w-12 h-12 rounded-full bg-primary items-center justify-center border border-line"
      style={{ position: Platform.OS === 'web' ? 'fixed' as any : 'absolute', bottom: Math.max(insets.bottom, 12) + (admin ? obstruction + 12 : !desktop ? 76 : 12), ...(rtl ? { left: Math.max(insets.left, 16) } : { right: Math.max(insets.right, 16) }), zIndex: 45, elevation: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8 }}>
      <Icon name="magnify" tone="onprimary" />
    </Pressable>
    {open ? <SearchDialog admin={admin} onClose={() => setOpen(false)} /> : null}
  </>;
}
function SearchDialog({ admin, onClose }: { admin: boolean; onClose: () => void }) {
  const s = useStore(useShallow((s) => ({ tools: s.tools, tabs: s.tabs, styles: s.styles, sections: s.sections, categories: s.categories, roomTypes: s.roomTypes, palettes: s.palettes, inspirations: s.inspirations, models: admin ? s.models : EMPTY, users: admin ? s.users : EMPTY, requests: admin ? s.requests : EMPTY })));
  const L = useL();
  const access = useAdminProfile((a) => a.access);
  const { t, lang } = useT();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLocaleLowerCase();
  type Result = { id: string; title: string; group: string; href: string; terms: string; icon: string };
  const results = useMemo(() => {
  const results: Result[] = [];
  if (needle.length < 2) return results;
  const add = (id: string, title: string, group: string, href: string, terms: unknown, icon: string) => {
    if (needle.length >= 2 && JSON.stringify(terms).toLocaleLowerCase().includes(needle)) results.push({ id, title, group, href, terms: '', icon });
  };
  if (admin) {
    for (const name of ['tools', 'styles', 'sections', 'categories', 'roomTypes', 'palettes', 'tabs'] as const) for (const item of s[name]) {
      add(item.id, L(item.title), t(`admin.nav.${name}`), `/admin/${name}`, [item.id, item.title], 'view-grid-outline');
    }
    for (const item of s.inspirations) add(item.id, L(s.categories.find((c) => c.id === item.categoryId)?.title) || item.id, t('admin.nav.inspirations'), '/admin/inspirations', [item.id, s.categories.find((c) => c.id === item.categoryId)?.title, s.styles.find((c) => c.id === item.styleId)?.title], 'image-outline');
    for (const item of s.models) add(item.id, item.name, t('admin.nav.models'), '/admin/models', [item.id, item.name, item.provider], 'robot-outline');
    for (const item of s.users) add(item.id, item.name || item.whatsapp, t('admin.nav.users'), '/admin/users', [item.id, item.name, item.whatsapp], 'account-outline');
    for (const item of s.requests) add(item.id, item.name, t('admin.nav.requests'), '/admin/requests', [item.id, item.name, item.whatsapp], 'inbox-outline');
    for (const e of SETTINGS_MAP) add(`set-${e.id}`, t(`sm.${e.id}`), `${t('sm.title')} · ${t(`sm.aud_${e.audience}`)}`, e.href, [t(`sm.${e.id}`), t(`sm.${e.id}_d`)], e.icon);
    for (const item of ADMIN_NAV.filter((n) => canOpen(access, n.key))) add(`menu-${item.key}`, t(`admin.nav.${item.key}`), t('admin.title'), item.href, t(`admin.nav.${item.key}`), item.icon);
  } else {
    for (const item of s.tools.filter((x) => x.visible)) add(item.id, L(item.title), t('home.all'), '/', [item.id, item.title], 'toolbox-outline');
    for (const item of s.sections.filter((x) => x.visible)) add(item.id, L(item.title), t('tabs.explore'), '/explore', [item.id, item.title], 'view-carousel-outline');
    for (const item of s.categories.filter((x) => x.visible && s.sections.some((section) => section.id === x.sectionId && section.visible))) add(item.id, L(item.title), t('tabs.explore'), `/explore/section/${item.sectionId}`, [item.id, item.title], 'view-grid-outline');
    for (const item of s.inspirations.filter((x) => x.visible && s.categories.some((category) => category.id === x.categoryId && category.visible && s.sections.some((section) => section.id === category.sectionId && section.visible)))) add(item.id, L(s.categories.find((c) => c.id === item.categoryId)?.title) || item.id, t('tabs.explore'), `/explore/category/${item.categoryId}`, [item.id, s.categories.find((c) => c.id === item.categoryId)?.title, s.styles.find((c) => c.id === item.styleId)?.title], 'image-outline');
  }
  return results;
  // L and translated grouping follow the active language, not function identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, needle, admin, lang, access]);
  const pick = (result: Result) => requestLeave(() => {
    onClose();
    router.push(`${result.href}?target=${encodeURIComponent(result.id)}&focus=${Date.now()}` as Href);
  });
  return <Sheet visible onClose={onClose} title={t('common.search')} wide>
      <Input testID="global-search-input" value={query} onChangeText={(value) => { setQuery(value); setLimit(50); }} autoFocus placeholder={t('improve.searchPlaceholder')} />
      {needle.length >= 2 && !results.length ? <Txt className="text-muted p-3">{t('common.noResults')}</Txt> : null}
      {results.slice(0, limit).map((result) => <Pressable key={`${result.href}:${result.id}`} testID={`global-result-${result.id}`} accessibilityRole="link" onPress={() => pick(result)} className="flex-row gap-3 items-center px-3 py-2 border-b border-line">
        <Icon name={result.icon} size={20} /><View className="flex-1"><Txt className="font-semibold text-[14px]">{result.title}</Txt><Txt className="text-muted text-[12px]">{result.group}</Txt></View><Icon name="chevron-right" flip size={18} />
      </Pressable>)}
      {results.length > limit ? <Button title={t('improve.next')} variant="soft" onPress={() => setLimit(limit + 50)} /> : null}
    </Sheet>;
}
