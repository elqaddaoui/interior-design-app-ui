import React from 'react';
import { View } from 'react-native';
import { MediaView } from '@/components/ui/MediaView';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import type { FieldDef, Ctx, Opt } from '@/components/admin/FormModal';
import type { CollMap, CollName, LText, Media } from '@/data/types';
import { nextOrder, sorted } from '@/store/useStore';

export interface Chip { icon?: string; label: string; tone?: 'muted' | 'primary' | 'success' | 'danger' }
/** What one item looks like in the list: each entity describes itself in terms of its own content. */
export interface RowView {
  /** Leading visual of a list row (thumbnail, icon tile, number...). */
  lead?: React.ReactNode;
  /** Cover shown on top of the tile in grid layouts. */
  cover?: Media;
  title: string;
  subtitle?: string;
  chips?: Chip[];
  /** Entity-specific rich content (colour swatches, price...). */
  extra?: React.ReactNode;
}

export interface EntityConfig<K extends CollName = CollName> {
  name: K;
  navKey: string;
  icon: string;
  ordered: boolean;
  /** Image-led entities are shown as a grid of tiles instead of a list of rows. */
  visual?: boolean;
  fields(c: Ctx): FieldDef[];
  view(c: Ctx): (r: CollMap[K], index: number) => RowView;
  blank(c: Ctx): Omit<CollMap[K], 'id'>;
  /** Collections whose rows are deleted with the parent: [collection, foreign key]. */
  cascade?: [CollName, string][];
}

const lt = (): LText => ({ dar: '', ar: '', fr: '' });
const o = (c: Ctx, name: CollName) => nextOrder(c.s[name] as { order: number }[]);
const opts = <T extends { id: string; title: LText }>(c: Ctx, list: T[]): Opt[] => sorted(list as any).map((x: any) => ({ value: x.id, label: c.L(x.title) }));
const common = (c: Ctx): FieldDef[] => [{ kind: 'bool', key: 'visible', label: c.t('admin.f.visible') }];
const iconTile = (icon: string, tone: 'primary' | 'ink' | 'soft' = 'soft') => (
  <View className={`w-14 h-14 rounded-2xl items-center justify-center ${tone === 'primary' ? 'bg-primary' : tone === 'ink' ? 'bg-ink' : 'bg-soft'}`}>
    <Icon name={icon} size={26} tone={tone === 'primary' ? 'onprimary' : tone === 'ink' ? 'onink' : 'fg'} />
  </View>
);
const photo = (uri: string | undefined, round = false) => <MediaView uri={uri} className={round ? 'rounded-full' : 'rounded-2xl'} style={{ width: 56, height: 56 }} />;
const count = (c: Ctx, key: string, n: number): Chip => ({ icon: 'layers-outline', label: c.t(`improve.${key}`, { count: n }) });

const stepOpts = (c: Ctx): Opt[] => (['room', 'style', 'mode'] as const).map((k) => ({ value: k, label: c.t(`admin.enums.${k}`) }));

const tabs: EntityConfig<'tabs'> = {
  name: 'tabs', navKey: 'tabs', icon: 'tab', ordered: true,
  fields: (c) => [{ kind: 'ltext', key: 'title', label: c.t('admin.f.title') }, ...common(c)],
  view: (c) => (r) => ({
    lead: iconTile('tab'),
    title: c.L(r.title) || '—',
    chips: [count(c, 'toolsCount', c.s.tools.filter((x) => x.tabId === r.id).length)],
  }),
  blank: (c) => ({ title: lt(), order: o(c, 'tabs'), visible: true }),
  cascade: [['tools', 'tabId']],
};

