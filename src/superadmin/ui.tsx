/**
 * Primitives of the Super Admin console. Plain React Native + StyleSheet driven by `SA` (tokens.ts) only: no NativeWind classes
 * (those resolve against the tenant's theme variables), no ThemeProvider, no tenant store, no tenant fonts, no translations.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextInputProps, type ViewStyle } from 'react-native';
import { SA } from './tokens';
import { sa, saMessage } from './api';
import { Icon, type IconName } from './icons';

const font = Platform.OS === 'web' ? { fontFamily: SA.family } : {};
export function T({ children, size = 'md', weight = 'regular', color = SA.color.text, style, numberOfLines, testID, selectable }: { children: React.ReactNode; size?: keyof typeof SA.font.size; weight?: keyof typeof SA.font.weight; color?: string; style?: object; numberOfLines?: number; testID?: string; selectable?: boolean }) {
  return <Text testID={testID} selectable={selectable} numberOfLines={numberOfLines} style={[font, { fontSize: SA.font.size[size], fontWeight: SA.font.weight[weight], color }, style]}>{children}</Text>;
}
export function Btn({ label, onPress, kind = 'solid', disabled, busy, small, testID, icon }: { label: string; onPress: () => void; kind?: 'solid' | 'ghost' | 'danger'; disabled?: boolean; busy?: boolean; small?: boolean; testID?: string; icon?: IconName }) {
  const solid = kind === 'solid', danger = kind === 'danger';
  const bg = solid ? SA.color.accent : danger ? SA.color.dangerSoft : SA.color.panel, fg = solid ? SA.color.onAccent : danger ? SA.color.danger : SA.color.text;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [st().btn, { backgroundColor: bg, borderColor: solid ? SA.color.accent : danger ? SA.color.danger : SA.color.line, opacity: disabled ? 0.45 : pressed ? 0.8 : 1, paddingVertical: small ? 6 : 10, paddingHorizontal: small ? 10 : 16 }]}>
      {busy ? <ActivityIndicator size="small" color={fg} /> : <>{icon ? <Icon name={icon} size={small ? 14 : 16} color={fg} /> : null}<T size={small ? 'xs' : 'sm'} weight="bold" color={fg}>{label}</T></>}
    </Pressable>
  );
}
export function Field({ label, error, ...p }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ marginBottom: SA.space.md }}>
      <T size="xs" weight="bold" color={SA.color.muted} style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</T>
      <TextInput placeholderTextColor={SA.color.muted} autoCapitalize="none" autoCorrect={false} accessibilityLabel={label}
        {...(Platform.OS === 'web' ? ({ autoComplete: p.secureTextEntry ? 'new-password' : 'off' } as object) : {})}
        {...p} style={[st().input, font, p.multiline ? { minHeight: 90, textAlignVertical: 'top' } : null, error ? { borderColor: SA.color.danger } : null]} />
      {error ? <T size="xs" color={SA.color.danger} style={{ marginTop: 4 }}>{error}</T> : null}
    </View>
  );
}
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) { return <View style={[st().card, style]}>{children}</View>; }
export function Badge({ label, tone = 'muted' }: { label: string; tone?: 'ok' | 'warn' | 'danger' | 'muted' | 'accent' }) {
  const color = { ok: SA.color.ok, warn: SA.color.warn, danger: SA.color.danger, muted: SA.color.muted, accent: SA.color.accent }[tone];
  const bg = { ok: SA.color.okSoft, warn: SA.color.warnSoft, danger: SA.color.dangerSoft, muted: SA.color.panel2, accent: SA.color.accentSoft }[tone];
  return <View style={{ backgroundColor: bg, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}><T size="xs" weight="bold" color={color}>{label}</T></View>;
}
export const statusTone = (status: string) => (status === 'active' || status === 'done' || status === 'published' ? 'ok' : status === 'suspended' || status === 'rejected' ? 'danger' : status === 'open' || status === 'trial' || status === 'in_progress' || status === 'draft' ? 'warn' : 'muted') as 'ok' | 'warn' | 'danger' | 'muted';
export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) { return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: SA.space.sm, flexWrap: 'wrap' }, style]}>{children}</View>; }
export function Heading({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SA.space.md, marginBottom: SA.space.lg, flexWrap: 'wrap' }}>
      <View style={{ flexShrink: 1 }}><T size="xl" weight="bold" testID="sa-title">{title}</T>{hint ? <T size="sm" color={SA.color.muted} style={{ marginTop: 4, maxWidth: 640 }}>{hint}</T> : null}</View>
      {right}
    </View>
  );
}
export function Sheet({ title, onClose, children, wide, testID }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean | 'xl'; testID?: string }) {
  const { width } = useWindowDimensions();
  const phone = width < SA.wide;
  return (
    <Modal transparent animationType={phone ? 'slide' : 'fade'} onRequestClose={onClose} visible>
      <View style={[st().overlay, phone ? { padding: 0, justifyContent: 'flex-end' } : null]}>
        <View testID={testID} style={[st().sheet, { maxWidth: phone ? undefined : wide === 'xl' ? 1040 : wide ? 760 : 520 }, phone ? { maxHeight: '94%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : null]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SA.space.md, padding: SA.space.lg, borderBottomWidth: 1, borderColor: SA.color.line }}>
            <View style={{ flexShrink: 1 }}><T size="lg" weight="bold" numberOfLines={1}>{title}</T></View>
            <Btn label="Close" kind="ghost" small icon="close" onPress={onClose} testID="sa-sheet-close" />
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: SA.space.lg, paddingBottom: SA.space.xxl }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}
/** Secret shown exactly once (a generated password). */
export function Secret({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ backgroundColor: SA.color.warnSoft, borderColor: SA.color.warn, borderWidth: 1, borderRadius: SA.radius.md, padding: SA.space.md, marginBottom: SA.space.md }}>
      <T size="xs" weight="bold" color={SA.color.warn} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>{label} - shown once, copy it now</T>
      <T selectable testID="sa-secret" weight="bold" style={{ marginTop: 6, ...(Platform.OS === 'web' ? { fontFamily: 'ui-monospace, Menlo, Consolas, monospace' } : {}) }}>{value}</T>
    </View>
  );
}
export function ErrorLine({ error }: { error: unknown }) { return error ? <T size="sm" color={SA.color.danger} testID="sa-error" style={{ marginBottom: SA.space.md }}>{typeof error === 'string' ? error : saMessage(error)}</T> : null; }
export function Empty({ children }: { children: React.ReactNode }) { return <View style={{ padding: SA.space.xl, alignItems: 'center' }}><T color={SA.color.muted}>{children}</T></View>; }
export function Loading() { return <View style={{ padding: SA.space.xxl, alignItems: 'center' }}><ActivityIndicator color={SA.color.accent} /></View>; }

