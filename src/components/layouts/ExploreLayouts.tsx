import React from 'react';
import { View } from 'react-native';
import type { InspirationCategory, InspirationItem, InspirationSection, LayoutDevice } from '@/data/types';
import { Card } from '@/components/ui/Card';
import { Carousel } from '@/components/ui/Carousel';
import { columnsFor, type ParamKey } from '@/lib/layouts';
import { CategoryTile } from './Tiles';
import { SectionHead, chunk, countOf, openCat } from './shared';
import { AccordionLayout, FlowLayout, PolaroidLayout, SpotlightLayout } from './ExploreWow';

type P = Partial<Record<ParamKey, number>>;
export interface ExploreLayoutProps {
  id: string; params: P; device: LayoutDevice; tablet: boolean;
  sections: InspirationSection[]; categories: InspirationCategory[]; items: InspirationItem[];
}
/** 1. Rails (Netflix / Spotify): a card per section with a horizontal swim-lane of tall category tiles (the app's original layout). */
function RailsLayout({ device, sections, categories, items }: ExploreLayoutProps) {
  const desktop = device === 'desktop';
  return <>{sections.map((sec) => (
    <View key={sec.id} className="mt-4 mb-4">
      <Card className={desktop ? 'p-5 mb-4 rounded-3xl' : 'p-3 mb-3'}>
        <SectionHead sec={sec} />
        <Carousel>
          {categories.filter((c) => c.sectionId === sec.id).map((c) => <View key={c.id} style={{ width: desktop ? 244 : 148 }}><CategoryTile cat={c} count={countOf(items, c)} height={desktop ? 300 : 196} radius={16} onPress={() => openCat(c)} /></View>)}
        </Carousel>
      </Card>
    </View>
  ))}</>;
}

/** 2. Mosaic (Pinterest / Behance): masonry columns of tiles with varied heights, one flowing wall per section. */
function MosaicLayout({ params, device, tablet, sections, categories, items }: ExploreLayoutProps) {
  const gap = params.gap ?? 10; const radius = params.radius ?? 18;
  const cols = columnsFor(device, tablet, params, 2, 4);
  const base = device === 'desktop' ? 220 : 150;
  const heights = [1.25, 0.85, 1.05, 1.4, 0.95, 1.15];
  return <>{sections.map((sec) => {
    const list = categories.filter((c) => c.sectionId === sec.id);
    const columns: { c: InspirationCategory; h: number }[][] = Array.from({ length: cols }, () => []);
    const used = new Array(cols).fill(0);
    list.forEach((c, i) => { const h = Math.round(base * heights[i % heights.length]); const k = used.indexOf(Math.min(...used)); columns[k].push({ c, h }); used[k] += h + gap; });
    return (
      <View key={sec.id} className="mt-5">
        <SectionHead sec={sec} big={device === 'desktop'} />
        <View style={{ flexDirection: 'row', gap }}>
          {columns.map((col, k) => <View key={k} style={{ flex: 1, minWidth: 0, gap }}>{col.map(({ c, h }) => <CategoryTile key={c.id} cat={c} count={countOf(items, c)} height={h} radius={radius} onPress={() => openCat(c)} />)}</View>)}
        </View>
      </View>
    );
  })}</>;
}

/** 3. Editorial (Medium / The Verge): the first category of each section is a large cover story, the rest a tidy block beside / below it. */
function EditorialLayout({ params, device, tablet, sections, categories, items }: ExploreLayoutProps) {
  const gap = params.gap ?? 12; const radius = params.radius ?? 20;
  const desktop = device === 'desktop';
  const H = (desktop ? params.heightD : params.heightM) ?? (desktop ? 400 : 240);
  const per = desktop ? 2 : tablet ? 3 : 2;
  return <>{sections.map((sec) => {
    const [lead, ...rest] = categories.filter((c) => c.sectionId === sec.id);
    if (!lead) return null;
    const rows = chunk(rest, per);
    // Desktop: the rows share the cover's height so both columns end on the same line (never thinner than 110 px).
    const tileH = desktop ? Math.max(110, Math.round((H - gap * (rows.length - 1)) / Math.max(1, rows.length))) : Math.round(H * 0.5);
    return (
      <View key={sec.id} className="mt-5">
        <SectionHead sec={sec} big={desktop} />
        <View style={{ flexDirection: desktop ? 'row' : 'column', gap, alignItems: 'flex-start' }}>
          <View style={{ flex: desktop ? 2 : undefined, width: desktop ? undefined : '100%', minWidth: 0 }}><CategoryTile cat={lead} count={countOf(items, lead)} height={H} radius={radius} large onPress={() => openCat(lead)} /></View>
          {rows.length ? <View style={{ flex: desktop ? 1 : undefined, width: desktop ? undefined : '100%', minWidth: 0, gap }}>
            {rows.map((row, ri) => (
              <View key={ri} style={{ flexDirection: 'row', gap }}>
                {Array.from({ length: per }, (_, k) => row[k]).map((c, k) => <View key={c?.id ?? `s${k}`} style={{ flex: 1, minWidth: 0 }}>{c ? <CategoryTile cat={c} count={countOf(items, c)} height={tileH} radius={radius} onPress={() => openCat(c)} /> : null}</View>)}
              </View>
            ))}
          </View> : null}
        </View>
      </View>
    );
  })}</>;
}

/** 4. Tiles (Airbnb / Houzz): clean square tiles with the caption under the picture, one tidy grid per section. */
function TilesLayout({ params, device, tablet, sections, categories, items }: ExploreLayoutProps) {
  const gap = params.gap ?? 16; const radius = params.radius ?? 20;
  const cols = columnsFor(device, tablet, params, 2, 5);
  return <>{sections.map((sec) => (
    <View key={sec.id} className="mt-5">
      <SectionHead sec={sec} big={device === 'desktop'} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
        {categories.filter((c) => c.sectionId === sec.id).map((c) => <View key={c.id} style={{ width: `${100 / cols}%`, padding: gap / 2 }}><CategoryTile cat={c} count={countOf(items, c)} square radius={radius} caption="below" onPress={() => openCat(c)} /></View>)}
      </View>
    </View>
  ))}</>;
}

export function ExploreLayout(props: ExploreLayoutProps) {
  const body = props.id === 'mosaic' ? <MosaicLayout {...props} />
    : props.id === 'editorial' ? <EditorialLayout {...props} />
    : props.id === 'tiles' ? <TilesLayout {...props} />
    : props.id === 'flow' ? <FlowLayout {...props} />
    : props.id === 'polaroid' ? <PolaroidLayout {...props} />
    : props.id === 'spotlight' ? <SpotlightLayout {...props} />
    : props.id === 'accordion' ? <AccordionLayout {...props} />
    : <RailsLayout {...props} />;
  return <View testID={`layout-explore-${props.id}`}>{body}</View>;
}