const tools: EntityConfig<'tools'> = {
  name: 'tools', navKey: 'tools', icon: 'toolbox-outline', ordered: true,
  fields: (c) => [
    { kind: 'ltext', key: 'title', label: c.t('admin.f.title') },
    { kind: 'ltext', key: 'subtitle', label: c.t('admin.f.subtitle') },
    { kind: 'media', key: 'media', label: c.t('admin.f.media') },
    { kind: 'select', key: 'tabId', label: c.t('admin.f.tab'), required: true, options: (x) => opts(x, x.s.tabs) },
    { kind: 'select', key: 'roomGroup', label: c.t('admin.f.group'), options: (x) => [{ value: 'interior', label: x.t('admin.enums.interior') }, { value: 'exterior', label: x.t('admin.enums.exterior') }] },
    { kind: 'multi', key: 'steps', label: c.t('admin.f.steps'), options: stepOpts },
    { kind: 'multi', key: 'modelIds', label: c.t('admin.f.models'), options: (x) => x.s.models.map((m) => ({ value: m.id, label: m.name })) },
    ...common(c),
  ],
  view: (c) => (r) => {
    const tab = c.L(c.s.tabs.find((x) => x.id === r.tabId)?.title);
    return {
      lead: <MediaView media={r.media.type === 'video' && r.media.poster ? { type: 'image', uri: r.media.poster } : r.media} className="rounded-2xl" style={{ width: 56, height: 56 }}>{r.media.type === 'video' ? <View className="absolute inset-0 items-center justify-center bg-black/25"><Icon name="play" size={20} color="#fff" /></View> : null}</MediaView>,
      cover: r.media,
      title: c.L(r.title) || '—',
      subtitle: c.L(r.subtitle),
      chips: [
        ...(tab ? [{ icon: 'tab', label: tab }] : []),
        { icon: r.roomGroup === 'exterior' ? 'home-roof' : 'sofa-outline', label: c.t(`admin.enums.${r.roomGroup ?? 'interior'}`) },
        ...r.steps.map((k: string) => ({ label: c.t(`admin.enums.${k}`), tone: 'primary' as const })),
        ...(r.media.type === 'video' ? [{ icon: 'video-outline', label: c.t('admin.enums.video') }] : []),
      ],
    };
  },
  blank: (c) => ({ tabId: sorted(c.s.tabs)[0]?.id ?? '', title: lt(), subtitle: lt(), media: { type: 'image', uri: '' }, steps: ['room', 'style'], modelIds: c.s.models.filter((m) => m.enabled).map((m) => m.id), roomGroup: 'interior', order: o(c, 'tools'), visible: true }),
};

const sections: EntityConfig<'sections'> = {
  name: 'sections', navKey: 'sections', icon: 'view-carousel-outline', ordered: true,
  fields: (c) => [
    { kind: 'ltext', key: 'title', label: c.t('admin.f.title') },
    { kind: 'icon', key: 'icon', label: c.t('admin.f.icon') },
    { kind: 'select', key: 'toolId', label: c.t('admin.f.tool'), required: true, options: (x) => opts(x, x.s.tools) },
    ...common(c),
  ],
  view: (c) => (r) => ({
    lead: iconTile(r.icon, 'primary'),
    title: c.L(r.title) || '—',
    subtitle: c.L(c.s.tools.find((x) => x.id === r.toolId)?.title),
    chips: [{ icon: 'link-variant', label: c.t('admin.f.tool') }, count(c, 'categoriesCount', c.s.categories.filter((x) => x.sectionId === r.id).length)],
  }),
  blank: (c) => ({ title: lt(), icon: 'sofa-outline', toolId: sorted(c.s.tools)[0]?.id ?? '', order: o(c, 'sections'), visible: true }),
  cascade: [['categories', 'sectionId']],
};

const categories: EntityConfig<'categories'> = {
  name: 'categories', navKey: 'categories', icon: 'view-grid-outline', ordered: true, visual: true,
  fields: (c) => [
    { kind: 'ltext', key: 'title', label: c.t('admin.f.title') },
    { kind: 'image', key: 'cover', label: c.t('admin.f.cover') },
    { kind: 'select', key: 'sectionId', label: c.t('admin.f.section'), required: true, options: (x) => opts(x, x.s.sections) },
    { kind: 'select', key: 'roomTypeId', label: c.t('admin.f.roomType'), options: (x) => opts(x, x.s.roomTypes) },
    { kind: 'select', key: 'galleryLayout', label: c.t('improve.galleryLayout'), options: (x) => ['inherit', 'grid', 'masonry', 'editorial', 'carousel'].map((value) => ({ value: value === 'inherit' ? '' : value, label: x.t(`improve.${value}`) })) },
    ...common(c),
  ],
  view: (c) => (r) => {
    const room = c.s.roomTypes.find((x) => x.id === r.roomTypeId);
    return {
      cover: { type: 'image', uri: r.cover },
      title: c.L(r.title) || '—',
      subtitle: c.L(c.s.sections.find((x) => x.id === r.sectionId)?.title),
      chips: [{ icon: 'image-multiple-outline', label: c.t('improve.photosCount', { count: c.s.inspirations.filter((x) => x.categoryId === r.id).length }) }, ...(room ? [{ icon: room.icon, label: c.L(room.title) }] : [])],
    };
  },
  blank: (c) => ({ title: lt(), cover: '', sectionId: sorted(c.s.sections)[0]?.id ?? '', order: o(c, 'categories'), visible: true }),
  cascade: [['inspirations', 'categoryId']],
};