/** One choice among a few (replaces rows of ghost buttons). */
export function Segmented<V extends string>({ value, options, onChange, testID }: { value: V; options: { value: V; label: string; testID?: string }[]; onChange: (value: V) => void; testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', backgroundColor: SA.color.panel2, borderRadius: SA.radius.md, padding: 3, alignSelf: 'flex-start', gap: 2 }}>
      {options.map(option => {
        const on = option.value === value;
        return (
          <Pressable key={option.value} testID={option.testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(option.value)}
            style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: SA.radius.sm, backgroundColor: on ? SA.color.panel : 'transparent', ...(on && Platform.OS === 'web' ? ({ boxShadow: '0 1px 2px rgba(17,22,42,0.12)' } as object) : {}) }}>
            <T size="sm" weight={on ? 'bold' : 'medium'} color={on ? SA.color.text : SA.color.muted}>{option.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}
/** Tab strip with an underline (scrolls sideways on a phone). */
export function Tabs<V extends string>({ value, tabs, onChange }: { value: V; tabs: { value: V; label: string; testID?: string }[]; onChange: (value: V) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: SA.space.lg, borderBottomWidth: 1, borderColor: SA.color.line }}>
      {tabs.map(tab => {
        const on = tab.value === value;
        return (
          <Pressable key={tab.value} testID={tab.testID} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(tab.value)}
            style={{ paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 2, borderColor: on ? SA.color.accent : 'transparent', marginBottom: -1 }}>
            <T size="sm" weight={on ? 'bold' : 'medium'} color={on ? SA.color.accent : SA.color.muted}>{tab.label}</T>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
/** A highlighted message (info, warning or good news). */
export function Notice({ tone = 'accent', children, testID, onPress }: { tone?: 'accent' | 'warn' | 'ok' | 'danger'; children: React.ReactNode; testID?: string; onPress?: () => void }) {
  const color = { accent: SA.color.accent, warn: SA.color.warn, ok: SA.color.ok, danger: SA.color.danger }[tone];
  const bg = { accent: SA.color.accentSoft, warn: SA.color.warnSoft, ok: SA.color.okSoft, danger: SA.color.dangerSoft }[tone];
  const body = <View style={{ backgroundColor: bg, borderRadius: SA.radius.md, borderLeftWidth: 3, borderColor: color, padding: SA.space.md, marginBottom: SA.space.md }}><T size="sm" color={SA.color.text}>{children}</T></View>;
  return onPress ? <Pressable testID={testID} accessibilityRole="link" onPress={onPress}>{body}</Pressable> : <View testID={testID}>{body}</View>;
}
/** A number with a caption (dashboard tile). */
export function Stat({ label, value, hint, testID, onPress }: { label: string; value: string | number; hint?: string; testID?: string; onPress?: () => void }) {
  const body = (
    <View style={[st().card, { marginBottom: 0, minWidth: 150, flexGrow: 1, flexBasis: 150 }]}>
      <T size="xs" weight="bold" color={SA.color.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</T>
      <T size="xl" weight="bold" testID={testID} style={{ marginTop: 6 }}>{String(value)}</T>
      {hint ? <T size="xs" color={SA.color.muted} style={{ marginTop: 2 }}>{hint}</T> : null}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="link" onPress={onPress} style={{ flexGrow: 1, flexBasis: 150, minWidth: 150 }}>{body}</Pressable> : body;
}
/** Used / limit bar. `limit` null = unlimited (no bar, just the number). */
export function Meter({ used, limit, testID }: { used: number; limit: number | null; testID?: string }) {
  const ratio = limit == null ? 0 : limit === 0 ? 1 : Math.min(1, used / limit);
  const color = ratio >= 1 ? SA.color.danger : ratio >= 0.8 ? SA.color.warn : SA.color.accent;
  return (
    <View>
      <T size="sm" weight="bold" testID={testID}>{limit == null ? `${used} used · unlimited` : `${used} / ${limit} credits`}</T>
      {limit != null ? <View style={{ height: 6, borderRadius: 3, backgroundColor: SA.color.panel2, marginTop: 6, overflow: 'hidden' }}><View style={{ height: 6, width: `${Math.round(ratio * 100)}%`, backgroundColor: color }} /></View> : null}
    </View>
  );
}
/** Search box + filters row above a list. */
export function Toolbar({ children }: { children: React.ReactNode }) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SA.space.sm, marginBottom: SA.space.lg }}>{children}</View>; }
/** A list row: title, subtitle, optional trailing content. Tappable when `onPress` is given. */
export function ListRow({ title, sub, meta, right, onPress, testID, titleTestID }: { title: string; sub?: string; meta?: React.ReactNode; right?: React.ReactNode; onPress?: () => void; testID?: string; titleTestID?: string }) {
  const body = (
    <View style={[st().card, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SA.space.md, flexWrap: 'wrap' }]}>
      <View style={{ flexShrink: 1, flexGrow: 1, minWidth: 200 }}>
        <Row><T weight="bold" testID={titleTestID} numberOfLines={1}>{title}</T>{meta}</Row>
        {sub ? <T size="sm" color={SA.color.muted} style={{ marginTop: 2 }} numberOfLines={2}>{sub}</T> : null}
      </View>
      {right}
    </View>
  );
  return onPress ? <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{body}</Pressable> : <View testID={testID}>{body}</View>;
}
/** Two fields side by side on a wide screen, stacked on a phone. */
export function Pair({ children }: { children: React.ReactNode }) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: SA.space.md }}>{React.Children.map(children, child => <View style={{ flexGrow: 1, flexBasis: 220 }}>{child}</View>)}</View>; }
export const Hint = ({ children }: { children: React.ReactNode }) => <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.md }}>{children}</T>;

