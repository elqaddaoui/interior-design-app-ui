import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { sa } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import type { Stats } from '@/superadmin/types';
import { Btn, ErrorLine, Heading, Loading, Row, Stat, useLoad } from '@/superadmin/ui';

/** Home: five numbers and the three things you do most. */
export default function Overview() {
  const router = useRouter();
  const go = (href: string) => () => router.push(href as never);
  const { data, error, loading } = useLoad(() => sa<Stats>('/stats'));
  return (
    <View>
      <Heading title="Overview" hint="Your stores at a glance. Everything starts from a store: add its demo, its administrators, its credits and its APIs in one place."
        right={<Row><Btn testID="sa-home-new" label="New store" onPress={go('/super-admin/tenants?new=1')} /><Btn label="New demo" kind="ghost" onPress={go('/super-admin/demos?new=1')} /></Row>} />
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : (
        <View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SA.space.md }}>
            <Stat label="Stores" value={data?.tenants ?? 0} hint={`${data?.active ?? 0} active · ${data?.suspended ?? 0} suspended`} testID="kpi-tenants" onPress={go('/super-admin/tenants')} />
            <Stat label="Demos" value={data?.demos ?? 0} hint={`${data?.assignments ?? 0} copied to stores`} testID="kpi-demos" onPress={go('/super-admin/demos')} />
            <Stat label="Store themes" value={data?.themes ?? 0} hint="saved looks for new demos" testID="kpi-themes" onPress={go('/super-admin/themes')} />
            <Stat label="Credits used" value={data?.creditsUsed ?? 0} hint={`${data?.clients ?? 0} clients in all stores`} testID="kpi-credits" />
            <Stat label="API connections" value={data?.apis ?? 0} hint={`${data?.platformManaged ?? 0} store${data?.platformManaged === 1 ? '' : 's'} use them`} testID="kpi-apis" onPress={go('/super-admin/apis')} />
          </View>
        </View>
      )}
    </View>
  );
}
