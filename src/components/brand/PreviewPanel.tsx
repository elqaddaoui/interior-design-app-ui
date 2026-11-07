 
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import type { LogoSpec } from '@/lib/brand/spec';
import { AppIconView, LogoView } from './LogoView';
import { Chips } from './ui';

type Mode = 'light' | 'dark';
const PAL = {
  light: { bg: '#FFFFFF', surf: '#F4F4F5', line: '#E4E4E7', fg: '#111111', mute: '#D4D4D8' },
  dark: { bg: '#0E0E10', surf: '#1B1B1F', line: '#2A2A2E', fg: '#F5F5F5', mute: '#3F3F46' },
} as const;
export type Scene = 'header' | 'sidebar' | 'login' | 'icon';
interface SceneProps { spec: LogoSpec; mode: Mode; accent: string }

const Bar = ({ w, h = 8, c, r = 4 }: { w: number | string; h?: number; c: string; r?: number }) => <View style={{ width: w as any, height: h, borderRadius: r, backgroundColor: c }} />;
const Frame = ({ mode, children, style, testID }: { mode: Mode; children: React.ReactNode; style?: any; testID?: string }) => (
  <View testID={testID} style={[{ backgroundColor: PAL[mode].bg, borderColor: PAL[mode].line, borderWidth: 1, borderRadius: 12, overflow: 'hidden' }, style]}>{children}</View>
);
const Caption = ({ children }: { children: React.ReactNode }) => <Txt className="text-[10px] font-bold text-muted mb-1" numberOfLines={1}>{children}</Txt>;

/** The real app header: a left / centre / right wordmark with a menu button, exactly like BrandHeader places it. */
export function HeaderScene({ spec, mode, accent }: SceneProps) {
  const p = PAL[mode];
  return (
    <Frame mode={mode} testID="pv-header" style={{ minHeight: 64, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6 }}>
      <View style={{ flexDirection: 'row', direction: 'ltr', alignItems: 'center', gap: 10, minHeight: 48 } as any}>
        {spec.align === 'left' ? <View style={{ flexShrink: 1 }}><LogoView spec={spec} mode={mode} accent={accent} maxH={52} maxW={210} testID="pv-logo-header" /></View> : null}
        {spec.align === 'center' ? <View style={{ position: 'absolute', left: 44, right: 44, alignItems: 'center' }}><LogoView spec={spec} mode={mode} accent={accent} maxH={52} maxW={190} testID="pv-logo-header" /></View> : null}
        <View style={{ flex: 1 }} />
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: p.surf, alignItems: 'center', justifyContent: 'center' }}><Icon name="menu" size={16} color={p.fg} /></View>
        {spec.align === 'right' ? <View style={{ flexShrink: 1 }}><LogoView spec={spec} mode={mode} accent={accent} maxH={52} maxW={210} testID="pv-logo-header" /></View> : null}
      </View>
    </Frame>
  );
}
export function SidebarScene({ spec, mode, accent }: SceneProps) {
  const p = PAL[mode];
  return (
    <Frame mode={mode} testID="pv-sidebar" style={{ padding: 12, minHeight: 150 }}>
      <View style={{ marginBottom: 14, minHeight: 36, justifyContent: 'center' }}><LogoView spec={spec} mode={mode} accent={accent} maxW={120} maxH={44} testID="pv-logo-sidebar" /></View>
      {[0.8, 0.6, 0.7, 0.5].map((w, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: i === 0 ? accent : p.mute }} />
          <Bar w={`${w * 70}%`} c={i === 0 ? p.fg : p.mute} />
        </View>
      ))}
    </Frame>
  );
}
export function LoginScene({ spec, mode, accent }: SceneProps) {
  const p = PAL[mode];
  return (
    <Frame mode={mode} testID="pv-login" style={{ padding: 14, minHeight: 150, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ marginBottom: 12 }}><LogoView spec={spec} mode={mode} accent={accent} scale={1.15} maxW={150} maxH={54} testID="pv-logo-login" /></View>
      <View style={{ width: '88%', height: 24, borderRadius: 8, backgroundColor: p.surf, marginBottom: 7 }} />
      <View style={{ width: '88%', height: 24, borderRadius: 8, backgroundColor: p.surf, marginBottom: 10 }} />
      <View style={{ width: '88%', height: 26, borderRadius: 13, backgroundColor: accent }} />
    </Frame>
  );
}
export function IconScene({ spec, mode, accent }: SceneProps) {
  const p = PAL[mode];
  return (
    <Frame mode={mode} testID="pv-icon" style={{ padding: 12, minHeight: 100 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <AppIconView spec={spec} size={60} accent={accent} testID="pv-appicon" />
          <Txt style={{ fontSize: 10, color: p.fg, maxWidth: 64 }} numberOfLines={1}>{spec.name}</Txt>
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}><AppIconView spec={spec} size={36} accent={accent} /><Txt style={{ fontSize: 9, color: p.fg, opacity: 0.6 }}>36</Txt></View>
        <View style={{ flex: 1, minWidth: 130 }}>
          {/* a browser tab */}
          <View style={{ backgroundColor: p.surf, borderRadius: 8, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 9, height: 30 }}>
            <AppIconView spec={spec} size={16} accent={accent} testID="pv-favicon" />
            <Txt style={{ fontSize: 11, color: p.fg, flex: 1 }} numberOfLines={1}>{spec.name}</Txt>
            <Icon name="close" size={12} color={p.fg} />
          </View>
          <View style={{ height: 6, backgroundColor: p.surf, opacity: 0.5 }} />
        </View>
      </View>
    </Frame>
  );
}
const SCENES: Record<Scene, (p: SceneProps) => React.ReactElement> = { header: HeaderScene, sidebar: SidebarScene, login: LoginScene, icon: IconScene };

function Stack({ spec, mode, accent, wide, only }: SceneProps & { wide: boolean; only?: Scene }) {
  const { t } = useT();
  if (only) { const S = SCENES[only]; return <S spec={spec} mode={mode} accent={accent} />; }
  return (
    <View style={{ gap: 8 }}>
      <View><Caption>{t('br.sceneHeader')}</Caption><HeaderScene spec={spec} mode={mode} accent={accent} /></View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'stretch' }}>
        <View style={{ flex: 1, minWidth: 0 }}><Caption>{t('br.sceneSidebar')}</Caption><SidebarScene spec={spec} mode={mode} accent={accent} /></View>
        <View style={{ flex: 1.3, minWidth: 0 }}><Caption>{t('br.sceneLogin')}</Caption><LoginScene spec={spec} mode={mode} accent={accent} /></View>
      </View>
      <View><Caption>{wide ? t('br.sceneIcon') : t('br.sceneIcon')}</Caption><IconScene spec={spec} mode={mode} accent={accent} /></View>
    </View>
  );
}

