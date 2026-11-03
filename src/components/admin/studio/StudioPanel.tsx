import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { ColorPicker } from '@/components/admin/ColorPicker';
import { Shape } from '@/components/toolcard/PieceShape';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { FX, FX_FADE, TIERS, TIER_ORDER } from '@/lib/toolCardFx';
import {
  DEFAULT_STUDIO, EASE_ID, EASE_KEYS, LIBRARY, LIB_CATS, PIECE_MOTIONS, PIECE_SHAPES, PRESETS, cloneStudio, exportStudio, gradPoints, importStudio, mergeStudio, randomStudio, studioKey,
  type EaseKey, type LibCat, type Paint, type StudioStyle,
} from '@/lib/fxStudio';
import type { SavedPreset } from '@/data/types';
import { toast } from '@/store/useToast';
import { CurvePreview } from './CurvePreview';
import { Chips, Group, Line, Sld, Sw } from './ui';

export type StudioTab = 'main' | 'motion' | 'bar' | 'els' | 'color' | 'looks';
export const TABS: { key: StudioTab; icon: string }[] = [
  { key: 'main', icon: 'swap-horizontal' }, { key: 'motion', icon: 'chart-bell-curve' }, { key: 'bar', icon: 'format-line-weight' },
  { key: 'els', icon: 'shape-outline' }, { key: 'color', icon: 'palette-outline' }, { key: 'looks', icon: 'creation' },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const FX_EASE: Record<string, number> = { inOut: 0, back: 1, expo: 2, elastic: 3, bounce: 4, snap: 5 };

/** Colour + optional "auto" choice (empty string = auto). */
function OptColor({ label, autoLabel, value, onChange, fallback }: { label: string; autoLabel: string; value: string; onChange: (v: string) => void; fallback: string }) {
  const { t } = useT();
  return (
    <Line label={label}>
      <Chips value={value ? 'custom' : 'auto'} options={[{ key: 'auto', label: autoLabel }, { key: 'custom', label: t('st.paintV.custom') }]} onChange={(k) => onChange(k === 'auto' ? '' : value || fallback)} />
      {value ? <ColorPicker compact value={value} onChange={onChange} /> : null}
    </Line>
  );
}

/** White / accent / one colour / gradient, with the colours, the angle and a live strip. */
function PaintEditor({ paint, onChange, accent }: { paint: Paint; onChange: (p: Paint) => void; accent: string }) {
  const { t } = useT();
  const g = gradPoints(paint.ang);
  const strip = paint.kind === 'gradient' ? [paint.c1, paint.c2] : paint.kind === 'custom' ? [paint.c1, paint.c1] : paint.kind === 'accent' ? [accent, accent] : ['#FFFFFF', '#FFFFFF'];
  return (
    <View style={{ gap: 8 }}>
      <Line label={t('st.paint')}>
        <Chips testID="st-paint" value={paint.kind} options={(['white', 'accent', 'custom', 'gradient'] as const).map((k) => ({ key: k, label: t(`st.paintV.${k}`) }))} onChange={(kind) => onChange({ ...paint, kind })} />
      </Line>
      <LinearGradient colors={strip as unknown as readonly [string, string]} start={g.start} end={g.end} style={{ height: 14, borderRadius: 7, borderWidth: 1, borderColor: '#8884' }} />
      {paint.kind === 'custom' || paint.kind === 'gradient' ? <ColorPicker compact label={t('st.color1')} value={paint.c1} onChange={(c1) => onChange({ ...paint, c1 })} /> : null}
      {paint.kind === 'gradient' ? <>
        <ColorPicker compact label={t('st.color2')} value={paint.c2} onChange={(c2) => onChange({ ...paint, c2 })} />
        <Sld label={t('st.gradAngle')} value={paint.ang} min={0} max={360} step={5} fmt={(v) => `${v}°`} onChange={(ang) => onChange({ ...paint, ang })} />
      </> : null}
    </View>
  );
}

/** The whole control panel: one tab at a time, every control writes straight into the style (`onChange`), so the stage reacts at once. */
export function StudioPanel({ tab, style, onChange, onReplace, effect, onEffect, accent, history, onUndo, onRedo, saved, onSave, onDeleteSaved }: {
  tab: StudioTab; style: StudioStyle; effect: number;
  /** A partial style merged into the current one (groups merge key by key). */
  onChange: (patch: Record<string, unknown>) => void;
  /** A whole new style (preset, surprise, reset, import). */
  onReplace: (s: StudioStyle) => void;
  onEffect: (id: number) => void; accent: string;
  history: { canUndo: boolean; canRedo: boolean }; onUndo: () => void; onRedo: () => void;
  /** The admin's own saved looks (newest first), saving the current look under a name, deleting one. */
  saved: SavedPreset[]; onSave: (name: string) => void; onDeleteSaved: (id: string) => void;
}) {
  const { t } = useT();
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [pal, setPal] = useState(0);
  const [cat, setCat] = useState<LibCat>('minimal');
  const [name, setName] = useState('');
  const m = style.motion, b = style.bar, e = style.els, ti = style.tint;
  const def = FX[effect] ?? FX[FX_FADE];

  const fxChip = (id: number) => ({ key: id, label: `${id} · ${t(`tc.fx.${id}`)}` });

  if (tab === 'main') return (
    <View>
      <Group title={t('st.previewFx')} note={t('st.sameAllNote')}>
        <Sw testID="st-force" label={t('st.sameAll')} value={style.force > 0} onChange={(on) => onChange({ force: on ? effect : 0 })} />
        <Chips testID="st-fx" value={effect} options={[fxChip(FX_FADE)]} onChange={(id) => { onEffect(id); if (style.force > 0) onChange({ force: id }); }} />
        {TIER_ORDER.map((tier) => (
          <View key={tier} style={{ gap: 6 }}>
            <Txt className="text-muted text-[12px] font-bold">{t(`tc.tier.${tier}`)}</Txt>
            <Chips testID={`st-fx-${tier}`} value={effect} options={TIERS[tier].map(fxChip)} onChange={(id) => { onEffect(id); if (style.force > 0) onChange({ force: id }); }} />
          </View>
        ))}
      </Group>
      <Group title={t('st.accent')}>
        <OptColor label={t('st.accent')} autoLabel={t('st.accentAuto')} value={style.accent} fallback="#FBDD2D" onChange={(accent) => onChange({ accent })} />
        <Sld testID="st-seed" label={t('st.seed')} value={style.seed} min={1} max={200} step={1} onChange={(seed) => onChange({ seed })} />
        <Pressable testID="st-seed-dice" accessibilityRole="button" accessibilityLabel={t('st.surprise')} onPress={() => onChange({ seed: 1 + Math.floor(Math.random() * 9000) })} className="self-start flex-row items-center gap-2 px-3 h-9 rounded-full bg-surface2"><Icon name="dice-multiple-outline" size={18} /><Txt className="text-[13px] font-bold">{t('st.seed')}</Txt></Pressable>
        <Txt className="text-muted text-[12px]">{t('st.seedNote')} {t('st.speedNote')}</Txt>
      </Group>
    </View>
  );

  if (tab === 'motion') {
    const kind = style.ease === 'auto' ? FX_EASE[def.ease] ?? 0 : EASE_ID[style.ease];
    const ep = style.ease === 'bezier' ? style.bz : style.ease === 'spring' ? style.sp : style.ease === 'steps' ? [style.steps] : [0, 0, 0, 0];
    return (
      <View>
        <Group title={t('st.easing')}>
          <Chips testID="st-ease" value={style.ease} options={EASE_KEYS.map((k: EaseKey) => ({ key: k, label: t(`st.ease.${k}`) }))} onChange={(k) => onChange({ ease: k })} />
          <CurvePreview kind={kind} ep={ep} />
          {style.ease === 'bezier' ? <>
            {(['x1', 'y1', 'x2', 'y2'] as const).map((n, i) => (
              <Sld key={n} testID={`st-bz-${n}`} label={n} value={style.bz[i]} min={i % 2 ? -1 : 0} max={i % 2 ? 2 : 1} step={0.01} onChange={(v) => onChange({ bz: style.bz.map((x, j) => (j === i ? v : x)) })} />
            ))}
          </> : null}
          {style.ease === 'spring' ? <>
            <Sld testID="st-sp-wobbles" label={t('st.wobbles')} value={style.sp[0]} min={1} max={6} step={1} onChange={(v) => onChange({ sp: [v, style.sp[1]] })} />
            <Sld testID="st-sp-damping" label={t('st.damping')} value={style.sp[1]} min={1.5} max={8} step={0.1} onChange={(v) => onChange({ sp: [style.sp[0], v] })} />
          </> : null}
          {style.ease === 'steps' ? <Sld testID="st-steps" label={t('st.stepsN')} value={style.steps} min={2} max={16} step={1} onChange={(steps) => onChange({ steps })} /> : null}
        </Group>
        <Group title={t('st.direction')}>
          <Chips testID="st-dir" value={m.dir} options={(['auto', 'fixed', 'alternate', 'random'] as const).map((k) => ({ key: k, label: t(`st.dir.${k}`) }))} onChange={(dir) => onChange({ motion: { dir } })} />
          {m.dir === 'fixed' ? <Sld testID="st-angle" label={t('st.angle')} value={m.angle} min={-180} max={180} step={5} fmt={(v) => `${v}°`} onChange={(angle) => onChange({ motion: { angle } })} /> : null}
          <Sw testID="st-sweep-on" label={t('st.sweep')} value={m.sweep !== null} onChange={(on) => onChange({ motion: { sweep: on ? 20 : null } })} />
          {m.sweep !== null ? <Sld testID="st-sweep" label={t('st.sweep')} value={m.sweep} min={-120} max={120} step={5} fmt={(v) => `${v}°`} onChange={(sweep) => onChange({ motion: { sweep } })} /> : <Txt className="text-muted text-[12px] -mt-2">{t('st.sweepAuto')}</Txt>}
          <Sw testID="st-origin" label={t('st.origin')} value={m.origin} onChange={(origin) => onChange({ motion: { origin } })} />
          {m.origin ? <>
            <Sld testID="st-ox" label={t('st.originX')} value={m.ox} min={0} max={1} step={0.05} fmt={pct} onChange={(ox) => onChange({ motion: { ox } })} />
            <Sld testID="st-oy" label={t('st.originY')} value={m.oy} min={0} max={1} step={0.05} fmt={pct} onChange={(oy) => onChange({ motion: { oy } })} />
          </> : null}
        </Group>
        <Group title={t('st.photo')}>
          <Sld testID="st-zin" label={t('st.zoomIn')} value={m.zoomIn} min={0} max={0.6} step={0.01} fmt={pct} onChange={(zoomIn) => onChange({ motion: { zoomIn } })} />
          <Sld testID="st-zout" label={t('st.zoomOut')} value={m.zoomOut} min={0} max={0.6} step={0.01} fmt={pct} onChange={(zoomOut) => onChange({ motion: { zoomOut } })} />
          <Sld testID="st-push" label={t('st.push')} value={m.push} min={0} max={1} step={0.05} fmt={pct} onChange={(push) => onChange({ motion: { push } })} />
        </Group>
      </View>
    );
  }

  if (tab === 'bar') return (
    <View>
      <Group title={t('st.barMode')}>
        <Chips testID="st-bar-mode" value={b.mode} options={(['effect', 'custom', 'off'] as const).map((k) => ({ key: k, label: t(`st.mode.${k}`) }))} onChange={(mode) => onChange({ bar: { mode } })} />
      </Group>
      {b.mode === 'custom' ? <>
        <Group>
          <Sld testID="st-bar-size" label={t('st.size')} value={b.size} min={1} max={40} step={1} fmt={(v) => `${v}px`} onChange={(size) => onChange({ bar: { size } })} />
          <Line label={t('st.look')}>
            <Chips testID="st-bar-look" value={b.look} options={(['solid', 'double', 'dashed', 'dotted'] as const).map((k) => ({ key: k, label: t(`st.lookV.${k}`) }))} onChange={(look) => onChange({ bar: { look } })} />
          </Line>
          <Sw testID="st-bar-round" label={t('st.round')} value={b.round} onChange={(round) => onChange({ bar: { round } })} />
          <Sw testID="st-bar-fade" label={t('st.fade')} value={b.fade} onChange={(fade) => onChange({ bar: { fade } })} />
        </Group>
        <Group>
          <PaintEditor paint={b.paint} accent={accent} onChange={(paint) => onChange({ bar: { paint } })} />
          <Sld testID="st-bar-opacity" label={t('st.opacity')} value={b.opacity} min={0.1} max={1} step={0.05} fmt={pct} onChange={(opacity) => onChange({ bar: { opacity } })} />
        </Group>
        <Group>
          <Sld testID="st-bar-glow" label={t('st.glow')} value={b.glow} min={0} max={60} step={1} fmt={(v) => `${v}px`} onChange={(glow) => onChange({ bar: { glow } })} />
          <Sld testID="st-bar-trail" label={t('st.trail')} value={b.trail} min={0} max={240} step={2} fmt={(v) => `${v}px`} onChange={(trail) => onChange({ bar: { trail } })} />
          {b.trail > 0 ? <OptColor label={t('st.trailColor')} autoLabel={t('st.trailAuto')} value={b.trailColor} fallback="#7C3AED" onChange={(trailColor) => onChange({ bar: { trailColor } })} /> : null}
        </Group>
      </> : null}
    </View>
  );

  if (tab === 'els') {
    const palette = e.palette;
    const sel = Math.min(pal, palette.length - 1);
    return (
      <View>
        <Group title={t('st.elsMode')}>
          <Chips testID="st-els-mode" value={e.mode} options={(['effect', 'custom', 'off'] as const).map((k) => ({ key: k, label: t(`st.mode.${k}`) }))} onChange={(mode) => onChange({ els: { mode } })} />
        </Group>
        {e.mode === 'custom' ? <>
          <Group title={t('st.shape')}>
            <Chips testID="st-shape" value={e.shape} options={PIECE_SHAPES.map((k) => ({ key: k, label: t(`st.shapeV.${k}`), node: k === 'mixed' ? <Txt className="text-[13px] font-bold">{t('st.shapeV.mixed')}</Txt> : <Shape shape={k} size={16} color={colors.fg} /> }))} onChange={(shape) => onChange({ els: { shape } })} />
            <Sld testID="st-els-count" label={t('st.count')} value={e.count} min={1} max={24} step={1} onChange={(count) => onChange({ els: { count } })} />
            <Sld testID="st-els-size" label={t('st.pieceSize')} value={e.size} min={6} max={56} step={1} fmt={(v) => `${v}px`} onChange={(size) => onChange({ els: { size } })} />
            <Sld testID="st-els-sizevar" label={t('st.sizeVar')} value={e.sizeVar} min={0} max={1} step={0.05} fmt={pct} onChange={(sizeVar) => onChange({ els: { sizeVar } })} />
          </Group>
          <Group title={t('st.motion')}>
            <Chips testID="st-els-motion" value={e.motion} options={PIECE_MOTIONS.map((k) => ({ key: k, label: t(`st.motionV.${k}`) }))} onChange={(motion) => onChange({ els: { motion } })} />
            {e.motion === 'follow' ? <>
              <Line label={t('st.path')}>
                <Chips testID="st-els-path" value={e.path} options={(['auto', 'tail', 'beads', 'scan', 'wave', 'orbit', 'rim', 'burst', 'corners', 'far'] as const).map((k) => ({ key: k, label: t(`st.pathV.${k}`) }))} onChange={(path) => onChange({ els: { path } })} />
              </Line>
              <Sld testID="st-els-spread" label={t('st.spread')} value={e.spread} min={0.4} max={2} step={0.05} onChange={(spread) => onChange({ els: { spread } })} />
            </> : null}
            <Sld testID="st-els-spin" label={t('st.spin')} value={e.spin} min={-3} max={3} step={0.25} onChange={(spin) => onChange({ els: { spin } })} />
            <Sld testID="st-els-stagger" label={t('st.stagger')} value={e.stagger} min={0} max={1} step={0.05} fmt={pct} onChange={(stagger) => onChange({ els: { stagger } })} />
            <Sld testID="st-els-pulse" label={t('st.pulse')} value={e.pulse} min={0} max={1} step={0.05} fmt={pct} onChange={(pulse) => onChange({ els: { pulse } })} />
          </Group>
          <Group title={t('st.colors')}>
            <Chips testID="st-els-colors" value={e.colors} options={(['white', 'accent', 'mix', 'palette'] as const).map((k) => ({ key: k, label: t(`st.colorsV.${k}`) }))} onChange={(colors2) => onChange({ els: { colors: colors2 } })} />
            {e.colors === 'palette' ? (
              <View style={{ gap: 8 }}>
                <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
                  {palette.map((c, i) => (
                    <Pressable key={`${c}${i}`} testID={`st-pal-${i}`} accessibilityRole="button" accessibilityLabel={c} onPress={() => setPal(i)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c, borderWidth: i === sel ? 3 : 1, borderColor: i === sel ? colors.fg : colors.line }} />
                  ))}
                  {palette.length < 6 ? <Button testID="st-pal-add" size="sm" variant="soft" title={t('st.addColor')} onPress={() => { onChange({ els: { palette: [...palette, '#FFFFFF'] } }); setPal(palette.length); }} /> : null}
                  {palette.length > 1 ? <Button testID="st-pal-del" size="sm" variant="soft" title={t('st.removeColor')} onPress={() => { onChange({ els: { palette: palette.filter((_, i) => i !== sel) } }); setPal(0); }} /> : null}
                </View>
                <ColorPicker compact value={palette[sel] ?? '#FFFFFF'} onChange={(c) => onChange({ els: { palette: palette.map((x, i) => (i === sel ? c : x)) } })} />
              </View>
            ) : null}
            <Sld testID="st-els-opacity" label={t('st.opacity')} value={e.opacity} min={0.1} max={1} step={0.05} fmt={pct} onChange={(opacity) => onChange({ els: { opacity } })} />
            <Sld testID="st-els-glow" label={t('st.glow')} value={e.glow} min={0} max={30} step={1} fmt={(v) => `${v}px`} onChange={(glow) => onChange({ els: { glow } })} />
          </Group>
        </> : null}
      </View>
    );
  }

  if (tab === 'color') return (
    <View>
      <Group title={t('st.tintOn')}>
        <Sw testID="st-tint-on" label={t('st.tintOn')} value={ti.on} onChange={(on) => onChange({ tint: { on } })} />
        {ti.on ? <>
          <Chips testID="st-tint-kind" value={ti.kind} options={(['solid', 'gradient'] as const).map((k) => ({ key: k, label: t(`st.tintKindV.${k}`) }))} onChange={(kind) => onChange({ tint: { kind } })} />
          <ColorPicker compact label={t('st.color1')} value={ti.c1} onChange={(c1) => onChange({ tint: { c1 } })} />
          {ti.kind === 'gradient' ? <>
            <ColorPicker compact label={t('st.color2')} value={ti.c2} onChange={(c2) => onChange({ tint: { c2 } })} />
            <OptColor label={t('st.color3')} autoLabel={t('st.color3Off')} value={ti.c3} fallback="#FFFFFF" onChange={(c3) => onChange({ tint: { c3 } })} />
            <Sld testID="st-tint-ang" label={t('st.gradAngle')} value={ti.ang} min={0} max={360} step={5} fmt={(v) => `${v}°`} onChange={(ang) => onChange({ tint: { ang } })} />
          </> : null}
          <Sld testID="st-tint-amount" label={t('st.amount')} value={ti.amount} min={0.05} max={0.9} step={0.05} fmt={pct} onChange={(amount) => onChange({ tint: { amount } })} />
          <Line label={t('st.peak')}>
            <Chips testID="st-tint-peak" value={ti.peak} options={(['start', 'mid', 'end'] as const).map((k) => ({ key: k, label: t(`st.peakV.${k}`) }))} onChange={(peak) => onChange({ tint: { peak } })} />
          </Line>
        </> : null}
      </Group>
    </View>
  );

  // looks
  const cur = studioKey(style);
  const applyLook = (fx: number, st: StudioStyle) => { onReplace({ ...cloneStudio(st), force: fx }); if (fx > 0) onEffect(fx); };
  const tile = (key: string, icon: string, label: string, on: boolean, press: () => void, extra?: React.ReactNode) => (
    <Pressable key={key} testID={key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={press}
      className={`items-center justify-center rounded-2xl border ${on ? 'bg-soft border-primary' : 'bg-surface2 border-line'}`} style={{ width: 92, height: 76, gap: 4 }}>
      <Icon name={icon} size={24} tone={on ? 'primary' : 'fg'} />
      <Txt className="text-[12px] font-bold" numberOfLines={1}>{label}</Txt>
      {extra}
    </Pressable>
  );
  const inCat = LIBRARY.filter((p) => p.cat === cat);
  return (
    <View>
      <Group title={t('st.library')} note={t('st.libraryNote')}>
        <View testID="st-lib-cats" accessibilityRole="tablist" className="flex-row flex-wrap" style={{ gap: 6 }}>
          {LIB_CATS.map((c) => {
            const on = c.key === cat;
            return (
              <Pressable key={c.key} testID={`st-cat-${c.key}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setCat(c.key)}
                className={`flex-row items-center h-9 px-3 rounded-full border ${on ? 'bg-ink border-ink' : 'bg-surface2 border-line'}`} style={{ gap: 6 }}>
                <Icon name={c.icon} size={16} tone={on ? 'onink' : 'fg'} />
                <Txt className={`text-[12.5px] font-bold ${on ? 'text-onink' : ''}`}>{t(`st.cat.${c.key}`)}</Txt>
              </Pressable>
            );
          })}
        </View>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {inCat.map((p) => tile(`st-lib-${p.id}`, p.icon, t(`st.lib.${p.id}`), cur !== '' && cur === studioKey(mergeStudio(p.style, { force: p.fx })) && style.force === p.fx, () => applyLook(p.fx, p.style)))}
        </View>
      </Group>
      <Group title={t('st.mine')} note={t('st.mineNote')}>
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <TextInput testID="st-save-name" value={name} onChangeText={setName} maxLength={60} placeholder={t('st.saveName')} placeholderTextColor={colors.muted} onSubmitEditing={() => { if (name.trim()) { onSave(name); setName(''); } }}
            style={{ flex: 1, height: 40, borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.surface2, color: colors.fg, fontSize: 14, outlineStyle: 'none' } as any} />
          <Button testID="st-save" size="sm" icon="content-save-outline" title={t('st.save')} disabled={!name.trim()} onPress={() => { onSave(name); setName(''); }} />
        </View>
        {saved.length === 0 ? <Txt testID="st-saved-empty" className="text-muted text-[12px]">{t('st.mineEmpty')}</Txt> : (
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {saved.map((p) => (
              <View key={p.id} testID={`st-saved-${p.id}`} style={{ position: 'relative' }}>
                {tile(`st-saved-apply-${p.id}`, 'star-outline', p.name, false, () => applyLook(p.fx, p.style))}
                <Pressable testID={`st-saved-del-${p.id}`} accessibilityRole="button" accessibilityLabel={t('st.delete')} onPress={() => onDeleteSaved(p.id)} hitSlop={6}
                  className="absolute items-center justify-center rounded-full bg-surface border border-line" style={{ top: -6, right: -6, width: 24, height: 24 }}>
                  <Icon name="close" size={14} tone="danger" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </Group>
      <Group title={t('st.presets')}>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {PRESETS.map((p) => tile(`st-preset-${p.id}`, p.icon, t(`st.preset.${p.id}`), cur !== '' && cur === studioKey({ ...p.style, force: style.force }), () => onReplace({ ...cloneStudio(p.style), force: style.force })))}
        </View>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <Button testID="st-surprise" size="sm" icon="dice-multiple-outline" title={t('st.surprise')} onPress={() => onReplace({ ...randomStudio(Math.floor(Math.random() * 1e6)), force: style.force })} />
          <Button testID="st-undo" size="sm" variant="soft" icon="undo" title={t('st.undo')} disabled={!history.canUndo} onPress={onUndo} />
          <Button testID="st-redo" size="sm" variant="soft" icon="redo" title={t('st.redo')} disabled={!history.canRedo} onPress={onRedo} />
          <Button testID="st-reset" size="sm" variant="outline" icon="restore" title={t('st.reset')} onPress={() => onReplace(cloneStudio(DEFAULT_STUDIO))} />
        </View>
      </Group>
      <Group title={t('st.share')}>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <Button testID="st-export" size="sm" variant="soft" icon="content-copy" title={t('st.export')} onPress={() => { const j = exportStudio(style); setText(j); copyText(j).then((ok) => { if (ok) toast(t('st.copied')); }); }} />
          <Button testID="st-import" size="sm" variant="soft" icon="import" title={t('st.import')} disabled={!text.trim()} onPress={() => { const s = importStudio(text); if (s) { onReplace(s); toast(t('st.importOk')); } else toast(t('st.importBad')); }} />
        </View>
        <TextInput testID="st-json" value={text} onChangeText={setText} multiline placeholder={t('st.importHint')} placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false}
          style={{ minHeight: 110, maxHeight: 220, borderRadius: 12, padding: 10, backgroundColor: colors.surface2, color: colors.fg, fontSize: 12, fontFamily: 'monospace', textAlignVertical: 'top', outlineStyle: 'none' } as any} />
      </Group>
    </View>
  );
}

/** Copies text to the clipboard; false when the browser refuses (no permission, insecure page): the JSON box still shows the text. */
async function copyText(text: string): Promise<boolean> {
  try { await (globalThis as any).navigator?.clipboard?.writeText(text); return !!(globalThis as any).navigator?.clipboard; } catch { return false; }
}

/** Applies a patch to a style through the same sanitiser the engine uses. */
export const applyPatch = (s: StudioStyle, patch: Record<string, unknown>) => mergeStudio(s, patch);
