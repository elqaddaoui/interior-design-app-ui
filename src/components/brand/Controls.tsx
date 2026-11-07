 
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { availableWeights, fontMeta } from '@/lib/brand/fontData';
import { fontStyle, useFontRevision } from '@/lib/brand/fonts';
import { needsJoined } from '@/lib/brand/script';
import { LIMITS, PRESETS, applyPreset, type Issue, type Line, type LogoSpec, type LogoType } from '@/lib/brand/spec';
import { ColorField } from './ColorField';
import { FontPicker, GlyphIcon, IconPicker } from './Pickers';
import { ImagePanel } from './ImagePanel';
import { LogoView } from './LogoView';
import { Advanced, Chips, Hint, Label, Panel, SliderRow, SwitchRow, Tile } from './ui';
import { iconPath } from '@/lib/brand/icons';

export type Up = (fn: (s: LogoSpec) => LogoSpec, key?: string) => void;
export interface Locks { font: boolean; color: boolean; layout: boolean }
interface Props { spec: LogoSpec; up: Up; issues: Issue[]; locks: Locks; setLocks: (l: Locks) => void; onSurprise: () => void; accent: string }

const msg = (t: (k: string, o?: any) => string, i?: Issue) => (i ? t(`br.issue.${i.key}`, i.params) : undefined);
const WEIGHT_NAMES: Record<number, string> = { 100: 'Thin', 200: 'XLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi', 700: 'Bold', 800: 'XBold', 900: 'Black', 1000: 'Ultra' };

