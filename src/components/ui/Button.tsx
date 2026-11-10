import React from 'react';
import { Pressable } from 'react-native';
import { Spinner } from './Spinner';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { useReadOnly } from './ReadOnly';

type Variant = 'primary' | 'ink' | 'soft' | 'outline' | 'ghost' | 'danger';
const BG: Record<Variant, string> = {
  primary: 'bg-primary', ink: 'bg-ink', soft: 'bg-surface2', outline: 'bg-transparent border border-line', ghost: 'bg-transparent', danger: 'bg-danger',
};
const FG: Record<Variant, string> = {
  primary: 'text-onprimary', ink: 'text-onink', soft: 'text-fg', outline: 'text-fg', ghost: 'text-fg', danger: 'text-white',
};
const SIZE = { sm: 'px-4 h-9', md: 'px-5 h-12', lg: 'px-6 h-14' };

export function Button({ title, onPress, variant = 'primary', size = 'md', disabled, loading, icon, className = '', full, testID, accessibilityLabel, safe }: {
  title: string; onPress?: () => void; variant?: Variant; size?: keyof typeof SIZE; disabled?: boolean; loading?: boolean; icon?: string; className?: string; full?: boolean; testID?: string; accessibilityLabel?: string;
  /** Changes nothing (open WhatsApp, cancel, close, paging ...): stays usable on a view-only page. */
  safe?: boolean;
}) {
  const readOnly = useReadOnly() && !safe;
  const off = disabled || loading || readOnly;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={!!off}
      aria-disabled={off || undefined}
      onPress={off ? undefined : onPress}
      className={`${SIZE[size]} rounded-full items-center justify-center flex-row gap-2 active:opacity-80 ${off && variant !== 'ghost' && variant !== 'outline' ? 'bg-surface2' : BG[variant]} ${full ? 'self-stretch' : ''} ${className}`}
    >
      {loading ? <Spinner size={size === 'sm' ? 18 : 22} /> : icon ? <Icon name={icon} size={18} color={variant === 'danger' && !off ? '#FFFFFF' : undefined} tone={off ? 'muted' : variant === 'primary' ? 'onprimary' : variant === 'ink' ? 'onink' : 'fg'} /> : null}
      {title ? <Txt className={`font-bold ${size === 'sm' ? 'text-[13px]' : 'text-[16px]'} ${off ? 'text-muted' : FG[variant]}`}>{title}</Txt> : null}
    </Pressable>
  );
}
