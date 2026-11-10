import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { Txt, useAppFont } from '@/components/ui/Txt';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { agoParts } from '@/lib/adminAccount';
import { BackendError } from '@/lib/backend';
import { passwordRules } from '@/lib/superadmin';
import { useTheme } from '@/theme/ThemeProvider';

/** Translation, error and date helpers of the Super Admin panel (namespace `sa`). */
export function useSa() {
  const { t, lang, rtl } = useT();
  const s = (key: string, options?: Record<string, unknown>) => t(`sa.${key}`, options);
  const loc = lang === 'fr' ? 'fr-FR' : 'ar-MA-u-nu-latn';
  return {
    t: s, lang, rtl, loc,
    /** A readable message for a failed call (the server sends a code such as WEAK_PASSWORD). */
    err: (error: unknown) => {
      const code = error instanceof BackendError ? error.code : '';
      const key = `sa.err_${code}`;
      const text = t(key);
      return code && text !== key ? text : t('sa.err_generic');
    },
    ago: (at?: number | null) => {
      const a = agoParts(at);
      return a.key === 'never' ? s('never') : a.key === 'now' ? s('agoNow') : s(a.key === 'min' ? 'agoMin' : a.key === 'hour' ? 'agoHour' : 'agoDay', { n: a.n });
    },
    date: (at: number) => new Date(at).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' }),
    dateTime: (at: number) => new Date(at).toLocaleString(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  };
}

/** Standard page of the panel: title row + scrollable, width-limited body. */
export function SaPage({ title, sub, right, children, max = 1180 }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; max?: number }) {
  const { tablet } = useBp();
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: tablet ? 28 : 14, paddingTop: tablet ? 8 : 10, paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
      <View style={{ width: '100%', maxWidth: max, alignSelf: 'center', gap: 16 }}>
        <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 12 }}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Txt accessibilityRole="header" className="text-[26px] leading-[32px] font-black" style={{ letterSpacing: -0.6 }}>{title}</Txt>
            {sub ? <Txt className="text-muted text-[14px] leading-[20px] mt-1">{sub}</Txt> : null}
          </View>
          {right}
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

type Query<T> = { data: T | null; error: string; loading: boolean; reload: () => void };
/** Loading / failed (with retry) / ready, for one resource. */
export function Loaded<T>({ q, children }: { q: Query<T>; children: (data: T) => React.ReactNode }) {
  const { t } = useSa();
  if (q.data) return <>{children(q.data)}</>;
  if (q.loading) return <View testID="sa-loading" className="items-center justify-center py-16"><Spinner size={44} /></View>;
  return (
    <View testID="sa-error" className="bg-surface border border-line rounded-3xl p-6 items-center" style={{ gap: 12 }}>
      <Icon name="alert-circle-outline" size={30} tone="danger" />
      <Txt className="text-[14px] font-semibold text-center">{t('loadFailed')}</Txt>
      <Button size="sm" variant="soft" title={t('retry')} icon="refresh" onPress={q.reload} />
    </View>
  );
}

export function Empty({ icon = 'tray-remove', text }: { icon?: string; text: string }) {
  return (
    <View testID="sa-empty" className="bg-surface border border-line rounded-3xl items-center py-12" style={{ gap: 10 }}>
      <Icon name={icon} size={30} tone="muted" />
      <Txt className="text-muted text-[14px]">{text}</Txt>
    </View>
  );
}

type Tone = 'success' | 'danger' | 'primary' | 'muted' | 'ink';
const PILL: Record<Tone, { box: string; text: string }> = {
  success: { box: 'bg-success/15', text: 'text-success' },
  danger: { box: 'bg-danger/15', text: 'text-danger' },
  primary: { box: 'bg-soft', text: 'text-fg' },
  muted: { box: 'bg-surface2', text: 'text-muted' },
  ink: { box: 'bg-ink', text: 'text-onink' },
};
export function Pill({ label, tone = 'muted', icon, testID }: { label: string; tone?: Tone; icon?: string; testID?: string }) {
  const p = PILL[tone];
  return (
    <View testID={testID} className={`flex-row items-center rounded-full px-2.5 ${p.box}`} style={{ height: 24, gap: 4 }}>
      {icon ? <Icon name={icon} size={13} tone={tone === 'ink' ? 'onink' : tone === 'success' ? 'success' : tone === 'danger' ? 'danger' : 'muted'} /> : null}
      <Txt numberOfLines={1} className={`text-[11px] font-extrabold ${p.text}`}>{label}</Txt>
    </View>
  );
}

