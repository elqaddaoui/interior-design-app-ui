import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { LogoView } from '@/components/brand/LogoView';
import { specFromBranding } from '@/lib/brand/spec';
import { useTheme } from '@/theme/ThemeProvider';
import type { Branding } from '@/data/types';
import { useStore } from '@/store/useStore';

/** A single responsive wordmark/image renderer shared by desktop, mobile and preview. Older branding documents (no `logo`) are mapped to a spec. */
export function BrandMark({ branding }: { branding: Branding }) {
  const [failed, setFailed] = useState('');
  const { colors, dark } = useTheme();
  const spec = useMemo(() => specFromBranding(branding), [branding]);
  const mode = dark ? 'dark' : 'light';
  const uri = spec.type === 'image' ? (mode === 'dark' && spec.image.dark ? spec.image.dark : spec.image.light) : '';
  const ratio = mode === 'dark' && spec.image.dark ? spec.image.darkRatio : spec.image.ratio;
  const h = Math.min(52, Math.max(16, spec.image.height));
  if (uri && failed !== uri) {
    return (
      <View testID="brand-mark" style={{ maxWidth: '100%', flexShrink: 1 }}>
        <Image accessibilityLabel={spec.name} source={{ uri }} contentFit="contain" style={{ width: Math.min(220, h * (ratio || 1)), maxWidth: '100%', height: h }} onError={() => setFailed(uri)} />
      </View>
    );
  }
  return (
    <View testID="brand-mark" style={{ maxWidth: '100%', flexShrink: 1 }}>
      <LogoView spec={uri ? { ...spec, type: 'text' } : spec} mode={mode} accent={colors.primary} maxW={220} maxH={52} />
    </View>
  );
}

/** Physical left/right placements stay consistent when switching between LTR and RTL. */
export function BrandHeader({ branding: preview, navigation, actions }: { branding?: Branding; navigation?: React.ReactNode; actions?: React.ReactNode }) {
  const saved = useStore((s) => s.doc.branding);
  const branding = preview ?? saved;
  const position = branding.logoPosition ?? 'left';
  const mark = <BrandMark branding={branding} />;
  return (
    <View testID={`brand-header-${position}`} style={{ flexDirection: 'row', direction: 'ltr', alignItems: 'center', minHeight: navigation && position === 'center' ? 108 : 64, gap: 12, flexWrap: position === 'center' && navigation ? 'wrap' : 'nowrap' }}>
      {position === 'left' ? mark : null}
      {position === 'center' ? <View style={navigation ? { width: '100%', alignItems: 'center', paddingTop: 4 } : { position: 'absolute', left: actions ? 64 : 0, right: actions ? 64 : 0, alignItems: 'center' }}>{mark}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>{navigation}</View>
      {actions}
      {position === 'right' ? mark : null}
    </View>
  );
}
