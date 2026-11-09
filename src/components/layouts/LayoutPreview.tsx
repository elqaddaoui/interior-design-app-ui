import React from 'react';
import { View } from 'react-native';
import { useStore, sorted } from '@/store/useStore';
import type { LayoutDevice, LayoutScreen, LayoutsConfig } from '@/data/types';
import { paramsOf } from '@/lib/layouts';
import { HomeLayout } from './HomeLayouts';
import { ExploreLayout } from './ExploreLayouts';
import { useTheme } from '@/theme/ThemeProvider';
import { PreviewProvider } from './Motion';

const noop = () => {};
/**
 * Live, non-interactive preview of one demo layout with the app's real content, drawn at the width of a phone (390) or a computer (1100)
 * and scaled down to fit `width`. The inner layer is pinned to the PHYSICAL top-left: in RTL a wider child would otherwise anchor to the right edge and the
 * (top-left) scale origin would leave it off-screen, i.e. a blank preview. `cfg` is the DRAFT configuration, so every edit shows at once (before Save).
 */
export function LayoutPreview({ screen, id, device, cfg, width, maxHeight }: { screen: LayoutScreen; id: string; device: LayoutDevice; cfg: LayoutsConfig | undefined; width: number; maxHeight: number }) {
  const { colors } = useTheme();
  const tabs = useStore((s) => s.tabs);
  const tools = useStore((s) => s.tools);
  const sections = useStore((s) => s.sections);
  const categories = useStore((s) => s.categories);
  const items = useStore((s) => s.inspirations);
  const full = device === 'desktop' ? 1100 : 390;
  const scale = Math.min(1, width / full);
  const params = paramsOf(cfg, screen, id);
  const tablet = false;
  return (
    <PreviewProvider value>
    <View testID={`ly-preview-${screen}-${id}`} style={{ width, height: maxHeight, overflow: 'hidden', borderRadius: 10, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line }}>
      <View testID={`ly-preview-inner-${screen}-${id}`} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: full, padding: device === 'desktop' ? 28 : 16, transform: [{ scale }], transformOrigin: 'top left' } as any}>
        {screen === 'home'
          ? <HomeLayout id={id} params={params} device={device} tablet={tablet} tools={sorted(tools).filter((x) => x.visible).slice(0, 9)} tabs={sorted(tabs).filter((x) => x.visible)} onOpen={noop} />
          : <ExploreLayout id={id} params={params} device={device} tablet={tablet} sections={sorted(sections).filter((x) => x.visible)} categories={sorted(categories).filter((x) => x.visible)} items={items.filter((x) => x.visible)} />}
      </View>
    </View>
    </PreviewProvider>
  );
}
