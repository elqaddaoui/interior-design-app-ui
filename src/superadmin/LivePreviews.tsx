/**
 * Live previews, shared by Demos, Stores and Store themes: every item is its real page running in an iframe inside a device frame
 * (a phone or a desktop browser window), so the list can be reviewed on one screen with the true responsive layout.
 *
 * How the frame is drawn: the page is laid out at the REAL size of the device (390 x 844 for a phone, 1280 x 800 for a desktop) and
 * scaled down with a CSS transform. The iframe is `position: absolute` with `flexShrink: 0`: inside a flex column (every React Native
 * View is one) an in-flow iframe is a flex item and gets shrunk to the scaled height of its wrapper, so the page would only fill the
 * top part of the frame and the rest would stay empty.
 * Styled by SA tokens only (see tokens.ts), like the rest of the console.
 */
import React, { useState } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { Icon } from './icons';
import { SA } from './tokens';
import { Btn, Row, Segmented, T } from './ui';
import { tr } from './i18n';

export type ViewMode = 'list' | 'live';
export type PreviewItem = {
  id: string; name: string;
  /** Address of the page to show (a store, a demo...). */
  path: string;
  badge?: React.ReactNode; sub?: string; actions?: React.ReactNode;
  /** Drawn instead of the iframe when there is no page to run (for example a theme whose source store was deleted). */
  fallback?: React.ReactNode;
};

/** The List / Live previews switch shown in the heading of Demos, Stores and Store themes. */
export function ViewSwitch({ value, onChange, testID = 'sa-view' }: { value: ViewMode; onChange: (value: ViewMode) => void; testID?: string }) {
  return <Segmented value={value} onChange={onChange} testID={testID} options={[{ value: 'list', label: tr('List'), testID: 'sa-view-list' }, { value: 'live', label: tr('Live previews'), testID: 'sa-view-live' }]} />;
}

/** Real viewport of each device. */
export const DEVICES = { phone: { w: 390, h: 844 }, desktop: { w: 1280, h: 800 } } as const;
/** Previews started at once: every one is a whole app, so the rest wait for "Show more". */
const FIRST = 8;

/** Size of the scaled screen for a card of `cardW` px: the page keeps the device's aspect ratio. Pure, so it is easy to check. */
export function screenSize(mode: 'phone' | 'desktop', cardW: number) {
  const device = DEVICES[mode];
  const inner = cardW - 2 - (mode === 'phone' ? 20 : 0); // card border, and the padding around the phone
  const width = inner - (mode === 'phone' ? 12 : 0); // the phone's bezel
  const scale = width / device.w;
  return { width, height: Math.round(device.h * scale), scale, device };
}

function Frame({ item, mode, cardW, paused }: { item: PreviewItem; mode: 'phone' | 'desktop'; cardW: number; paused: boolean }) {
  const { width, height, scale, device } = screenSize(mode, cardW);
  const web = Platform.OS === 'web';
  const screen = (
    <View style={{ width, height, overflow: 'hidden', position: 'relative', backgroundColor: SA.color.panel2, borderRadius: mode === 'phone' ? 20 : 0 }}>
      {paused || !web || !item.path ? (
        item.fallback || <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Icon name={mode === 'phone' ? 'cellphone' : 'monitor'} size={30} color={SA.color.muted} /></View>
      ) : (
        React.createElement('iframe', {
          src: item.path, title: tr('Live preview of {name}', { name: item.name }), loading: 'lazy', tabIndex: -1,
          style: { position: 'absolute', left: 0, top: 0, width: device.w, height: device.h, flexShrink: 0, maxWidth: 'none', border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none', background: '#fff' },
        })
      )}
    </View>
  );
  if (mode === 'phone') {
    return (
      <View style={{ padding: 10, backgroundColor: SA.color.panel2, alignItems: 'center' }}>
        <View testID="sa-live-bezel" style={{ backgroundColor: '#14161C', borderRadius: 30, paddingHorizontal: 6, paddingTop: 16, paddingBottom: 12, alignItems: 'center' }}>
          <View style={{ position: 'absolute', top: 6, width: 48, height: 4, borderRadius: 2, backgroundColor: '#3A3D48' }} />
          {screen}
        </View>
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: SA.color.panel2 }}>
      <View testID="sa-live-bar" style={{ height: 26, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: SA.color.line }}>
        {['#E5534B', '#D9A441', '#4CAF72'].map(color => <View key={color} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />)}
        <View style={{ flex: 1, height: 16, borderRadius: 8, backgroundColor: SA.color.panel, marginStart: 8, justifyContent: 'center', paddingHorizontal: 8 }}><T size="xs" color={SA.color.muted} numberOfLines={1}>{item.path}</T></View>
      </View>
      {screen}
    </View>
  );
}