/** Single choice shown as pills. */
export function Choice<K extends string>({ options, value, onChange, testID, label }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; testID?: string; label?: string }) {
  return (
    <View className="mb-3">
      {label ? <Txt className="text-[13px] font-semibold text-muted mb-1.5">{label}</Txt> : null}
      <View testID={testID} accessibilityRole="radiogroup" className="flex-row flex-wrap" style={{ gap: 6 }}>
        {options.map((o) => {
          const on = o.key === value;
          return (
            <Pressable key={o.key} testID={testID ? `${testID}-${o.key}` : undefined} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} onPress={() => onChange(o.key)}
              className={`rounded-full px-3.5 items-center justify-center ${on ? 'bg-ink' : 'bg-surface2'}`} style={{ height: 36 }}>
              <Txt className={`text-[13px] font-bold ${on ? 'text-onink' : ''}`}>{o.label}</Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Password box with the show/hide eye. */
export function PasswordField({ label, value, onChangeText, error, testID, autoComplete, onSubmitEditing }: { label: string; value: string; onChangeText: (v: string) => void; error?: string; testID: string; autoComplete?: 'current-password' | 'new-password'; onSubmitEditing?: () => void }) {
  const { t } = useSa();
  const [shown, setShown] = useState(false);
  return (
    <View>
      <Input testID={testID} label={label} value={value} onChangeText={onChangeText} secureTextEntry={!shown} autoCapitalize="none" autoCorrect={false} autoComplete={autoComplete ?? 'new-password'} error={error} onSubmitEditing={onSubmitEditing} />
      <Pressable testID={`${testID}-eye`} accessibilityRole="button" accessibilityLabel={shown ? t('hide') : t('show')} onPress={() => setShown((v) => !v)} hitSlop={8}
        className="absolute w-9 h-9 items-center justify-center" style={{ end: 6, top: 26 }}>
        <Icon name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} tone="muted" />
      </Pressable>
    </View>
  );
}

/** The four rules of a Super Admin password, ticked as the person types. */
export function PasswordRules({ value, username }: { value: string; username?: string }) {
  const { t } = useSa();
  const rules = passwordRules(value, username);
  const rows: [keyof typeof rules, string][] = [['length', 'ruleLength'], ['letter', 'ruleLetter'], ['digit', 'ruleDigit'], ['notDefault', 'ruleNotDefault']];
  return (
    <View testID="pw-rules" className="flex-row flex-wrap mb-3 -mt-1" style={{ columnGap: 14, rowGap: 4 }}>
      {rows.map(([key, text]) => {
        const ok = value ? rules[key] : false;
        return (
          <View key={key} className="flex-row items-center" style={{ gap: 5 }}>
            <Icon name={ok ? 'check-circle-outline' : 'circle-outline'} size={15} tone={ok ? 'success' : 'muted'} />
            <Txt className={`text-[12px] ${ok ? 'text-success' : 'text-muted'}`}>{t(text)}</Txt>
          </View>
        );
      })}
    </View>
  );
}

/** Small round action button of a list row. */
export function RowBtn({ icon, label, onPress, tone = 'fg', testID, disabled }: { icon: string; label: string; onPress: () => void; tone?: 'fg' | 'danger'; testID?: string; disabled?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={4}
      className="w-9 h-9 rounded-full bg-surface2 items-center justify-center active:opacity-70" style={{ opacity: disabled ? 0.4 : 1 }}>
      <Icon name={icon} size={17} tone={tone === 'danger' ? 'danger' : 'fg'} />
    </Pressable>
  );
}

/** Search box with a magnifier. */
export function SearchBox({ value, onChangeText, placeholder, testID }: { value: string; onChangeText: (v: string) => void; placeholder: string; testID?: string }) {
  const { colors } = useTheme();
  const fontFamily = useAppFont();
  return (
    <View className="flex-row items-center bg-surface border border-line rounded-full px-3.5" style={{ height: 44, gap: 8, flexGrow: 1, flexBasis: 220, minWidth: 0 }}>
      <Icon name="magnify" size={19} tone="muted" />
      <TextInput testID={testID} accessibilityLabel={placeholder} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false}
        style={{ flex: 1, minWidth: 0, height: 42, fontSize: 15, fontFamily, color: colors.fg, outlineStyle: 'none' } as never} />
      {value ? <Pressable accessibilityRole="button" accessibilityLabel="clear" hitSlop={8} onPress={() => onChangeText('')}><Icon name="close-circle-outline" size={18} tone="muted" /></Pressable> : null}
    </View>
  );
}

/** Row with a label, a hint and a switch (platform settings). */
export function SwitchRow({ label, hint, children, testID }: { label: string; hint?: string; children: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} className="flex-row items-center" style={{ gap: 14, paddingVertical: 12 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt className="text-[15px] font-bold">{label}</Txt>
        {hint ? <Txt className="text-muted text-[12.5px] leading-[18px] mt-0.5">{hint}</Txt> : null}
      </View>
      {children}
    </View>
  );
}

/** Responsive grid: cards share the row, each at least `min` px wide. */
export function Grid({ children, min = 320, gap = 12 }: { children: React.ReactNode; min?: number; gap?: number }) {
  return <View className="flex-row flex-wrap" style={{ gap }}>{React.Children.map(children, (child) => (child ? <View style={{ flexGrow: 1, flexBasis: min, minWidth: 0 }}>{child}</View> : null))}</View>;
}
