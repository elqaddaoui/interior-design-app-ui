import React from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { Txt, useAppFont } from './Txt';
import { useTheme } from '@/theme/ThemeProvider';

/** `tight` drops the bottom margin (rows managed by a parent); `invalid` only paints the border (the parent shows the message once). */
export function Input({ label, error, className = '', language, tight, invalid, ...p }: TextInputProps & { label?: string; error?: string; className?: string; language?: string; tight?: boolean; invalid?: boolean }) {
  const { colors } = useTheme();
  const fontFamily = useAppFont(language);
  // Browsers' password managers fill a text box that sits before a password box with the saved login (the "admin" in the
  // search field, the dots in an API-key field). Every field says what it is: secrets are "new-password" (never filled with
  // a saved login), everything else is "off". The login form passes its own values (username / current-password).
  const autoComplete = p.autoComplete ?? (p.secureTextEntry ? 'new-password' : 'off');
  return (
    <View className={tight ? '' : 'mb-3'}>
      {label ? <Txt className="text-[13px] font-semibold text-muted mb-1.5">{label}</Txt> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        {...p}
        autoComplete={autoComplete}
        className={`bg-surface2 text-fg rounded-xl px-4 min-h-[44px] text-[16px] border ${error || invalid ? 'border-danger' : 'border-transparent'} ${className}`}
        style={[{ fontFamily, color: colors.fg, minWidth: 0, width: '100%', flexGrow: 0, flexShrink: 0, height: p.multiline ? undefined : 44, paddingVertical: 10, textAlign: undefined, outlineStyle: 'none' } as any, p.style]}
      />
      {error ? <Txt className="text-danger text-[12px] mt-1">{error}</Txt> : null}
    </View>
  );
}
