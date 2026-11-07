 
import React, { useId, useMemo } from 'react';
import { Platform, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { appIconLayout, ctxFor, fontsIn, layoutLogo, toSvg, type Layout } from '@/lib/brand/layout';
import { fontStyle, useBrandFonts } from '@/lib/brand/fonts';
import { useMeasure } from '@/lib/brand/measure';
import type { LogoSpec } from '@/lib/brand/spec';

const nativeFamily = Platform.OS === 'web' ? undefined : (f: { family: string; weight: number; italic: boolean }) => fontStyle(f.family, f.weight, f.italic).fontFamily as string | undefined;

/** One SVG, drawn the same way as the exported file: a DOM <svg> on the web, SvgXml on phones. */
function SvgBox({ layout, k, label, id, testID }: { layout: Layout; k: number; label: string; id: string; testID?: string }) {
  useBrandFonts(fontsIn(layout));
  const svg = useMemo(() => toSvg(layout, { id, scale: k, title: label, family: nativeFamily }), [layout, k, label, id]);
  const W = (layout.w + layout.pad * 2) * k, H = (layout.h + layout.pad * 2) * k;
  if (Platform.OS === 'web') {
    return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: W, height: H }}>{React.createElement('div', { style: { width: W, height: H, lineHeight: 0, display: 'block', direction: 'ltr' }, 'aria-hidden': true, dangerouslySetInnerHTML: { __html: svg } })}</View>;
  }
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: W, height: H }}><SvgXml xml={svg} width={W} height={H} /></View>;
}
const useSvgId = () => `lg${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

export interface LogoViewProps {
  spec: LogoSpec; mode?: 'light' | 'dark'; accent?: string; bg?: string; fg?: string;
  /** Natural size is 1:1 with `spec.size`; the logo only ever shrinks to fit these boxes (or grows with `scale`). */
  maxW?: number; maxH?: number; scale?: number; testID?: string;
}
export function LogoView({ spec, mode = 'light', accent = '#FBDD2D', bg, fg, maxW, maxH, scale = 1, testID }: LogoViewProps) {
  const measure = useMeasure();
  const id = useSvgId();
  const layout = useMemo(() => layoutLogo(spec, measure, ctxFor(mode, accent, bg, fg)), [spec, measure, mode, accent, bg, fg]);
  const W = layout.w + layout.pad * 2, H = layout.h + layout.pad * 2;
  const k = Math.max(0.05, Math.min(scale, maxW ? maxW / W : Infinity, maxH ? maxH / H : Infinity));
  return <SvgBox layout={layout} k={k} label={spec.name} id={id} testID={testID} />;
}

/** App icon / favicon artwork at `size` px (square). */
export function AppIconView({ spec, size, accent = '#FBDD2D', fullBleed, testID }: { spec: LogoSpec; size: number; accent?: string; fullBleed?: boolean; testID?: string }) {
  const measure = useMeasure();
  const id = useSvgId();
  const layout = useMemo(() => appIconLayout(spec, measure, ctxFor('light', accent), 512, fullBleed), [spec, measure, accent, fullBleed]);
  return <SvgBox layout={layout} k={size / 512} label={spec.name} id={id} testID={testID} />;
}
