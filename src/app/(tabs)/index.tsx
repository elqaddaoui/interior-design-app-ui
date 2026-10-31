import { RememberScroll, useViewState } from '@/hooks/useViewState';
import React, { useEffect, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import { useStore, sorted } from '@/store/useStore';
import { useWizard } from '@/store/useWizard';
import { useL, useT } from '@/i18n';
import { useBp } from '@/hooks/useBp';
import { CreditsBadge } from '@/components/ui/CreditsBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { BrandHeader } from '@/components/BrandHeader';
import { ToolCard } from '@/components/ToolCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { boot } from '@/lib/boot';
import { resolveGlobal } from '@/lib/toolCards';

const ALL = '__all__';

export default function Home() {
  const { t } = useT();
  const { target } = useLocalSearchParams<{ target?: string }>();
  const L = useL();
  const { desktop, pick } = useBp();
  const tabs = useStore((s) => s.tabs);
  const tools = useStore((s) => s.tools);
  const contentReady = useStore((s) => s.contentReady);
  const branding = useStore((s) => s.doc.branding);
  const visibleTabs = useMemo(() => sorted(tabs).filter((x) => x.visible), [tabs]);
  const tabsVisible = useStore((s) => s.doc.settings.homeTabsVisible) !== false;
  const [selectedTab, setTabId] = useViewState<string>('selectedTab', ALL);

  const tabId = !tabsVisible || selectedTab === ALL ? ALL : visibleTabs.some((x) => x.id === selectedTab) ? selectedTab : ALL;

  const list = sorted(tools).filter((x) => x.visible && (x.id === target || tabId === ALL || x.tabId === tabId));
  const pills = useMemo(() => [{ id: ALL, label: t('home.all') }].concat(visibleTabs.map((x) => ({ id: x.id, label: L(x.title) }))), [visibleTabs, t, L]);
  const cols = pick(1, 2, 3);
  // One global card height for every card (Admin > Tools cards); the placeholders use it too so nothing jumps.
  const cardHeight = useStore((s) => resolveGlobal(s.doc.settings.toolCards).height);

  // Startup loader (automatic mode) goes away once the first two cards have painted.
  const count = list.length === 0 && !contentReady ? -1 : list.length;
  useEffect(() => { boot.cards(count); }, [count]);

  const open = (id: string) => { useWizard.getState().start(id); router.push({ pathname: '/tool/[id]', params: { id } }); };

  const header = (
    <View>
      {!desktop ? (
        <BrandHeader branding={branding} actions={<CreditsBadge />} />
      ) : null}
      {tabsVisible ? <RememberScroll stateKey="home-filter-menu" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
        {pills.map((x) => {
          const on = x.id === tabId;
          return (
            <Pressable key={x.id} testID={`hometab-${x.id}`} onPress={() => setTabId(x.id)} className={`px-4 h-9 rounded-full items-center justify-center border ${on ? 'border-ink bg-ink' : 'border-line bg-surface2'}`}>
              <Txt className={`text-[14px] ${on ? 'font-extrabold text-onink' : 'text-muted font-semibold'}`}>{x.label}</Txt>
            </Pressable>
          );
        })}
      </RememberScroll> : null}
    </View>
  );

  return (
    <Screen header={header} bottomInset={16}>
      <View className="pt-3">
        {list.length === 0 && !contentReady ? (
          // Content is still on its way (first visit, nothing cached): same-size placeholders, never a false "empty" message.
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 }}>
            {Array.from({ length: cols }, (_, i) => (
              <View key={i} style={{ width: `${100 / cols}%`, padding: 8 }}><Skeleton h={cardHeight} r={16} /><View pointerEvents="none" style={{ position: 'absolute', top: 8, left: 8, right: 8, bottom: 8, alignItems: 'center', justifyContent: 'center' }}><Spinner size={36} /></View></View>
            ))}
          </View>
        ) : list.length === 0 ? (
          <EmptyState icon="tools" title={t('home.empty')} />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 }}>
            {list.map((tool, i) => (
              <View key={tool.id} style={{ width: `${100 / cols}%`, padding: 8 }}>
                <ToolCard tool={tool} index={i} onPress={() => open(tool.id)} onReady={i < 2 ? () => boot.cardPainted(i) : undefined} />
              </View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}
