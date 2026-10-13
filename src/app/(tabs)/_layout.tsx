import React from 'react';
import { Pressable, View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { useBp } from '@/hooks/useBp';
import { CreditsBadge, Icon, Txt } from '@/components/ui';
import { useStore } from '@/store/useStore';
import { BrandHeader } from '@/components/BrandHeader';

const TABS = [
  { name: 'index', key: 'tabs.home', icon: 'home-variant-outline', on: 'home-variant' },
  { name: 'explore', key: 'tabs.explore', icon: 'compass-outline', on: 'compass' },
  { name: 'history', key: 'tabs.history', icon: 'clock-outline', on: 'clock' },
  { name: 'assistant', key: 'tabs.assistant', icon: 'face-agent', on: 'face-agent' },
] as const;

type Common = { focused: boolean; label: string; icon: string; on: string; onPress: () => void; name: string };

function DesktopItem({ focused, label, icon, on, onPress, name }: Common) {
  return (
    <Pressable testID={`tab-${name}`} onPress={onPress} className={`flex-row items-center gap-2 h-10 px-4 rounded-full ${focused ? 'bg-primary' : 'active:bg-surface2'}`}>
      <Icon name={focused ? on : icon} size={20} tone={focused ? 'onprimary' : 'fg'} />
      <Txt className={`font-bold text-[14px] ${focused ? 'text-onprimary' : 'text-fg'}`}>{label}</Txt>
    </Pressable>
  );
}

/** V1 - Classic: full-width bar, icon over label, soft pill behind the active icon. */
function ClassicItem({ focused, label, icon, on, onPress, name }: Common) {
  return (
    <Pressable testID={`tab-${name}`} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }} className="flex-1 items-center justify-center gap-1">
      <View className={`h-8 w-16 rounded-full items-center justify-center ${focused ? 'bg-soft' : ''}`}>
        <Icon name={focused ? on : icon} size={22} tone={focused ? 'fg' : 'muted'} />
      </View>
      <Txt numberOfLines={1} className={`text-[11px] leading-[14px] ${focused ? 'font-extrabold text-fg' : 'font-semibold text-muted'}`}>{label}</Txt>
    </Pressable>
  );
}

/** V2 - Floating: rounded island; the active tab expands to show icon + name side by side. */
function FloatingItem({ focused, label, icon, on, onPress, name }: Common) {
  return (
    <Pressable testID={`tab-${name}`} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }}
      style={{ flexGrow: focused ? 2.2 : 1, flexBasis: 0 }} className="items-center justify-center">
      <View className={`h-11 rounded-full flex-row items-center justify-center gap-1.5 ${focused ? 'bg-ink px-4' : 'w-11'}`}>
        <Icon name={focused ? on : icon} size={21} tone={focused ? 'onink' : 'muted'} />
        {focused ? <Txt numberOfLines={1} className="text-onink text-[13px] font-bold">{label}</Txt> : null}
      </View>
    </Pressable>
  );
}

/** V3 - Minimal: flat bar, hairline on top, accent bar above the active tab. */
function MinimalItem({ focused, label, icon, on, onPress, name }: Common) {
  return (
    <Pressable testID={`tab-${name}`} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }} className="flex-1 items-center justify-center">
      <View className={`absolute top-0 h-[3px] w-10 rounded-b-full ${focused ? 'bg-primary' : 'bg-transparent'}`} />
      <Icon name={focused ? on : icon} size={23} tone={focused ? 'fg' : 'muted'} />
      <Txt numberOfLines={1} className={`text-[11px] leading-[14px] mt-1 ${focused ? 'font-bold text-fg' : 'text-muted'}`}>{label}</Txt>
    </Pressable>
  );
}

function TabBar({ state, navigation }: any) {
  const { t } = useT();
  const { desktop } = useBp();
  const insets = useSafeAreaInsets();
  const branding = useStore((s) => s.doc.branding);
  const style = useStore((s) => s.doc.settings.userNavStyle) ?? 'floating';
  const Cmp = desktop ? DesktopItem : style === 'classic' ? ClassicItem : style === 'minimal' ? MinimalItem : FloatingItem;
  const items = TABS.map((tab) => {
    const idx = state.routes.findIndex((r: any) => r.name === tab.name);
    const focused = state.index === idx;
    return (
      <Cmp key={tab.name} name={tab.name} focused={focused} label={t(tab.key)} icon={tab.icon} on={tab.on}
        onPress={() => { const e = navigation.emit({ type: 'tabPress', target: state.routes[idx].key, canPreventDefault: true }); if (!focused && !e.defaultPrevented) navigation.navigate(tab.name); }} />
    );
  });
  if (desktop) {
    return (
      <View className="bg-bg border-b border-line" style={{ paddingTop: insets.top }}>
        <View className="px-8 w-full self-center" style={{ maxWidth: 1280 }}>
          <BrandHeader branding={branding} navigation={<View className="flex-row gap-2">{items}</View>} actions={<CreditsBadge />} />
        </View>
      </View>
    );
  }
  const bottom = Math.max(insets.bottom, 8);
  if (style === 'classic') {
    return (
      <View className="bg-surface border-t border-line" style={{ paddingBottom: bottom, paddingTop: 8 }}>
        <View className="flex-row px-2">{items}</View>
      </View>
    );
  }
  if (style === 'minimal') {
    return (
      <View className="bg-bg border-t border-line" style={{ paddingBottom: bottom }}>
        <View className="flex-row h-[58px] px-2">{items}</View>
      </View>
    );
  }
  return (
    <View className="bg-bg px-4" style={{ paddingBottom: bottom, paddingTop: 6 }}>
      <View className="flex-row items-center bg-surface border border-line rounded-full p-1.5 self-center w-full" style={{ maxWidth: 420, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>{items}</View>
    </View>
  );
}

export default function TabsLayout() {
  const { desktop } = useBp();
  return (
    <Tabs
      backBehavior="fullHistory"
      tabBar={(p) => <TabBar {...p} />}
      screenOptions={{ headerShown: false, tabBarPosition: desktop ? 'top' : 'bottom', sceneStyle: { backgroundColor: 'transparent' } } as any}
    >
      {TABS.map((t) => <Tabs.Screen key={t.name} name={t.name} />)}
    </Tabs>
  );
}