const IconBtn = ({ icon, label, on, onPress, testID }: { icon: string; label: string; on?: boolean; onPress: () => void; testID?: string }) => (
  <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on }} onPress={onPress} hitSlop={4}
    className={`w-9 h-9 rounded-full items-center justify-center active:opacity-70 ${on ? 'bg-ink' : 'bg-surface2'}`}><Icon name={icon} size={18} tone={on ? 'onink' : 'fg'} /></Pressable>
);

/**
 * Always-visible live preview. Desktop: every surface at once (sticky column). Phone: pinned at the top, one surface at a time,
 * collapsible down to the header strip. `before` (the published logo) switches on the before / after comparison.
 */
export function PreviewPanel({ spec, before, dirty, desktop, collapsed, onCollapse }: { spec: LogoSpec; before: LogoSpec; dirty: boolean; desktop: boolean; collapsed: boolean; onCollapse: (v: boolean) => void }) {
  const { t } = useT();
  const { colors, dark } = useTheme();
  const [mode, setMode] = useState<Mode>(dark ? 'dark' : 'light');
  const [scene, setScene] = useState<Scene>('header');
  const [compare, setCompare] = useState(false);
  const accent = colors.primary;
  const small = !desktop;
  const body = collapsed && small ? <HeaderScene spec={spec} mode={mode} accent={accent} /> : compare ? (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {([['before', before], ['after', spec]] as const).map(([k, s]) => (
        <View key={k} testID={`pv-compare-${k}`} style={{ flex: 1, minWidth: 0 }}>
          <Caption>{t(k === 'before' ? 'br.before' : 'br.after')}</Caption>
          <View style={{ gap: 8 }}>
            <HeaderScene spec={s} mode={mode} accent={accent} />
            {!small || scene !== 'header' ? <Stack spec={s} mode={mode} accent={accent} wide={false} only={small ? scene : 'login'} /> : null}
            {!small ? <IconScene spec={s} mode={mode} accent={accent} /> : null}
          </View>
        </View>
      ))}
    </View>
  ) : small ? <Stack spec={spec} mode={mode} accent={accent} wide={false} only={scene} /> : <Stack spec={spec} mode={mode} accent={accent} wide />;
  return (
    <View testID="brand-preview" accessibilityLabel={t('br.previewTitle')} className="bg-surface rounded-2xl border border-line p-2.5">
      <View className="flex-row items-center gap-1.5 mb-2">
        <Icon name="eye-outline" size={16} tone="muted" />
        <Txt className="text-[12px] font-bold text-muted flex-1" numberOfLines={1}>{t('br.previewTitle')}</Txt>
        {dirty ? <View testID="pv-dirty" className="bg-soft rounded-full px-2 py-0.5"><Txt className="text-[10px] font-bold">{t('br.unsaved')}</Txt></View> : null}
        <IconBtn testID="pv-compare" icon="compare" label={t('br.compare')} on={compare} onPress={() => setCompare(!compare)} />
        <IconBtn testID="pv-mode-light" icon="white-balance-sunny" label={t('br.light')} on={mode === 'light'} onPress={() => setMode('light')} />
        <IconBtn testID="pv-mode-dark" icon="weather-night" label={t('br.dark')} on={mode === 'dark'} onPress={() => setMode('dark')} />
        {small ? <IconBtn testID="pv-collapse" icon={collapsed ? 'chevron-down' : 'chevron-up'} label={t(collapsed ? 'br.expandPreview' : 'br.collapsePreview')} onPress={() => onCollapse(!collapsed)} /> : null}
      </View>
      {small && !collapsed ? (
        <Chips small wrap={false} value={scene} onChange={setScene} testID="pv-scene" options={[{ key: 'header', label: t('br.sceneHeader') }, { key: 'sidebar', label: t('br.sceneSidebar') }, { key: 'login', label: t('br.sceneLogin') }, { key: 'icon', label: t('br.sceneIcon') }]} />
      ) : null}
      {body}
    </View>
  );
}
