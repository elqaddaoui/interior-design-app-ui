/** Console frame: sign-in, navigation, content column. Styled only by SA tokens (see tokens.ts). */
import React, { useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { SA, SA_THEMES } from './tokens';
import { useSuper, useSaTheme, useSaLang } from './session';
import { applyDocumentLang, isSaRtl, tr } from './i18n';
import { Icon, IconBtn, type IconName } from './icons';
import { saMessage } from './api';
import { CONSOLE_ICONS, applyConsoleBrand } from './brand';
import { Btn, Card, ErrorLine, Field, Loading, Notice, Row, T } from './ui';

const NAV: { href: string; label: string; testID: string; icon: IconName }[] = [
  { href: '/super-admin', label: 'Overview', testID: 'sa-nav-overview', icon: 'viewDashboardOutline' },
  { href: '/super-admin/tenants', label: 'Client Stores', testID: 'sa-nav-tenants', icon: 'domain' },
  { href: '/super-admin/demos', label: 'Demos', testID: 'sa-nav-demos', icon: 'viewGridOutline' },
  { href: '/super-admin/apis', label: 'APIs', testID: 'sa-nav-apis', icon: 'lockOutline' },
  { href: '/super-admin/audit', label: 'Activity', testID: 'sa-nav-audit', icon: 'formatListBulleted' },
  { href: '/super-admin/settings', label: 'Settings', testID: 'sa-nav-settings', icon: 'cogOutline' },
];

/** The console's logo mark (same artwork as the tab icon). */
export function Logo({ size = 28 }: { size?: number }) {
  return <Image testID="sa-logo" accessibilityLabel={tr('Platform console')} source={{ uri: CONSOLE_ICONS.p192 }} style={{ width: size, height: size, borderRadius: size * 0.22 }} />;
}
const Brand = ({ size = 28 }: { size?: number }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
    <Logo size={size} />
    <T size="xs" weight="bold" color={SA.color.accent} style={{ letterSpacing: 2, textTransform: 'uppercase' }}>{tr('Platform console')}</T>
  </View>
);

function Login() {
  const { login } = useSuper();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await login(email, password); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: SA.color.bg, alignItems: 'center', justifyContent: 'center', padding: SA.space.lg }}>
      <View style={{ width: '100%', maxWidth: 400 }}>
        <Brand size={40} />
        <T size="xl" weight="bold" style={{ marginTop: 8, marginBottom: SA.space.xl }}>{tr('Super admin')}</T>
        <Card>
          <Field label={tr('E-mail or user name')} value={email} onChangeText={setEmail} textContentType="username" {...({ testID: 'sa-email' } as object)} />
          <Field label={tr('Password')} value={password} onChangeText={setPassword} secureTextEntry onSubmitEditing={submit} {...({ testID: 'sa-password' } as object)} />
          <ErrorLine error={error} />
          <Btn testID="sa-signin" label={tr('Sign in')} onPress={submit} busy={busy} disabled={!email || !password} />
        </Card>
      </View>
    </View>
  );
}

export function SuperShell({ children }: { children: React.ReactNode }) {
  const { state, email, isDefault, check, logout } = useSuper();
  const theme = useSaTheme(s => s.theme), setTheme = useSaTheme(s => s.setTheme);
  const lang = useSaLang(s => s.lang);
  const path = usePathname();
  const router = useRouter();
  const { width } = useWindowDimensions();
  useEffect(() => { void check(); }, [check]);
  useEffect(() => { if (Platform.OS === 'web' && typeof document !== 'undefined') { applyConsoleBrand(); document.body.style.backgroundColor = SA.color.bg; } }, [theme]);
  // The page direction (right to left for Arabic and Darija) lives on the document: modals are drawn outside the root view.
  useEffect(() => { applyDocumentLang(); }, [lang]);
  if (state === 'checking') return <View style={{ flex: 1, backgroundColor: SA.color.bg, justifyContent: 'center' }}><Loading /></View>;
  if (state !== 'in') return <Login />;
  const wide = width >= SA.wide;
  const dark = SA_THEMES.find(x => x.id === theme)?.dark;
  // One tap between a light and a dark palette (the full list is in Settings).
  const flip = () => setTheme(dark ? 'daylight' : 'graphite');
  const flipBtn = <IconBtn testID="sa-theme-flip" icon={dark ? 'whiteBalanceSunny' : 'weatherNight'} label={dark ? tr('Switch to a light theme') : tr('Switch to a dark theme')} onPress={flip} size={36} />;
  const active = (href: string) => (href === '/super-admin' ? path === href : path.startsWith(href));
  const go = (href: string) => router.push(href as never);
  const links = NAV.map(item => {
    const on = active(item.href);
    return (
      <Pressable key={item.href} testID={item.testID} accessibilityRole="link" onPress={() => go(item.href)}
        style={{ paddingVertical: 9, paddingHorizontal: 12, borderRadius: SA.radius.md, backgroundColor: on ? SA.color.accentSoft : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}>
        <Icon name={item.icon} size={18} color={on ? SA.color.accent : SA.color.muted} />
        <T size="sm" weight={on ? 'bold' : 'medium'} color={on ? SA.color.accent : SA.color.muted}>{tr(item.label)}</T>
      </Pressable>
    );
  });
  return (
    <View style={{ flex: 1, backgroundColor: SA.color.bg, flexDirection: wide ? 'row' : 'column', direction: isSaRtl(lang) ? 'rtl' : 'ltr' } as object} testID="sa-shell">
      {wide ? (
        <View style={{ width: 224, borderEndWidth: 1, borderColor: SA.color.line, padding: SA.space.lg, backgroundColor: SA.color.panel }}>
          <Brand />
          <View style={{ gap: 2, marginTop: SA.space.lg }}>{links}</View>
          <View style={{ marginTop: 'auto', paddingTop: SA.space.md, gap: SA.space.sm }}>
            <T size="xs" color={SA.color.muted} numberOfLines={1}>{email}</T>
            <Row>{flipBtn}<Btn testID="sa-signout" label={tr('Sign out')} kind="ghost" small icon="logout" onPress={() => { void logout(); }} /></Row>
          </View>
        </View>
      ) : (
        <View style={{ borderBottomWidth: 1, borderColor: SA.color.line, backgroundColor: SA.color.panel, paddingTop: SA.space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SA.space.md, gap: SA.space.md }}>
            <Brand size={24} />
            <Row style={{ flexWrap: 'nowrap' }}>{flipBtn}<Btn testID="sa-signout" label={tr('Sign out')} kind="ghost" small icon="logout" onPress={() => { void logout(); }} /></Row>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SA.space.sm, paddingVertical: SA.space.sm, gap: 2 }}>{links}</ScrollView>
        </View>
      )}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: wide ? SA.space.xxl : SA.space.lg, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: SA.maxWidth }}>
          {isDefault && !path.startsWith('/super-admin/settings') ? (
            <Notice tone="warn" testID="sa-default-warning" onPress={() => go('/super-admin/settings')}>
              <T size="sm" weight="bold" color={SA.color.warn}>{tr('You are using the factory login (superadmin / superadmin). Tap here, then choose your own login and password.')}</T>
            </Notice>
          ) : null}
          <React.Fragment key={`${theme}-${lang}`}>{children}</React.Fragment>
        </View>
      </ScrollView>
    </View>
  );
}
