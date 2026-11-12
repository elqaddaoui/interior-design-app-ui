/** Console frame: sign-in, navigation, content column. Styled only by SA tokens (see tokens.ts). */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { SA } from './tokens';
import { useSuper } from './session';
import { saMessage } from './api';
import { Btn, Card, ErrorLine, Field, Loading, Notice, T } from './ui';

const NAV: { href: string; label: string; testID: string }[] = [
  { href: '/super-admin', label: 'Overview', testID: 'sa-nav-overview' },
  { href: '/super-admin/tenants', label: 'Tenants', testID: 'sa-nav-tenants' },
  { href: '/super-admin/demos', label: 'Demos', testID: 'sa-nav-demos' },
  { href: '/super-admin/apis', label: 'APIs', testID: 'sa-nav-apis' },
  { href: '/super-admin/requests', label: 'Requests', testID: 'sa-nav-requests' },
  { href: '/super-admin/audit', label: 'Activity', testID: 'sa-nav-audit' },
  { href: '/super-admin/settings', label: 'Settings', testID: 'sa-nav-settings' },
];

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
        <T size="xs" weight="bold" color={SA.color.accent} style={{ letterSpacing: 2, textTransform: 'uppercase' }}>Platform console</T>
        <T size="xl" weight="bold" style={{ marginTop: 4, marginBottom: SA.space.xl }}>Super admin</T>
        <Card>
          <Field label="E-mail or user name" value={email} onChangeText={setEmail} textContentType="username" {...({ testID: 'sa-email' } as object)} />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry onSubmitEditing={submit} {...({ testID: 'sa-password' } as object)} />
          <ErrorLine error={error} />
          <Btn testID="sa-signin" label="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
        </Card>
      </View>
    </View>
  );
}

export function SuperShell({ children }: { children: React.ReactNode }) {
  const { state, email, isDefault, check, logout } = useSuper();
  const path = usePathname();
  const router = useRouter();
  const { width } = useWindowDimensions();
  useEffect(() => { void check(); }, [check]);
  useEffect(() => { if (Platform.OS === 'web' && typeof document !== 'undefined') { document.title = 'Super admin'; document.body.style.backgroundColor = SA.color.bg; } }, []);
  if (state === 'checking') return <View style={{ flex: 1, backgroundColor: SA.color.bg, justifyContent: 'center' }}><Loading /></View>;
  if (state !== 'in') return <Login />;
  const wide = width >= SA.wide;
  const active = (href: string) => (href === '/super-admin' ? path === href : path.startsWith(href));
  const go = (href: string) => router.push(href as never);
  const links = NAV.map(item => {
    const on = active(item.href);
    return (
      <Pressable key={item.href} testID={item.testID} accessibilityRole="link" onPress={() => go(item.href)}
        style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: SA.radius.md, backgroundColor: on ? SA.color.accentSoft : 'transparent' }}>
        <T size="sm" weight={on ? 'bold' : 'medium'} color={on ? SA.color.accent : SA.color.muted}>{item.label}</T>
      </Pressable>
    );
  });
  return (
    <View style={{ flex: 1, backgroundColor: SA.color.bg, flexDirection: wide ? 'row' : 'column' }} testID="sa-shell">
      {wide ? (
        <View style={{ width: 224, borderRightWidth: 1, borderColor: SA.color.line, padding: SA.space.lg, backgroundColor: SA.color.panel }}>
          <T size="xs" weight="bold" color={SA.color.accent} style={{ letterSpacing: 2, textTransform: 'uppercase' }}>Platform console</T>
          <View style={{ gap: 2, marginTop: SA.space.lg }}>{links}</View>
          <View style={{ marginTop: 'auto', paddingTop: SA.space.md, gap: SA.space.sm }}>
            <T size="xs" color={SA.color.muted} numberOfLines={1}>{email}</T>
            <Btn testID="sa-signout" label="Sign out" kind="ghost" small onPress={() => { void logout(); }} />
          </View>
        </View>
      ) : (
        <View style={{ borderBottomWidth: 1, borderColor: SA.color.line, backgroundColor: SA.color.panel, paddingTop: SA.space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SA.space.md, gap: SA.space.md }}>
            <T size="xs" weight="bold" color={SA.color.accent} style={{ letterSpacing: 2, textTransform: 'uppercase' }}>Platform console</T>
            <Btn testID="sa-signout" label="Sign out" kind="ghost" small onPress={() => { void logout(); }} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SA.space.sm, paddingVertical: SA.space.sm, gap: 2 }}>{links}</ScrollView>
        </View>
      )}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: wide ? SA.space.xxl : SA.space.lg, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: SA.maxWidth }}>
          {isDefault && !path.startsWith('/super-admin/settings') ? (
            <Notice tone="warn" testID="sa-default-warning" onPress={() => go('/super-admin/settings')}>
              <T size="sm" weight="bold" color={SA.color.warn}>You are using the factory login (superadmin / superadmin). Tap here, then choose your own login and password.</T>
            </Notice>
          ) : null}
          {children}
        </View>
      </ScrollView>
    </View>
  );
}
