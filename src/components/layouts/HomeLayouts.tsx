import React from 'react';
import { View } from 'react-native';
import type { HomeTab, LayoutDevice, Tool } from '@/data/types';
import { Carousel } from '@/components/ui/Carousel';
import { Txt } from '@/components/ui/Txt';
import { ToolCard } from '@/components/ToolCard';
import { useL } from '@/i18n';
import { columnsFor, type ParamKey } from '@/lib/layouts';
import { ToolTile } from './Tiles';
import { AuroraLayout, DeckLayout, FlowLayout, StoriesLayout } from './HomeWow';

type P = Partial<Record<ParamKey, number>>;
export interface HomeLayoutProps {
  id: string; params: P; device: LayoutDevice; tablet: boolean; tools: Tool[]; tabs: HomeTab[];
  onOpen: (id: string) => void; onPaint?: (i: number) => void;
}
const chunk = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/** A row of tiles sharing the width by flex weights. */
function Row({ gap, children }: { gap: number; children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap, marginBottom: gap }}>{children}</View>;
}
const Cell = ({ flex = 1, children }: { flex?: number; children: React.ReactNode }) => <View style={{ flex, minWidth: 0 }}>{children}</View>;

/** 1. Grid (Airbnb / Stripe): the classic uniform grid of full cards, the app's original layout. */
function GridLayout({ params, device, tablet, tools, onOpen, onPaint }: HomeLayoutProps) {
  const gap = params.gap ?? 16;
  const cols = columnsFor(device, tablet, params, 1, 3);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
      {tools.map((tool, i) => (
        <View key={tool.id} style={{ width: `${100 / cols}%`, padding: gap / 2 }}>
          <ToolCard tool={tool} index={i} onPress={() => onOpen(tool.id)} onReady={i < 2 && onPaint ? () => onPaint(i) : undefined} />
        </View>
      ))}
    </View>
  );
}