/** Smallest card a column may have, per device: it decides how many columns fit the container. */
const MIN_CARD = { phone: 200, desktop: 340 } as const;
/** Most columns: four phones or two desktop windows per row. */
const MAX_COLS = { phone: 4, desktop: 2 } as const;
/** Columns that fit a container of `room` px (pure, so it is easy to check): as many as MAX_COLS, fewer when the cards would get too small. */
export function columnsFor(mode: 'phone' | 'desktop', room: number, gap: number = SA.space.lg) {
  return Math.max(1, Math.min(MAX_COLS[mode], Math.floor((room + gap) / (MIN_CARD[mode] + gap))));
}

export function LivePreviews({ items, testID = 'sa-live' }: { items: PreviewItem[]; testID?: string }) {
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<'phone' | 'desktop'>('phone');
  const [paused, setPaused] = useState(false);
  const [shown, setShown] = useState(FIRST);
  const wide = width >= SA.wide;
  // First guess from the window (window - side bar - page padding), replaced by the real width of the container once it is laid out.
  const guess = Math.max(240, Math.min(SA.maxWidth, width - (wide ? 224 + SA.space.xxl * 2 : SA.space.lg * 2)));
  const [measured, setMeasured] = useState(0);
  const room = measured || guess;
  const gap = SA.space.lg;
  const cols = columnsFor(mode, room, gap);
  // The cards share the container's whole width: the rows start and end on its edges.
  const cardW = Math.floor((room - gap * (cols - 1)) / cols);
  const list = items.slice(0, shown);
  const rows: PreviewItem[][] = [];
  for (let i = 0; i < list.length; i += cols) rows.push(list.slice(i, i + cols));
  return (
    <View testID={testID} style={{ width: '100%' }} onLayout={e => { const w = Math.floor(e.nativeEvent.layout.width); if (w > 0 && w !== measured) setMeasured(w); }}>
      <Row style={{ marginBottom: SA.space.md, justifyContent: 'space-between' }}>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'phone', label: tr('Phone'), testID: 'sa-live-phone' }, { value: 'desktop', label: tr('Desktop'), testID: 'sa-live-desktop' }]} />
        <Btn small kind="ghost" icon={paused ? 'refresh' : 'close'} label={paused ? tr('Load previews') : tr('Stop previews')} onPress={() => setPaused(p => !p)} />
      </Row>
      <View testID="sa-live-grid" style={{ gap }}>
        {rows.map((row, r) => (
          // `stretch`: the cards of one row are as tall as the tallest, so their frames and footers line up.
          <View key={`${mode}-${r}`} testID="sa-live-row" style={{ flexDirection: 'row', gap, alignItems: 'stretch' }}>
            {row.map(item => (
              <View key={`${mode}-${item.id}`} testID="sa-live-card" style={{ width: cardW, backgroundColor: SA.color.panel, borderColor: SA.color.line, borderWidth: 1, borderRadius: SA.radius.lg, overflow: 'hidden' }}>
                <Frame item={item} mode={mode} cardW={cardW} paused={paused} />
                <View style={{ padding: SA.space.md, gap: SA.space.sm, borderTopWidth: 1, borderColor: SA.color.line, flexGrow: 1 }}>
                  <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><T weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>{item.name}</T>{item.badge}</Row>
                  {item.sub ? <T size="xs" color={SA.color.muted} numberOfLines={1}>{item.sub}</T> : null}
                  {item.actions ? <Row style={{ gap: 6 }}>{item.actions}</Row> : null}
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
      {items.length > shown ? <View style={{ marginTop: SA.space.lg, alignItems: 'flex-start' }}><Btn testID="sa-live-more" kind="ghost" label={tr('Show {n} more ({left} left)', { n: Math.min(FIRST, items.length - shown), left: items.length - shown })} onPress={() => setShown(n => n + FIRST)} /></View> : null}
    </View>
  );
}