/** Loads on mount and whenever `reload()` is called. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    // `loading` is true from the first render and after reload() (see below), so the effect itself never sets state synchronously.
    load().then(data => live && setState({ data, loading: false }), error => live && setState({ error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { ...state, reload: () => { setState(prev => ({ ...prev, loading: true })); setTick(n => n + 1); } };
}
export const ago = (at: number | null | undefined) => {
  if (!at) return 'never';
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
export const openUrl = (path: string) => { if (Platform.OS === 'web') (globalThis as any).window?.open?.(path, '_blank', 'noopener'); };
/**
 * Opens a store's admin panel already signed in, with no password: asks the server for a one-time code (valid 60 s, tied to this
 * store and its first active administrator) and sends a new tab to `<admin>/login?handoff=<code>`. The tab is opened first, inside
 * the tap, because browsers block pop-ups that open after an await. Returns an error message, or '' when fine.
 */
export async function openAdminSession(tenantId: string, next?: string): Promise<string> {
  const win = Platform.OS === 'web' ? (globalThis as any).window?.open?.('', '_blank') : null;
  try {
    const result = await sa<{ url: string }>(`/tenants/${encodeURIComponent(tenantId)}/handoff`, { method: 'POST', body: next ? { next } : {} });
    if (win) { win.opener = null; win.location.href = result.url; }
    return '';
  } catch (error) {
    try { win?.close?.(); } catch { /* already closed */ }
    return saMessage(error);
  }
}

/** Built on every render from the live palette, so a theme change shows at once (module-level StyleSheet.create would freeze the first palette). */
const st = () => StyleSheet.create({
  btn: { borderWidth: 1, borderRadius: SA.radius.md, alignItems: 'center', justifyContent: 'center', minHeight: 36, flexDirection: 'row', gap: 6 },
  input: { backgroundColor: SA.color.panel, borderColor: SA.color.line, borderWidth: 1, borderRadius: SA.radius.md, color: SA.color.text, paddingHorizontal: SA.space.md, paddingVertical: 10, fontSize: SA.font.size.md, minHeight: 42 },
  card: { backgroundColor: SA.color.panel, borderColor: SA.color.line, borderWidth: 1, borderRadius: SA.radius.lg, padding: SA.space.lg, marginBottom: SA.space.md },
  overlay: { flex: 1, backgroundColor: SA.color.overlay, alignItems: 'center', justifyContent: 'center', padding: SA.space.lg },
  sheet: { width: '100%', maxHeight: '90%', backgroundColor: SA.color.panel, borderColor: SA.color.line, borderWidth: 1, borderRadius: SA.radius.lg, overflow: 'hidden' },
});
