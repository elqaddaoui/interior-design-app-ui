import React, { useCallback, useId, useRef, useState } from 'react';
import { Platform, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Txt } from '@/components/ui/Txt';
import { useProgress } from '@/hooks/useCountUp';
import { areaPath, compact, donutArcs, niceMax, smoothPath, ticksFor, toPoints } from '@/lib/chartGeo';
import { useTheme } from '@/theme/ThemeProvider';

export function useWidth() {
  const [w, setW] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => { const n = Math.round(e.nativeEvent.layout.width); setW((p) => (p === n ? p : n)); }, []);
  return [w, onLayout] as const;
}
const useSid = () => `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
const LTR = { direction: 'ltr' } as any;

/** Tiny trend line for KPI cards. */
export function Spark({ values, height = 38, color }: { values: number[]; height?: number; color?: string }) {
  const { colors } = useTheme();
  const [w, onLayout] = useWidth();
  const id = useSid();
  const c = color ?? colors.ink;
  const p = useProgress(values.join(','), 800);
  const pts = toPoints(values, w, height, Math.max(1, ...values), { l: 2, r: 4, t: 5, b: 3 });
  const last = pts[pts.length - 1];
  return (
    <View onLayout={onLayout} style={[{ height, width: '100%' }, LTR]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {w > 0 && pts.length > 1 ? (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={colors.primary} stopOpacity={0.45} /><Stop offset="1" stopColor={colors.primary} stopOpacity={0} /></LinearGradient>
            <ClipPath id={`${id}c`}><Rect x={0} y={0} width={Math.max(0.01, w * p)} height={height} /></ClipPath>
          </Defs>
          <G clipPath={`url(#${id}c)`}>
            <Path d={areaPath(pts, height)} fill={`url(#${id})`} />
            <Path d={smoothPath(pts)} stroke={c} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </G>
          {last && p > 0.98 ? <Circle cx={last[0]} cy={last[1]} r={3.2} fill={c} stroke={colors.surface} strokeWidth={1.5} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

export interface Tip { title: string; value: string; prev?: string; prevTitle?: string }
const GUT = 30, PAD = { l: 8, r: 8, t: 12, b: 8 };

/** Main trend chart: smooth line + area, previous period as a dashed line, grid, hover / touch tooltip. */
export function AreaChart({ values, prev, labels, tip, height = 200, testID }: { values: number[]; prev?: number[]; labels: string[]; tip: (i: number) => Tip; height?: number; testID?: string }) {
  const { colors } = useTheme();
  const [W, onLayout] = useWidth();
  const id = useSid();
  const [sel, setSel] = useState<number | null>(null);
  const box = useRef<View>(null);
  const originX = useRef(0);
  const iw = Math.max(1, W - GUT);
  const top = niceMax(Math.max(0, ...values, ...(prev ?? [])));
  const ticks = ticksFor(top, 3);
  const pts = toPoints(values, iw, height, top, PAD);
  const pp = prev ? toPoints(prev.slice(0, values.length), iw, height, top, PAD) : [];
  const p = useProgress(`${values.join(',')}|${prev ? 1 : 0}`, 900);
  const n = values.length;
  const pick = (x: number) => { const t = (x - PAD.l) / Math.max(1, iw - PAD.l - PAD.r); setSel(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))))); };
  const every = n > 14 ? Math.ceil(n / 6) : n > 7 ? 2 : 1;
  const y = (v: number) => PAD.t + (height - PAD.t - PAD.b) - (v / top) * (height - PAD.t - PAD.b);
  const s = sel === null ? null : pts[sel];
  const tp = sel === null ? null : tip(sel);
  const handlers: any = Platform.OS === 'web'
    ? { onMouseMove: (e: any) => { const r = e.currentTarget.getBoundingClientRect(); pick(e.clientX - r.left); }, onMouseLeave: () => setSel(null), onTouchStart: (e: any) => { const r = e.currentTarget.getBoundingClientRect(); pick(e.touches[0].clientX - r.left); }, onTouchMove: (e: any) => { const r = e.currentTarget.getBoundingClientRect(); pick(e.touches[0].clientX - r.left); } }
    : {};
  const responder: any = Platform.OS === 'web' ? {} : {
    onStartShouldSetResponder: () => true, onMoveShouldSetResponder: () => true,
    onResponderGrant: (e: any) => { const px = e.nativeEvent.pageX; box.current?.measure((_x, _y, _w, _h, pageX) => { originX.current = pageX; pick(px - pageX); }); },
    onResponderMove: (e: any) => pick(e.nativeEvent.pageX - originX.current),
    onResponderRelease: () => setSel(null), onResponderTerminate: () => setSel(null),
  };
  return (
    <View testID={testID} onLayout={onLayout} style={LTR}>
      <View style={{ height: height + 22 }}>
        {ticks.map((tk) => <Txt key={tk} className="text-[10px] text-muted" style={{ position: 'absolute', left: 0, width: GUT - 6, textAlign: 'right', top: y(tk) - 7 }}>{compact(tk)}</Txt>)}
        <View ref={box} collapsable={false} style={{ position: 'absolute', left: GUT, top: 0, width: iw, height }} {...responder}>
          {W > 0 ? (
            <Svg width={iw} height={height}>
              <Defs>
                <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={colors.primary} stopOpacity={0.5} /><Stop offset="1" stopColor={colors.primary} stopOpacity={0.02} /></LinearGradient>
                <ClipPath id={`${id}c`}><Rect x={0} y={0} width={Math.max(0.01, iw * p)} height={height} /></ClipPath>
              </Defs>
              {ticks.map((tk) => <Line key={tk} x1={0} x2={iw} y1={y(tk)} y2={y(tk)} stroke={colors.line} strokeWidth={1} strokeDasharray={tk === 0 ? undefined : '3 5'} />)}
              <G clipPath={`url(#${id}c)`}>
                {pp.length > 1 ? <Path d={smoothPath(pp)} stroke={colors.muted} strokeWidth={1.6} strokeDasharray="4 5" fill="none" strokeLinecap="round" opacity={0.8} /> : null}
                {pts.length > 1 ? <Path d={areaPath(pts, height - PAD.b)} fill={`url(#${id})`} /> : null}
                {pts.length > 1 ? <Path d={smoothPath(pts)} stroke={colors.ink} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
              </G>
              {s ? <>
                <Line x1={s[0]} x2={s[0]} y1={PAD.t - 4} y2={height - PAD.b} stroke={colors.muted} strokeWidth={1} strokeDasharray="2 3" />
                {prev && pp[sel!] ? <Circle cx={pp[sel!][0]} cy={pp[sel!][1]} r={3.5} fill={colors.surface} stroke={colors.muted} strokeWidth={1.6} /> : null}
                <Circle cx={s[0]} cy={s[1]} r={5} fill={colors.primary} stroke={colors.ink} strokeWidth={2.2} />
              </> : null}
            </Svg>
          ) : null}
          {Platform.OS === 'web' ? React.createElement('div', { style: { position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'pan-y' }, ...handlers, 'data-testid': 'chart-hit' }) : null}
        </View>
        {tp && s ? (
          <View pointerEvents="none" testID="chart-tip" className="bg-ink rounded-xl px-3 py-2" style={{ position: 'absolute', top: -6, left: Math.max(GUT, Math.min(GUT + s[0] - 54, W - 124)), width: 120, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' } as any}>
            <Txt className="text-onink text-[10px] opacity-70" numberOfLines={1}>{tp.title}</Txt>
            <Txt className="text-onink text-[16px] font-black leading-[20px]">{tp.value}</Txt>
            {tp.prev ? <Txt className="text-onink text-[10px] opacity-70" numberOfLines={1}>{tp.prevTitle} · {tp.prev}</Txt> : null}
          </View>
        ) : null}
        <View style={{ position: 'absolute', left: GUT, width: iw, top: height + 4, height: 16 }}>
          {labels.map((l, i) => (i % every === 0 && i + every <= n + 1 ? <Txt key={i} className="text-[10px] text-muted" numberOfLines={1} style={{ position: 'absolute', width: 44, textAlign: 'center', left: Math.max(0, Math.min(iw - 44, pts[i] ? pts[i][0] - 22 : 0)) }}>{l}</Txt> : null))}
        </View>
      </View>
    </View>
  );
}

/** Ring made of arcs; `center` is rendered in the middle. */
export function Donut({ values, colors: palette, size = 128, thickness = 14, center, testID }: { values: number[]; colors: string[]; size?: number; thickness?: number; center?: React.ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const r = (size - thickness) / 2, C = 2 * Math.PI * r, cx = size / 2;
  const arcs = donutArcs(values);
  const p = useProgress(values.join(','), 900);
  return (
    <View testID={testID} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cx} r={r} stroke={colors.surface2} strokeWidth={thickness} fill="none" />
        {arcs.map((a) => <Circle key={a.i} cx={cx} cy={cx} r={r} stroke={palette[a.i % palette.length]} strokeWidth={thickness} fill="none" strokeLinecap={arcs.length === 1 ? 'butt' : 'round'} strokeDasharray={`${Math.max(0.01, a.len * C * p)} ${C}`} strokeDashoffset={-a.from * C * p} rotation={-90} origin={`${cx}, ${cx}`} />)}
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>{center}</View>
    </View>
  );
}

/** One value 0..100 as a ring. */
export function Ring({ value, size = 76, thickness = 9, color, children }: { value: number; size?: number; thickness?: number; color?: string; children?: React.ReactNode }) {
  const { colors } = useTheme();
  return <Donut values={[Math.max(0, Math.min(100, value)), 100 - Math.max(0, Math.min(100, value))]} colors={[color ?? colors.ink, 'transparent']} size={size} thickness={thickness} center={children} />;
}

/** Days x time blocks. Intensity = share of the busiest cell. */
export function Heatmap({ grid, max, rows, cols, testID, label }: { grid: number[][]; max: number; rows: string[]; cols: string[]; testID?: string; label: (r: number, c: number, v: number) => string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={[{ gap: 4 }, LTR]}>
      <View className="flex-row" style={{ gap: 4, paddingStart: 34 }}>{cols.map((c) => <Txt key={c} className="text-[10px] text-muted flex-1 text-center">{c}</Txt>)}</View>
      {grid.map((row, r) => (
        <View key={r} className="flex-row items-center" style={{ gap: 4 }}>
          <Txt className="text-[10px] text-muted" numberOfLines={1} style={{ width: 30 }}>{rows[r]}</Txt>
          {row.map((v, c) => (
            <View key={c} accessible accessibilityLabel={label(r, c, v)} {...(Platform.OS === 'web' ? ({ title: label(r, c, v) } as any) : {})}
              style={{ flex: 1, height: 26, borderRadius: 7, backgroundColor: v === 0 || max === 0 ? colors.surface2 : colors.primary, opacity: v === 0 || max === 0 ? 1 : 0.22 + 0.78 * (v / max), borderWidth: v > 0 && v === max ? 1.5 : 0, borderColor: colors.ink }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Horizontal stacked bar (pipeline). */
export function StackBar({ parts, height = 12 }: { parts: { v: number; color: string; key: string }[]; height?: number }) {
  const { colors } = useTheme();
  const total = parts.reduce((a, b) => a + b.v, 0);
  const p = useProgress(parts.map((x) => x.v).join(','), 800);
  return (
    <View className="flex-row overflow-hidden" style={[{ height, borderRadius: height / 2, backgroundColor: colors.surface2, gap: 2 }, LTR]}>
      {total > 0 ? parts.filter((x) => x.v > 0).map((x) => <View key={x.key} style={{ flexGrow: x.v * p, flexBasis: 0, backgroundColor: x.color, borderRadius: height / 2 }} />) : null}
    </View>
  );
}
