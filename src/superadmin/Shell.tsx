/** Console frame: sign-in, navigation, content column. Styled only by SA tokens (see tokens.ts). */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { SA } from './tokens';
import { useSuper } from './session';
import { saMessage } from './api';
import { Btn, Card, ErrorLine, Field, Loading, T } from './ui';

const NAV: { href: string; label: string; testID: string }[] = [
  { href: '/super-admin', label: 'Overview', testID: 'sa-nav-overview' },
  { href: '/super-admin/tenants', label: 'Tenants', testID: 'sa-nav-tenants' },
  { href: '/super-admin/demos', label: 'Demos', testID: 'sa-nav-demos' },
  { href: '/super-admin/requests', label: 'Requests', testID: 'sa-nav-requests' },
  { href: '/super-admin/audit', label: 'Audit log', testID: 'sa-nav-audit' },
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
  const wide = width >= 860;
  const active = (href: string) => (href === '/super-admin' ? path === href : path.startsWith(href));
  return (
    <View style={{ flex: 1, backgroundColor: SA.color.bg, flexDirection: wide ? 'row' : 'column' }} testID="sa-shell">
      <View style={wide ? { width: 220, borderRightWidth: 1, borderColor: SA.color.line, padding: SA.space.lg, backgroundColor: SA.color.panel } : { borderBottomWidth: 1, borderColor: SA.color.line, padding: SA.space.md, backgroundColor: SA.color.panel }}>
        <T size="xs" weight="bold" color={SA.color.accent} style={{ letterSpacing: 2, textTransform: 'uppercase' }}>Platform console</T>
        <View style={{ flexDirection: wide ? 'column' : 'row', flexWrap: 'wrap', gap: SA.space.xs, marginTop: SA.space.md }}>
          {NAV.map(item => (
            <Pressable key={item.href} testID={item.testID} accessibilityRole="link" onPress={() => router.push(item.href as never)}
              style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: SA.radius.md, backgroundColor: active(item.href) ? SA.color.panel2 : 'transparent' }}>
              <T size="sm" weight={active(item.href) ? 'bold' : 'medium'} color={active(item.href) ? SA.color.text : SA.color.muted}>{item.label}</T>
            </Pressable>
          ))}
        </View>
        <View style={{ marginTop: wide ? 'auto' : SA.space.md, paddingTop: SA.space.md, gap: SA.space.sm }}>
          <T size="xs" color={SA.color.muted} numberOfLines={1}>{email}</T>
          <Btn testID="sa-signout" label="Sign out" kind="ghost" small onPress={() => { void logout(); }} />
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: wide ? SA.space.xxl : SA.space.lg, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: SA.maxWidth }}>
          {isDefault && !path.startsWith('/super-admin/settings') ? (
            <Pressable testID="sa-default-warning" accessibilityRole="link" onPress={() => router.push('/super-admin/settings' as never)}
              style={{ borderWidth: 1, borderColor: SA.color.warn, borderRadius: SA.radius.md, padding: SA.space.md, marginBottom: SA.space.lg, backgroundColor: SA.color.panel2 }}>
              <T size="sm" weight="bold" color={SA.color.warn}>You are using the factory login (superadmin / superadmin). Open Settings and choose your own e-mail and password.</T>
            </Pressable>
          ) : null}
          {children}
        </View>
      </ScrollView>
    </View>
  );
}
