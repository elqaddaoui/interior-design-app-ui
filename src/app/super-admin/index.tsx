import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { sa } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import type { Stats } from '@/superadmin/types';
import { Card, ErrorLine, Heading, Loading, Row, T, useLoad, Btn } from '@/superadmin/ui';

export default function Overview() {
  const router = useRouter();
  const { data, error, loading } = useLoad(() => sa<Stats>('/stats'));
  const tiles: [string, number | undefined, string][] = [
    ['Tenants', data?.tenants, 'kpi-tenants'], ['Active', data?.active, 'kpi-active'], ['Suspended', data?.suspended, 'kpi-suspended'],
    ['Demos', data?.demos, 'kpi-demos'], ['Assigned instances', data?.assignments, 'kpi-assignments'], ['Open requests', data?.openRequests, 'kpi-requests'], ['Clients (all tenants)', data?.clients, 'kpi-clients'],
  ];
  return (
    <View>
      <Heading title="Overview" hint="Every storefront and admin panel on this platform. Each tenant is isolated: its own data, sessions, media and settings." right={<Row><Btn label="New tenant" onPress={() => router.push('/super-admin/tenants' as never)} /><Btn label="Demos" kind="ghost" onPress={() => router.push('/super-admin/demos' as never)} /></Row>} />
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SA.space.md }}>
          {tiles.map(([label, value, id]) => (
            <Card key={id} style={{ width: 200, marginBottom: 0 }}>
              <T size="xs" weight="bold" color={SA.color.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</T>
              <T size="xl" weight="bold" testID={id} style={{ marginTop: 6 }}>{String(value ?? 0)}</T>
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}