function FontButton({ family, weight, italic, text, onPress, testID, label }: { family: string; weight: number; italic: boolean; text: string; onPress: () => void; testID: string; label: string }) {
  useFontRevision();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${family}`} onPress={onPress} className="flex-row items-center gap-2 rounded-xl border border-line bg-surface2 px-3 mb-3 active:opacity-80" style={{ height: 48 }}>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Txt className="text-[10px] text-muted font-semibold" numberOfLines={1}>{family}</Txt>
        <Txt numberOfLines={1} style={{ ...(fontStyle(family, weight, italic) as any), fontSize: 18, lineHeight: 24 }}>{text || 'Dwira'}</Txt>
      </View>
      <Icon name="chevron-down" size={18} tone="muted" />
    </Pressable>
  );
}

/** Style gallery: every preset drawn with the person's own name, plus Surprise me (with lock toggles). */
function Styles({ spec, up, locks, setLocks, onSurprise, accent }: Props) {
  const { t } = useT();
  const lock = (k: keyof Locks, icon: string) => (
    <Pressable key={k} testID={`lock-${k}`} accessibilityRole="switch" accessibilityState={{ checked: locks[k] }} accessibilityLabel={t(`br.lock.${k}`)} onPress={() => setLocks({ ...locks, [k]: !locks[k] })}
      className={`flex-row items-center gap-1 h-8 px-2.5 rounded-full border ${locks[k] ? 'border-primary bg-soft' : 'border-line bg-surface'}`}>
      <Icon name={locks[k] ? 'lock' : 'lock-open-variant-outline'} size={14} tone={locks[k] ? 'primary' : 'muted'} /><Txt className="text-[11px] font-bold">{t(`br.lock.${k}`)}</Txt>
    </Pressable>
  );
  return (
    <Panel id="styles" icon="shimmer" title={t('br.styles')} hint={t('br.stylesHint')}>
      <View className="flex-row flex-wrap items-center gap-2 mb-3">
        <Pressable testID="surprise" accessibilityRole="button" onPress={onSurprise} className="flex-row items-center gap-1.5 h-10 px-4 rounded-full bg-primary active:opacity-80"><Icon name="dice-multiple-outline" size={18} tone="onprimary" /><Txt className="font-extrabold text-onprimary text-[13px]">{t('br.surprise')}</Txt></Pressable>
        {lock('font', 'format-font')}{lock('color', 'palette')}{lock('layout', 'view-dashboard')}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {PRESETS.map((p) => {
          const s = applyPreset(spec, p);
          return (
            <Pressable key={p.id} testID={`preset-${p.id}`} accessibilityRole="button" accessibilityLabel={t(`br.preset.${p.id}`)} onPress={() => up(() => s)} className="rounded-xl border border-line bg-bg items-center justify-center active:opacity-80 overflow-hidden" style={{ flexBasis: '31%', flexGrow: 1, minWidth: 96, height: 76, paddingHorizontal: 4 }}>
              <LogoView spec={{ ...s, top: { ...s.top, on: false }, bottom: { ...s.bottom, on: false } }} mode="light" accent={accent} maxW={92} maxH={40} />
              <Txt className="text-[10px] text-muted font-bold mt-1" numberOfLines={1}>{t(`br.preset.${p.id}`)}</Txt>
            </Pressable>
          );
        })}
      </View>
    </Panel>
  );
}

function LineEditor({ which, spec, up, issues }: { which: 'top' | 'bottom'; spec: LogoSpec; up: Up; issues: Issue[] }) {
  const { t } = useT();
  const l = spec[which];
  const [fonts, setFonts] = useState(false);
  const set = (patch: Partial<Line>, key?: string) => up((s) => ({ ...s, [which]: { ...s[which], ...patch } }), key ?? `${which}-${Object.keys(patch)[0]}`);
  const err = issues.find((i) => i.path === `${which}.text`);
  const family = l.font || spec.font;
  return (
    <View className="mb-2">
      <SwitchRow testID={`line-${which}-on`} label={t(`br.line.${which}`)} value={l.on} onChange={(v) => set({ on: v, text: l.text })} />
      {l.on ? (
        <View>
          <Input testID={`line-${which}-text`} value={l.text} maxLength={LIMITS.line} placeholder={t('br.line.placeholder')} invalid={!!err} error={msg(t, err)} onChangeText={(v) => set({ text: v })} accessibilityLabel={t(`br.line.${which}`)} />
          <Label>{t('br.line.side')}</Label>
          <Chips small value={l.side} testID={`line-${which}-side`} onChange={(v) => set({ side: v })} options={(['top', 'bottom', 'left', 'right'] as const).map((k) => ({ key: k, label: t(`br.side.${k}`), icon: { top: 'arrow-up', bottom: 'arrow-down', left: 'arrow-left', right: 'arrow-right' }[k] }))} />
          <Label>{t('br.align')}</Label>
          <Chips small value={l.align} testID={`line-${which}-align`} onChange={(v) => set({ align: v })} options={(['start', 'center', 'end'] as const).map((k) => ({ key: k, label: t(`br.alignOpt.${k}`) }))} />
          <SliderRow label={t('br.line.size')} value={l.size} min={LIMITS.lineSize[0]} max={LIMITS.lineSize[1]} step={1} format={(v) => `${v}%`} onChange={(v) => set({ size: v })} testID={`line-${which}-size`} />
          <SliderRow label={t('br.line.gap')} value={l.gap} min={LIMITS.gap[0]} max={LIMITS.gap[1]} onChange={(v) => set({ gap: v })} format={(v) => `${v}px`} testID={`line-${which}-gap`} />
          <Advanced id={`line-${which}`}>
            <FontButton testID={`line-${which}-font`} label={t('br.font')} family={family} weight={l.weight} italic={l.italic} text={l.text} onPress={() => setFonts(true)} />
            <Chips small value={l.case} onChange={(v) => set({ case: v })} testID={`line-${which}-case`} options={(['none', 'upper', 'lower', 'title'] as const).map((k) => ({ key: k, label: t(`br.case.${k}`) }))} />
            <SliderRow label={t('br.tracking')} value={l.tracking} min={LIMITS.tracking[0]} max={LIMITS.tracking[1]} onChange={(v) => set({ tracking: v })} format={(v) => `${v}%`} />
            <ColorField testID={`line-${which}-color`} label={t('br.color')} value={l.color} onChange={(c) => set({ color: c })} auto autoLabel={t('br.autoMuted')} palette={false} />
          </Advanced>
          <FontPicker visible={fonts} onClose={() => setFonts(false)} value={family} text={l.text} title={t('br.font')} onPick={(f) => set({ font: f })} />
        </View>
      ) : null}
    </View>
  );
}

export function Controls(props: Props) {
  const { spec, up, issues } = props;
  const { t } = useT();
  const [fonts, setFonts] = useState(false);
  const [icons, setIcons] = useState(false);
  const set = (patch: Partial<LogoSpec>, key?: string) => up((s) => ({ ...s, ...patch }), key ?? Object.keys(patch)[0]);
  const issue = (path: string) => issues.find((i) => i.path === path);
  const types: { key: LogoType; label: string; icon?: string; visual?: React.ReactNode }[] = [
    { key: 'text', label: t('br.type.text'), visual: <Txt className="text-[20px] font-extrabold" style={{ lineHeight: 26 }}>Aa</Txt> },
    { key: 'iconText', label: t('br.type.iconText'), icon: 'shape-outline' },
    { key: 'monogram', label: t('br.type.monogram'), visual: <View className="w-6 h-6 rounded-lg bg-primary items-center justify-center"><Txt className="text-onprimary text-[12px] font-extrabold" style={{ lineHeight: 16 }}>D</Txt></View> },
    { key: 'image', label: t('br.type.image'), icon: 'image-outline' },
  ];
  const textual = spec.type !== 'image';
  const weights = availableWeights(spec.font);
  const joined = needsJoined(spec.name);
  const hasItalic = !!fontMeta(spec.font)?.italic;
  const nameErr = issue('name');
  const fontWarn = issue('font');
  return (
    <View>
      <Styles {...props} />

      <Panel id="logo" icon="vector-square" title={t('br.logo')} hint={spec.name}>
        <Label>{t('br.logoType')}</Label>
        <View className="flex-row flex-wrap gap-2 mb-3" accessibilityRole="radiogroup">
          {types.map((x) => <Tile key={x.key} testID={`type-${x.key}`} on={spec.type === x.key} label={x.label} icon={x.icon} visual={x.visual} onPress={() => set({ type: x.key }, 'type')} />)}
        </View>
        <Input testID="brand-name" label={t('br.name')} value={spec.name} maxLength={LIMITS.name} invalid={!!nameErr} error={msg(t, nameErr)} onChangeText={(v) => set({ name: v })} accessibilityLabel={t('br.name')} />
        {spec.type === 'iconText' ? (
          <View>
            <Label>{t('br.icon')}</Label>
            <Pressable testID="icon-open" accessibilityRole="button" accessibilityLabel={t('br.icon')} onPress={() => setIcons(true)} className="flex-row items-center gap-3 rounded-xl border border-line bg-surface2 px-3 mb-3 active:opacity-80" style={{ height: 52 }}>
              <GlyphIcon d={iconPath(spec.icon.name)} size={28} />
              <Txt className="flex-1 font-semibold" numberOfLines={1}>{spec.icon.name.replace(/-/g, ' ')}</Txt><Icon name="chevron-down" size={18} tone="muted" />
            </Pressable>
            <Label>{t('br.iconPos')}</Label>
            <Chips small value={spec.icon.pos} testID="icon-pos" onChange={(v) => up((s) => ({ ...s, icon: { ...s.icon, pos: v } }), 'icon-pos')} options={(['start', 'end', 'top', 'bottom'] as const).map((k) => ({ key: k, label: t(`br.iconPosOpt.${k}`) }))} />
            <SliderRow label={t('br.iconScale')} value={spec.icon.scale} min={LIMITS.iconScale[0]} max={LIMITS.iconScale[1]} step={5} format={(v) => `${v}%`} onChange={(v) => up((s) => ({ ...s, icon: { ...s.icon, scale: v } }), 'icon-scale')} testID="icon-scale" />
            <SliderRow label={t('br.gap')} value={spec.icon.gap} min={LIMITS.gap[0]} max={LIMITS.gap[1]} format={(v) => `${v}px`} onChange={(v) => up((s) => ({ ...s, icon: { ...s.icon, gap: v } }), 'icon-gap')} />
            <ColorField testID="icon-color" label={t('br.iconColor')} value={spec.icon.color} onChange={(c) => up((s) => ({ ...s, icon: { ...s.icon, color: c } }), 'icon-color')} auto autoLabel={t('br.sameAsText')} palette={false} />
            <IconPicker visible={icons} onClose={() => setIcons(false)} value={spec.icon.name} title={t('br.icon')} onPick={(n) => up((s) => ({ ...s, icon: { ...s.icon, name: n } }), 'icon-name')} />
          </View>
        ) : null}
        {spec.type === 'monogram' ? (
          <View>
            <Input testID="mono-text" label={t('br.monoText')} value={spec.mono.text} maxLength={3} placeholder={t('br.monoAuto')} onChangeText={(v) => up((s) => ({ ...s, mono: { ...s.mono, text: v } }), 'mono-text')} />
            <Label>{t('br.shape')}</Label>
            <Chips small value={spec.mono.shape} testID="mono-shape" onChange={(v) => up((s) => ({ ...s, mono: { ...s.mono, shape: v } }), 'mono-shape')} options={(['squircle', 'circle', 'square', 'none'] as const).map((k) => ({ key: k, label: t(`br.shapeOpt.${k}`) }))} />
            <SwitchRow testID="mono-name" label={t('br.monoWithName')} value={spec.mono.withName} onChange={(v) => up((s) => ({ ...s, mono: { ...s.mono, withName: v } }), 'mono-name')} />
            <SliderRow label={t('br.monoScale')} value={spec.mono.scale} min={100} max={260} step={5} format={(v) => `${v}%`} onChange={(v) => up((s) => ({ ...s, mono: { ...s.mono, scale: v } }), 'mono-scale')} />
            <Advanced id="mono">
              <ColorField testID="mono-bg" label={t('br.monoBg')} value={spec.mono.bg} onChange={(c) => up((s) => ({ ...s, mono: { ...s.mono, bg: c } }), 'mono-bg')} auto autoLabel={t('br.sameAsText')} palette={false} />
              <ColorField testID="mono-fg" label={t('br.monoFg')} value={spec.mono.fg} onChange={(c) => up((s) => ({ ...s, mono: { ...s.mono, fg: c } }), 'mono-fg')} auto autoLabel={t('br.autoReadable')} palette={false} />
            </Advanced>
          </View>
        ) : null}
        {spec.type === 'image' ? <View><ImagePanel spec={spec} up={up} />
          {issue('image.light') ? <Hint tone="danger">{msg(t, issue('image.light'))}</Hint> : null}
          {issue('image.dark') ? <Hint>{msg(t, issue('image.dark'))}</Hint> : null}
          <SliderRow label={t('br.imageHeight')} value={spec.image.height} min={LIMITS.imageH[0]} max={LIMITS.imageH[1]} format={(v) => `${v}px`} onChange={(v) => up((s) => ({ ...s, image: { ...s.image, height: v } }), 'image-h')} testID="image-height" />
        </View> : null}
      </Panel>

      <Panel id="lines" icon="format-text-variant-outline" title={t('br.lines')} hint={t('br.linesHint')} open={false}>
        <LineEditor which="top" {...{ spec, up, issues }} />
        <LineEditor which="bottom" {...{ spec, up, issues }} />
      </Panel>

      {textual ? (
        <Panel id="type" icon="format-font" title={t('br.typography')} hint={`${spec.font} · ${spec.weight}`}>
          <Label>{t('br.font')}</Label>
          <FontButton testID="brand-font" label={t('br.font')} family={spec.font} weight={spec.weight} italic={spec.italic} text={spec.name} onPress={() => setFonts(true)} />
          {fontWarn ? <Hint tone="danger">{msg(t, fontWarn)}</Hint> : null}
          <Label>{t('br.weight')}</Label>
          <Chips small value={spec.weight} testID="brand-weight" onChange={(v) => set({ weight: v }, 'weight')} options={weights.map((w) => ({ key: w, label: `${w} ${WEIGHT_NAMES[w] ?? ''}`.trim() }))} />
          <SliderRow label={t('br.size')} value={spec.size} min={LIMITS.size[0]} max={LIMITS.size[1]} format={(v) => `${v}px`} onChange={(v) => set({ size: v }, 'size')} testID="brand-size" />
          <SliderRow label={t('br.tracking')} value={joined ? 0 : spec.tracking} min={LIMITS.tracking[0]} max={LIMITS.tracking[1]} format={(v) => `${v}%`} onChange={(v) => set({ tracking: v }, 'tracking')} testID="brand-tracking" />
          {joined ? <Hint>{t('br.joinedHint')}</Hint> : null}
          <Label>{t('br.caseLabel')}</Label>
          <Chips small value={spec.case} testID="brand-case" onChange={(v) => set({ case: v })} options={(['none', 'upper', 'lower', 'title'] as const).map((k) => ({ key: k, label: t(`br.case.${k}`) }))} />
          <SwitchRow testID="sw-italic" label={t('br.italic')} hint={hasItalic ? undefined : t('br.italicSynthetic')} value={spec.italic} onChange={(v) => set({ italic: v })} />
          <Advanced id="type">
            <Label>{t('br.decor')}</Label>
            <Chips small value={spec.decor} testID="brand-decor" onChange={(v) => set({ decor: v })} options={(['none', 'underline', 'badge'] as const).map((k) => ({ key: k, label: t(`br.decorOpt.${k}`) }))} />
            <SwitchRow testID="sw-shadow" label={t('br.shadow')} value={spec.shadow.on} onChange={(v) => up((s) => ({ ...s, shadow: { ...s.shadow, on: v } }), 'shadow-on')} />
            {spec.shadow.on ? (
              <View className="mb-2">
                <ColorField testID="shadow-color" label={t('br.shadowColor')} value={spec.shadow.color} onChange={(c) => up((s) => ({ ...s, shadow: { ...s.shadow, color: c || s.shadow.color } }), 'shadow-color')} palette={false} />
                <SliderRow label={t('br.blur')} value={spec.shadow.blur} min={0} max={40} onChange={(v) => up((s) => ({ ...s, shadow: { ...s.shadow, blur: v } }), 'shadow-blur')} />
                <SliderRow label={t('br.opacity')} value={Math.round(spec.shadow.opacity * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => up((s) => ({ ...s, shadow: { ...s.shadow, opacity: v / 100 } }), 'shadow-op')} />
                <SliderRow label={t('br.offsetX')} value={spec.shadow.x} min={-24} max={24} onChange={(v) => up((s) => ({ ...s, shadow: { ...s.shadow, x: v } }), 'shadow-x')} />
                <SliderRow label={t('br.offsetY')} value={spec.shadow.y} min={-24} max={24} onChange={(v) => up((s) => ({ ...s, shadow: { ...s.shadow, y: v } }), 'shadow-y')} />
              </View>
            ) : null}
            <SwitchRow testID="sw-outline" label={t('br.outline')} value={spec.outline.on} onChange={(v) => up((s) => ({ ...s, outline: { ...s.outline, on: v } }), 'outline-on')} />
            {spec.outline.on ? (
              <View className="mb-2">
                <ColorField testID="outline-color" label={t('br.outlineColor')} value={spec.outline.color} onChange={(c) => up((s) => ({ ...s, outline: { ...s.outline, color: c || s.outline.color } }), 'outline-color')} palette={false} />
                <SliderRow label={t('br.outlineWidth')} value={spec.outline.width} min={0.5} max={8} step={0.5} format={(v) => `${v}px`} onChange={(v) => up((s) => ({ ...s, outline: { ...s.outline, width: v } }), 'outline-w')} />
              </View>
            ) : null}
          </Advanced>
          <FontPicker visible={fonts} onClose={() => setFonts(false)} value={spec.font} text={spec.name} title={t('br.font')} onPick={(f) => up((s) => ({ ...s, font: f, weight: availableWeights(f).includes(s.weight) ? s.weight : availableWeights(f).reduce((b, w) => (Math.abs(w - s.weight) < Math.abs(b - s.weight) ? w : b)) }), 'font')} />
        </Panel>
      ) : null}

      {textual ? (
        <Panel id="color" icon="palette-outline" title={t('br.colors')} hint={spec.fill.color || t('br.auto')}>
          <ColorField testID="brand-color" label={spec.fill.mode === 'gradient' ? t('br.gradientFrom') : t('br.color')} value={spec.fill.color} onChange={(c) => up((s) => ({ ...s, fill: { ...s.fill, color: c } }), 'fill-color')} auto autoLabel={t('br.autoFollows')} contrast
            base={spec.palette.base} harmony={spec.palette.harmony} onBase={(base, harmony) => up((s) => ({ ...s, palette: { base, harmony } }), 'palette')} />
          <SwitchRow testID="sw-autocontrast" label={t('br.autoContrast')} hint={t('br.autoContrastHint')} value={spec.autoContrast} onChange={(v) => set({ autoContrast: v })} />
          {issues.filter((i) => i.path === 'fill.color').map((i) => <Hint key={i.key} tone="danger">{msg(t, i)}</Hint>)}
          <Advanced id="gradient" label={t('br.gradient')}>
            <SwitchRow testID="sw-gradient" label={t('br.useGradient')} value={spec.fill.mode === 'gradient'} onChange={(v) => up((s) => ({ ...s, fill: { ...s.fill, mode: v ? 'gradient' : 'solid', color: v && !s.fill.color ? '#F97316' : s.fill.color } }), 'fill-mode')} />
            {spec.fill.mode === 'gradient' ? (
              <View>
                <ColorField testID="gradient-to" label={t('br.gradientTo')} value={spec.fill.color2} onChange={(c) => up((s) => ({ ...s, fill: { ...s.fill, color2: c || s.fill.color2 } }), 'fill-color2')} palette={false} contrast />
                <SliderRow label={t('br.angle')} value={spec.fill.angle} min={0} max={360} step={15} format={(v) => `${v}°`} onChange={(v) => up((s) => ({ ...s, fill: { ...s.fill, angle: v } }), 'fill-angle')} />
              </View>
            ) : null}
          </Advanced>
        </Panel>
      ) : null}

      <Panel id="layout" icon="view-dashboard-outline" title={t('br.layout')} hint={t(`br.headerAlign.${spec.align}`)} open={false}>
        <Label>{t('br.headerPos')}</Label>
        <Chips small wrap={false} value={spec.align} testID="brand-align" onChange={(v) => set({ align: v })} options={(['left', 'center', 'right'] as const).map((k) => ({ key: k, label: t(`br.headerAlign.${k}`), icon: ({ left: 'format-align-left', center: 'format-align-center', right: 'format-align-right' } as const)[k] }))} />
        <Label>{t('br.direction')}</Label>
        <Chips small value={spec.dir} testID="brand-dir" onChange={(v) => set({ dir: v })} options={(['auto', 'ltr', 'rtl'] as const).map((k) => ({ key: k, label: t(`br.dirOpt.${k}`) }))} />
        <Hint>{t('br.directionHint')}</Hint>
      </Panel>

      <Panel id="app" icon="cellphone" title={t('br.appIcon')} hint={t('br.appIconHint')} open={false}>
        <Label>{t('br.appSource')}</Label>
        <Chips small value={spec.app.source} testID="app-source" onChange={(v) => up((s) => ({ ...s, app: { ...s.app, source: v } }), 'app-source')} options={(['auto', 'icon', 'monogram', 'initial', 'image'] as const).map((k) => ({ key: k, label: t(`br.appSourceOpt.${k}`) }))} />
        <Label>{t('br.shape')}</Label>
        <Chips small value={spec.app.shape} testID="app-shape" onChange={(v) => up((s) => ({ ...s, app: { ...s.app, shape: v } }), 'app-shape')} options={(['squircle', 'circle', 'square'] as const).map((k) => ({ key: k, label: t(`br.shapeOpt.${k}`) }))} />
        <ColorField testID="app-bg" label={t('br.appBg')} value={spec.app.bg} onChange={(c) => up((s) => ({ ...s, app: { ...s.app, bg: c } }), 'app-bg')} auto autoLabel={t('br.autoBrand')} palette={false} />
        <ColorField testID="app-fg" label={t('br.appFg')} value={spec.app.fg} onChange={(c) => up((s) => ({ ...s, app: { ...s.app, fg: c } }), 'app-fg')} auto autoLabel={t('br.autoReadable')} palette={false} />
        <View className="flex-row items-center gap-3 bg-surface2 rounded-xl p-3"><Icon name="information-outline" size={16} tone="muted" /><Txt className="flex-1 text-[11px] text-muted">{t('br.faviconAuto')}</Txt></View>
      </Panel>
    </View>
  );
}