const inspirations: EntityConfig<'inspirations'> = {
  name: 'inspirations', navKey: 'inspirations', icon: 'image-multiple-outline', ordered: true, visual: true,
  fields: (c) => [
    { kind: 'image', key: 'image', label: c.t('admin.f.photo') },
    { kind: 'select', key: 'categoryId', label: c.t('admin.f.category'), required: true, options: (x) => opts(x, x.s.categories) },
    { kind: 'select', key: 'styleId', label: c.t('admin.f.style'), options: (x) => opts(x, x.s.styles) },
    ...common(c),
  ],
  view: (c) => (r) => {
    const style = c.s.styles.find((x) => x.id === r.styleId);
    const cat = c.L(c.s.categories.find((x) => x.id === r.categoryId)?.title);
    return {
      cover: { type: 'image', uri: r.image },
      title: cat || '—',
      chips: style ? [{ icon: 'palette-swatch-outline', label: c.L(style.title) }] : [],
    };
  },
  blank: (c) => ({ image: '', categoryId: sorted(c.s.categories)[0]?.id ?? '', order: o(c, 'inspirations'), visible: true }),
};

const styles: EntityConfig<'styles'> = {
  name: 'styles', navKey: 'styles', icon: 'palette-swatch-outline', ordered: true, visual: true,
  fields: (c) => [{ kind: 'ltext', key: 'title', label: c.t('admin.f.title') }, { kind: 'image', key: 'image', label: c.t('admin.f.photo') }, ...common(c)],
  view: (c) => (r) => ({
    cover: { type: 'image', uri: r.image },
    title: c.L(r.title) || '—',
  }),
  blank: (c) => ({ title: lt(), image: '', order: o(c, 'styles'), visible: true }),
};

const roomTypes: EntityConfig<'roomTypes'> = {
  name: 'roomTypes', navKey: 'roomTypes', icon: 'door-open', ordered: true,
  fields: (c) => [
    { kind: 'ltext', key: 'title', label: c.t('admin.f.title') },
    { kind: 'select', key: 'group', label: c.t('admin.f.group'), options: (x) => [{ value: 'interior', label: x.t('admin.enums.interior') }, { value: 'exterior', label: x.t('admin.enums.exterior') }] },
    { kind: 'select', key: 'displayMode', label: c.t('admin.f.displayMode'), options: (x) => [{ value: 'icon', label: x.t('admin.enums.icon') }, { value: 'image', label: x.t('admin.enums.image') }] },
    { kind: 'icon', key: 'icon', label: c.t('admin.f.icon'), show: (v) => v.displayMode === 'icon' },
    { kind: 'image', key: 'image', label: c.t('admin.f.photo'), show: (v) => v.displayMode === 'image' },
    { kind: 'bool', key: 'isNew', label: c.t('admin.f.isNew') },
    ...common(c),
  ],
  view: (c) => (r) => ({
    lead: r.displayMode === 'image' ? photo(r.image) : iconTile(r.icon),
    title: c.L(r.title) || '—',
    chips: [
      { icon: r.group === 'exterior' ? 'home-roof' : 'sofa-outline', label: c.t(`admin.enums.${r.group}`) },
      { icon: r.displayMode === 'image' ? 'image-outline' : 'shape-outline', label: c.t(`admin.enums.${r.displayMode}`) },
      ...(r.isNew ? [{ icon: 'star', label: c.t('common.new'), tone: 'danger' as const }] : []),
    ],
  }),
  blank: (c) => ({ title: lt(), group: 'interior', displayMode: 'icon', icon: 'sofa-outline', image: '', isNew: false, order: o(c, 'roomTypes'), visible: true }),
};

