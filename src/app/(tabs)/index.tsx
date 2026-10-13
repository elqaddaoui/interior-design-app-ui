import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from '@/hooks/useLeaveGuard';
import { useStore, sorted } from '@/store/useStore';
import { useWizard } from '@/store/useWizard';
import { useL, useT } from '@/i18n';
import { useBp } from '@/hooks/useBp';
import { CreditsBadge, EmptyState, Screen, Txt } from '@/components/ui';
import { BrandHeader } from '@/components/BrandHeader';
import { ToolCard } from '@/components/ToolCard';

const ALL = '__all__';

export default function Home() {
  const { t } = useT();
  const L = useL();
  const { desktop, pick } = useBp();
  const tabs = useStore((s) => s.tabs);
  const tools = useStore((s) => s.tools);
  const branding = useStore((s) => s.doc.branding);
  const visibleTabs = useMemo(() => sorted(tabs).filter((x) => x.visible), [tabs]);
  const tabsVisible = useStore((s) => s.doc.settings.homeTabsVisible) !== false;
  const [selectedTab, setTabId] = useState<string>(ALL);

  const tabId = !tabsVisible || selectedTab === ALL ? ALL : visibleTabs.some((x) => x.id === selectedTab) ? selectedTab : ALL;

  const list = sorted(tools).filter((x) => x.visible && (tabId === ALL || x.tabId === tabId));
  const pills = useMemo(() => [{ id: ALL, label: t('home.all') }].concat(visibleTabs.map((x) => ({ id: x.id, label: L(x.title) }))), [visibleTabs, t, L]);
  const cols = pick(1, 2, 3);

  const open = (id: string) => { useWizard.getState().start(id); router.push({ pathname: '/tool/[id]', params: { id } }); };

  const header = (
    <View>
      {!desktop ? (
        <BrandHeader branding={branding} actions={<CreditsBadge />} />
      ) : null}
      {tabsVisible ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
        {pills.map((x) => {
          const on = x.id === tabId;
          return (
            <Pressable key={x.id} testID={`hometab-${x.id}`} onPress={() => setTabId(x.id)} className={`px-4 h-9 rounded-full items-center justify-center border ${on ? 'border-ink bg-ink' : 'border-line bg-surface2'}`}>
              <Txt className={`text-[14px] ${on ? 'font-extrabold text-onink' : 'text-muted font-semibold'}`}>{x.label}</Txt>
            </Pressable>
          );
        })}
      </ScrollView> : null}
    </View>
  );

  return (
    <Screen header={header} bottomInset={16}>
      <View className="pt-3">
        {list.length === 0 ? (
          <EmptyState icon="tools" title={t('home.empty')} />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 }}>
            {list.map((tool, i) => (
              <View key={tool.id} style={{ width: `${100 / cols}%`, padding: 8 }}>
                <ToolCard tool={tool} index={i} height={cols === 1 ? 200 : 230} onPress={() => open(tool.id)} />
              </View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}