/** 2. Hero (Apple / Spotify): one big featured tool, then a compact grid. */
function HeroLayout({ params, device, tablet, tools, onOpen, onPaint }: HomeLayoutProps) {
  const gap = params.gap ?? 12; const radius = params.radius ?? 20;
  const H = (device === 'desktop' ? params.heightD : params.heightM) ?? 260;
  const cols = columnsFor(device, tablet, params, 2, 3);
  const [first, ...rest] = tools;
  if (!first) return null;
  return (
    <View>
      <View style={{ marginBottom: gap }}><ToolTile tool={first} index={0} height={H} radius={radius} onPress={() => onOpen(first.id)} onReady={onPaint ? () => onPaint(0) : undefined} /></View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
        {rest.map((tool, i) => (
          <View key={tool.id} style={{ width: `${100 / cols}%`, padding: gap / 2 }}>
            <ToolTile tool={tool} index={i + 1} height={Math.round(H * (device === 'desktop' ? 0.62 : 0.7))} radius={radius} compact onPress={() => onOpen(tool.id)} onReady={i < 1 && onPaint ? () => onPaint(1) : undefined} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** 3. Bento (Apple / Linear / Vercel): a mosaic of tiles of different sizes that interlock. */
function BentoLayout({ params, device, tools, onOpen, onPaint }: HomeLayoutProps) {
  const gap = params.gap ?? 12; const radius = params.radius ?? 24;
  const desktop = device === 'desktop';
  const H = (desktop ? params.heightD : params.heightM) ?? (desktop ? 420 : 200);
  const half = Math.round((H - gap) / 2);
  const tile = (t: Tool, i: number, h: number, compact?: boolean) => <ToolTile key={t.id} tool={t} index={i} height={h} radius={radius} compact={compact} onPress={() => onOpen(t.id)} onReady={i < 2 && onPaint ? () => onPaint(i) : undefined} />;
  return (
    <View>
      {chunk(tools, 3).map((block, bi) => {
        const base = bi * 3;
        const at = (k: number) => base + k;
        if (block.length < 3) {
          return <Row key={bi} gap={gap}>{block.map((t, k) => <Cell key={t.id}>{tile(t, at(k), Math.round(H * 0.62), true)}</Cell>)}</Row>;
        }
        const [a, b, c] = block;
        const kind = bi % 3;
        if (desktop) {
          if (kind === 1) return <Row key={bi} gap={gap}>{block.map((t, k) => <Cell key={t.id}>{tile(t, at(k), Math.round(H * 0.62), true)}</Cell>)}</Row>;
          const big = <Cell flex={2}>{tile(a, at(0), H)}</Cell>;
          const stack = <Cell><View style={{ gap }}>{tile(b, at(1), half, true)}{tile(c, at(2), half, true)}</View></Cell>;
          return <Row key={bi} gap={gap}>{kind === 0 ? <>{big}{stack}</> : <>{stack}{big}</>}</Row>;
        }
        const wide = <View key="w" style={{ marginBottom: gap }}>{tile(a, at(0), H)}</View>;
        const pair = <Row key="p" gap={gap}><Cell>{tile(b, at(1), Math.round(H * 0.8), true)}</Cell><Cell>{tile(c, at(2), Math.round(H * 0.8), true)}</Cell></Row>;
        return <View key={bi}>{bi % 2 === 0 ? <>{wide}{pair}</> : <>{pair}{wide}</>}</View>;
      })}
    </View>
  );
}

/** 4. Rail (Netflix / Disney+): one horizontal swim-lane per home tab. */
function RailLayout({ params, device, tablet, tools, tabs, onOpen, onPaint }: HomeLayoutProps) {
  const L = useL();
  const gap = params.gap ?? 12; const radius = params.radius ?? 16;
  const desktop = device === 'desktop';
  const H = (desktop ? params.heightD : params.heightM) ?? (desktop ? 220 : 170);
  const W = Math.round(H * (desktop ? 1.6 : 1.5)) + (tablet && !desktop ? 40 : 0);
  const lanes = tabs.map((tab) => ({ key: tab.id, title: L(tab.title), list: tools.filter((t) => t.tabId === tab.id) })).filter((l) => l.list.length > 0);
  const known = new Set(tabs.map((x) => x.id));
  const other = tools.filter((t) => !known.has(t.tabId));
  if (other.length) lanes.push({ key: '__other__', title: '', list: other });
  // Running index of the first tool of each lane (computed up front, never changed while rendering).
  const starts = lanes.reduce<number[]>((acc, lane, k) => { acc.push(k === 0 ? 0 : acc[k - 1] + lanes[k - 1].list.length); return acc; }, []);
  return (
    <View>
      {lanes.map((lane, li) => (
        <View key={lane.key} style={{ marginBottom: 20, marginHorizontal: desktop ? -24 : 0 }}>
          {lane.title ? <Txt className="font-black mb-2.5" style={{ fontSize: desktop ? 22 : 18, paddingHorizontal: desktop ? 24 : 0 }} numberOfLines={1}>{lane.title}</Txt> : null}
          <Carousel gap={gap}>
            {lane.list.map((t, k) => { const i = starts[li] + k; return <View key={t.id} style={{ width: W }}><ToolTile tool={t} index={i} height={H} radius={radius} compact={!desktop && H < 150} onPress={() => onOpen(t.id)} onReady={i < 2 && onPaint ? () => onPaint(i) : undefined} /></View>; })}
          </Carousel>
        </View>
      ))}
    </View>
  );
}

export function HomeLayout(props: HomeLayoutProps) {
  const body = props.id === 'hero' ? <HeroLayout {...props} />
    : props.id === 'bento' ? <BentoLayout {...props} />
    : props.id === 'rail' ? <RailLayout {...props} />
    : props.id === 'flow' ? <FlowLayout {...props} />
    : props.id === 'stories' ? <StoriesLayout {...props} />
    : props.id === 'aurora' ? <AuroraLayout {...props} />
    : props.id === 'deck' ? <DeckLayout {...props} />
    : <GridLayout {...props} />;
  return <View testID={`layout-home-${props.id}`}>{body}</View>;
}
