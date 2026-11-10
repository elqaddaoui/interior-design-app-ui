import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { Panel } from '@/components/admin/dashboard/Kit';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { toast } from '@/store/useToast';
import { errorKey, useSuper } from '@/store/useSuper';
import type { FeatureDef, Level, Levels } from '@/lib/superApi';

/** Loads something from the Super API; `reload()` refetches without blanking the screen. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try { const next = await fnRef.current(); if (mine === seq.current) { setData(next); setError(null); } }
    catch (e) { if (mine === seq.current) setError(e); }
    finally { if (mine === seq.current) setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, deps);
  return { data, setData, error, loading, reload };
}

/** Shows the right sentence for a failed call; a 401 sends the person back to the login page. */
export function useFail() {
  const { t } = useT();
  return useCallback((e: unknown) => {
    const key = errorKey(e);
    if (key === 'sx.err.SESSION') void useSuper.getState().check();
    toast(t(key));
  }, [t]);
}

export function usePlainDate() {
  const { lang, t } = useT();
  const loc = lang === 'fr' ? 'fr-FR' : 'ar-MA-u-nu-latn';
  return {
    date: (at: number | string | null | undefined) => (at ? new Date(at).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'),
    dateTime: (at: number | string | null | undefined) => (at ? new Date(at).toLocaleString(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : t('sx.c.never')),
    num: (n: number) => n.toLocaleString(loc),
  };
}

/** Page frame: title, subtitle, actions on the right, centred width-limited body. */
export function SuperPage({ title, sub, right, children, max = 1180 }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; max?: number }) {
  const { tablet } = useBp();
  return (
    <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: tablet ? 24 : 14, paddingTop: tablet ? 8 : 6, paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
      <View style={{ width: '100%', maxWidth: max, alignSelf: 'center' }}>
        <View className="flex-row flex-wrap items-center justify-between mb-5" style={{ gap: 12 }}>
          <View style={{ flex: 1, flexBasis: 240, minWidth: 0 }}>
            <Txt accessibilityRole="header" className="text-[26px] leading-[32px] font-black" style={{ letterSpacing: -0.6 }}>{title}</Txt>
            {sub ? <Txt className="text-muted text-[13px] leading-[19px] mt-1">{sub}</Txt> : null}
          </View>
          {right ? <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>{right}</View> : null}
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

type Tone = 'success' | 'danger' | 'muted' | 'primary' | 'warning';
const TONE: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: 'bg-success/15', fg: 'text-success' }, danger: { bg: 'bg-danger/15', fg: 'text-danger' }, muted: { bg: 'bg-surface2', fg: 'text-muted' },
  primary: { bg: 'bg-soft', fg: 'text-fg' }, warning: { bg: 'bg-primary/20', fg: 'text-fg' },
};
export function Pill({ label, tone = 'muted', testID }: { label: string; tone?: Tone; testID?: string }) {
  return <View testID={testID} className={`rounded-full px-2.5 h-[22px] items-center justify-center ${TONE[tone].bg}`}><Txt numberOfLines={1} className={`text-[11px] font-extrabold ${TONE[tone].fg}`}>{label}</Txt></View>;
}

/** Wrapping row of selectable chips (plan, role, tenant…). */
export function Chips<K extends string>({ options, value, onChange, testID }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; testID?: string }) {
  return (
    <View testID={testID} accessibilityRole="radiogroup" className="flex-row flex-wrap" style={{ gap: 6 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} testID={testID ? `${testID}-${o.key}` : undefined} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} onPress={() => onChange(o.key)}
            className={`px-3.5 h-9 rounded-full items-center justify-center border ${on ? 'bg-ink border-ink' : 'bg-surface border-line'}`}>
            <Txt className={`text-[13px] font-bold ${on ? 'text-onink' : 'text-muted'}`}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return <View className="mb-1.5 mt-1"><Txt className="text-[13px] font-semibold text-muted">{children}</Txt>{hint ? <Txt className="text-[11px] text-muted mt-0.5" style={{ opacity: 0.85 }}>{hint}</Txt> : null}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Txt className="text-[11px] font-extrabold uppercase text-muted mt-4 mb-2" style={{ letterSpacing: 1.1 }}>{children}</Txt>;
}

/** "Number or empty" input value helpers for limits (empty = null / inherit). */
export const numText = (n: number | null | undefined) => (n == null ? '' : String(n));
export const parseNum = (s: string): number | null => { const v = s.replace(/[^\d]/g, ''); return v === '' ? null : Math.min(1e9, Number(v)); };

export function Card2({ children, onPress, testID, dim }: { children: React.ReactNode; onPress?: () => void; testID?: string; dim?: boolean }) {
  const body = <View className="bg-surface border border-line rounded-2xl p-3.5" style={{ opacity: dim ? 0.6 : 1 }}>{children}</View>;
  return onPress ? <Pressable testID={testID} accessibilityRole="button" onPress={onPress} className="active:opacity-80">{body}</Pressable> : <View testID={testID}>{body}</View>;
}

export function Loading({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const { t } = useT();
  if (error) return (
    <Panel><View className="items-center py-6" style={{ gap: 10 }}>
      <Icon name="alert-circle-outline" size={28} tone="danger" /><Txt className="text-muted text-center">{t(errorKey(error))}</Txt>
      {onRetry ? <Pressable accessibilityRole="button" onPress={onRetry} className="px-4 h-9 rounded-full bg-surface2 items-center justify-center"><Txt className="font-bold text-[13px]">{t('sx.c.retry')}</Txt></Pressable> : null}
    </View></Panel>
  );
  return <View className="items-center py-10"><Txt className="text-muted">{t('sx.c.loading')}</Txt></View>;
}

/* ---------------- permission matrix ---------------- */
const ORDER: Level[] = ['none', 'view', 'edit'];

/** None / View / Edit picker. `inherit` adds a fourth state for overrides (undefined = take the plan/role value). */
export function LevelPicker({ value, onChange, inherit, disabled, testID, max }: { value: Level | undefined; onChange: (v: Level | undefined) => void; inherit?: boolean; disabled?: boolean; testID?: string; max?: Level }) {
  const { t } = useT();
  const opts: (Level | 'inherit')[] = inherit ? ['inherit', ...ORDER] : ORDER;
  const cap = max ? ORDER.indexOf(max) : 2;
  return (
    <View testID={testID} accessibilityRole="radiogroup" className="flex-row bg-surface2 rounded-full p-0.5" style={{ gap: 2, opacity: disabled ? 0.55 : 1 }}>
      {opts.map((o) => {
        const on = o === 'inherit' ? value === undefined : value === o;
        const blocked = o !== 'inherit' && ORDER.indexOf(o) > cap;
        const tone = on ? (o === 'edit' ? 'bg-primary' : o === 'view' ? 'bg-ink' : 'bg-surface') : '';
        const fg = on ? (o === 'edit' ? 'text-onprimary' : o === 'view' ? 'text-onink' : 'text-fg') : 'text-muted';
        return (
          <Pressable key={o} testID={testID ? `${testID}-${o}` : undefined} disabled={disabled || blocked} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on, disabled: disabled || blocked }}
            accessibilityLabel={o === 'inherit' ? t('sx.lvl.inherit') : t(`sx.lvl.${o}`)} onPress={() => onChange(o === 'inherit' ? undefined : o)}
            className={`px-2.5 h-7 rounded-full items-center justify-center ${tone}`} style={{ opacity: blocked ? 0.35 : 1, minWidth: 40 }}>
            <Txt className={`text-[11px] font-extrabold ${fg}`}>{o === 'inherit' ? '↺' : t(`sx.lvl.short.${o}`)}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Pages grouped by topic, one level picker each. `value` holds explicit levels only; with `inherit`, a missing key means "same as the parent"
 * and `base` (the parent's levels) is shown as a faint hint. `caps` limits what can be picked per page (an account cannot exceed its role).
 */
export function PermissionMatrix({ features, groups, value, onChange, readOnly, inherit, base, testID }: {
  features: FeatureDef[]; groups: string[]; value: Levels; onChange?: (next: Levels) => void; readOnly?: boolean; inherit?: boolean; base?: Levels; testID?: string;
}) {
  const { t } = useT();
  const { tablet } = useBp();
  const set = (keys: string[], level: Level | undefined) => {
    const next = { ...value };
    for (const k of keys) { if (level === undefined) delete next[k]; else next[k] = level; }
    onChange?.(next);
  };
  return (
    <View testID={testID} style={{ gap: 14 }}>
      {groups.map((g) => {
        const items = features.filter((f) => f.group === g);
        if (!items.length) return null;
        const keys = items.map((f) => f.key);
        return (
          <View key={g} className="border border-line rounded-2xl overflow-hidden">
            <View className="flex-row items-center justify-between bg-surface2 px-3 py-2" style={{ gap: 8 }}>
              <Txt className="font-extrabold text-[12px] uppercase flex-1" style={{ letterSpacing: 0.8 }}>{t(`admin.group.${g}`)}</Txt>
              {!readOnly ? (
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  <Txt className="text-muted text-[11px]">{t('sx.lvl.setAll')}</Txt>
                  <LevelPicker testID={`${testID || 'pm'}-all-${g}`} value={inherit ? (keys.every((k) => value[k] === undefined) ? undefined : (keys.every((k) => value[k] === value[keys[0]]) ? value[keys[0]] : ('x' as never))) : (keys.every((k) => value[k] === value[keys[0]]) ? value[keys[0]] : ('x' as never))} inherit={inherit} onChange={(v) => set(keys, v)} />
                </View>
              ) : null}
            </View>
            {items.map((f, i) => {
              const own = value[f.key];
              const shown = own ?? base?.[f.key];
              return (
                <View key={f.key} testID={`${testID || 'pm'}-row-${f.key}`} className={`flex-row items-center px-3 py-2 ${i ? 'border-t border-line' : ''}`} style={{ gap: 10, flexWrap: tablet ? 'nowrap' : 'wrap' }}>
                  <View className="w-8 h-8 rounded-xl bg-soft items-center justify-center"><Icon name={f.icon} size={16} /></View>
                  <View style={{ flex: 1, minWidth: 120 }}>
                    <Txt numberOfLines={1} className="font-bold text-[13px]">{t(`admin.nav.${f.key}`)}</Txt>
                    {f.shared ? <Txt className="text-[10px] text-muted font-bold uppercase" style={{ letterSpacing: 0.6 }}>{t('sx.ac.shared')}</Txt> : null}
                  </View>
                  {inherit && own === undefined && base ? <Txt className="text-[11px] text-muted">{t(`sx.lvl.short.${shown ?? 'none'}`)}</Txt> : null}
                  <LevelPicker testID={`${testID || 'pm'}-${f.key}`} value={own} inherit={inherit} disabled={readOnly} onChange={(v) => set([f.key], v)} />
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

export const countLevels = (levels: Levels) => { let e = 0, v = 0; for (const l of Object.values(levels)) { if (l === 'edit') e++; else if (l === 'view') v++; } return { e, v }; };
