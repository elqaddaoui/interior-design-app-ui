import React from 'react';
import { Pressable, View } from 'react-native';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import { Icon, type IconName } from '@/superadmin/icons';
import { T } from '@/superadmin/ui';

/** Shared small pieces of the Media & storage page (console style only: tokens, no tenant theme). */
export const size = (bytes: number | null | undefined) => {
  const n = Number(bytes || 0);
  return n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
};
export const storageName = (s?: string) => (s === 'r2' ? tr('Cloudflare R2') : s === 'app' || s === 'fs' ? tr('App folder (self-hosted)') : tr('Database'));

export type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'muted';
export const toneColor = (tone: Tone) => ({ accent: SA.color.accent, ok: SA.color.ok, warn: SA.color.warn, danger: SA.color.danger, muted: SA.color.muted }[tone]);
export const toneSoft = (tone: Tone) => ({ accent: SA.color.accentSoft, ok: SA.color.okSoft, warn: SA.color.warnSoft, danger: SA.color.dangerSoft, muted: SA.color.panel2 }[tone]);

/** A round-cornered square holding an icon in a soft tone. */
export function IconBox({ name, tone = 'accent', box = 40 }: { name: IconName; tone?: Tone; box?: number }) {
  return (
    <View style={{ width: box, height: box, borderRadius: SA.radius.md, backgroundColor: toneSoft(tone), alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={Math.round(box * 0.5)} color={toneColor(tone)} />
    </View>
  );
}

/** A thin bar showing a share (0..1). */
export function Share({ value, tone = 'accent', height = 5 }: { value: number; tone?: Tone; height?: number }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: SA.color.panel2, overflow: 'hidden' }}>
      <View style={{ height, width: `${Math.round(pct * 100)}%`, minWidth: pct > 0 ? height : 0, borderRadius: height, backgroundColor: toneColor(tone) }} />
    </View>
  );
}

/** A figure with a caption: the light version of a dashboard tile. */
export function Figure({ label, value, tone = 'muted', testID }: { label: string; value: string | number; tone?: Tone; testID?: string }) {
  return (
    <View testID={testID} style={{ flexGrow: 1, flexBasis: 120, paddingVertical: SA.space.sm, paddingHorizontal: SA.space.md, borderRadius: SA.radius.md, backgroundColor: SA.color.panel2 }}>
      <T size="xl" weight="bold" color={tone === 'muted' ? SA.color.text : toneColor(tone)}>{String(value)}</T>
      <T size="xs" color={SA.color.muted} numberOfLines={2}>{label}</T>
    </View>
  );
}

/** A pill the owner can tap (filters and choices). */
export function Pill({ label, on, onPress, testID, count, icon }: { label: string; on: boolean; onPress: () => void; testID?: string; count?: number; icon?: IconName }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 99, backgroundColor: on ? SA.color.accent : SA.color.panel2 }}>
      {icon ? <Icon name={icon} size={14} color={on ? SA.color.onAccent : SA.color.muted} /> : null}
      <T size="sm" weight={on ? 'bold' : 'medium'} color={on ? SA.color.onAccent : SA.color.text}>{count == null ? label : `${label} · ${count}`}</T>
    </Pressable>
  );
}

/** A light section title with an optional action on the right. */
export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: SA.space.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SA.space.md, marginBottom: SA.space.sm, minHeight: 28 }}>
        <T weight="bold">{title}</T>
        {right}
      </View>
      {children}
    </View>
  );
}

/** A quiet link-like button (no box): for secondary actions. */
export function TextLink({ label, onPress, icon, testID, disabled }: { label: string; onPress: () => void; icon?: IconName; testID?: string; disabled?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" disabled={disabled} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: disabled ? 0.45 : 1, paddingVertical: 4 }}>
      {icon ? <Icon name={icon} size={16} color={SA.color.accent} /> : null}
      <T size="sm" weight="bold" color={SA.color.accent}>{label}</T>
    </Pressable>
  );
}