const palettes: EntityConfig<'palettes'> = {
  name: 'palettes', navKey: 'palettes', icon: 'palette-outline', ordered: true,
  fields: (c) => [
    { kind: 'ltext', key: 'title', label: c.t('admin.f.title') },
    { kind: 'colors', key: 'colors', label: c.t('admin.f.colors'), show: (v) => !v.isSurprise },
    { kind: 'bool', key: 'isSurprise', label: c.t('admin.f.isSurprise') },
    ...common(c),
  ],
  view: (c) => (r) => ({
    lead: r.isSurprise ? iconTile('shimmer', 'primary') : <View className="w-14 h-14 rounded-2xl overflow-hidden border border-line flex-row" style={{ flexWrap: 'wrap' }}>{r.colors.slice(0, 4).map((x: string, i: number) => <View key={i} style={{ width: '50%', height: '50%', backgroundColor: x }} />)}</View>,
    title: c.L(r.title) || '—',
    chips: r.isSurprise ? [{ icon: 'shimmer', label: c.t('admin.f.isSurprise') }] : [],
    extra: r.isSurprise ? undefined : <View className="flex-row h-3 rounded-full overflow-hidden mt-1">{r.colors.map((x: string, i: number) => <View key={i} style={{ flex: 1, backgroundColor: x }} />)}</View>,
  }),
  blank: (c) => ({ title: lt(), colors: ['#F5F0E6', '#C9B79C', '#8A6F4D'], isSurprise: false, order: o(c, 'palettes'), visible: true }),
};

const models: EntityConfig<'models'> = {
  name: 'models', navKey: 'models', icon: 'robot-outline', ordered: true,
  fields: (c) => [
    { kind: 'text', key: 'name', label: c.t('admin.f.name'), required: true },
    { kind: 'text', key: 'provider', label: c.t('admin.f.provider'), required: true },
    { kind: 'text', key: 'modelName', label: c.t('admin.f.modelName'), required: true },
    { kind: 'select', key: 'engine', label: c.t('admin.f.engine'), options: () => [{ value: '', label: c.t('admin.f.engineAuto') }, { value: 'pollinations', label: 'Pollinations' }, { value: 'openai', label: c.t('admin.ai.openai') }] },
    { kind: 'text', key: 'baseUrl', label: c.t('admin.f.baseUrl') },
    { kind: 'secret', key: 'apiKey', label: c.t('admin.f.apiKey') },
    { kind: 'bool', key: 'enabled', label: c.t('admin.f.enabled') },
    { kind: 'bool', key: 'isDefault', label: c.t('admin.f.isDefault') },
    ...common(c),
  ],
  view: (c) => (r) => ({
    lead: iconTile('robot-outline', r.enabled ? 'ink' : 'soft'),
    title: r.name || '—',
    subtitle: `${r.provider} · ${r.modelName}${r.engine ? ` · ${r.engine}` : ''}`,
    chips: [
      { icon: r.enabled ? 'check-circle' : 'close-circle-outline', label: c.t('admin.f.enabled'), tone: r.enabled ? 'success' as const : 'muted' as const },
      ...(r.isDefault ? [{ icon: 'star', label: c.t('admin.f.isDefault'), tone: 'primary' as const }] : []),
      { icon: 'key-outline', label: r.apiKey ? '••••' + String(r.apiKey).slice(-4) : '—' },
    ],
  }),
  blank: (c) => ({ name: '', provider: '', modelName: '', apiKey: '', engine: '', baseUrl: '', enabled: true, isDefault: false, order: o(c, 'models'), visible: true }),
};

const plans: EntityConfig<'plans'> = {
  name: 'plans', navKey: 'plans', icon: 'crown-outline', ordered: true,
  fields: (c) => [
    { kind: 'ltext', key: 'title', label: c.t('admin.f.title') },
    { kind: 'text', key: 'price', label: c.t('admin.f.price'), required: true },
    { kind: 'ltext', key: 'period', label: c.t('admin.f.period') },
    { kind: 'bool', key: 'popular', label: c.t('admin.f.popular') },
    ...common(c),
  ],
  view: (c) => (r) => ({
    lead: iconTile('crown-outline', r.popular ? 'primary' : 'soft'),
    title: c.L(r.title) || '—',
    chips: r.popular ? [{ icon: 'star', label: c.t('admin.f.popular'), tone: 'primary' as const }] : [],
    extra: <View className="flex-row items-baseline gap-1.5"><Txt className="font-black text-[20px]">{r.price || '—'}</Txt><Txt className="text-muted text-[13px]">{c.L(r.period)}</Txt></View>,
  }),
  blank: (c) => ({ title: lt(), price: '', period: lt(), popular: false, order: o(c, 'plans'), visible: true }),
};

export const ENTITIES = { tabs, tools, sections, categories, inspirations, styles, roomTypes, palettes, models, plans } as unknown as Record<string, EntityConfig<any>>;
export const NAV_ENTITIES = Object.values(ENTITIES);
