import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { sa } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { Stats } from '@/superadmin/types';
import { Btn, ErrorLine, Heading, Loading, Row, Stat, useLoad } from '@/superadmin/ui';

/** Home: five numbers and the three things you do most. */
export default function Overview() {
  const router = useRouter();
  const go = (href: string) => () => router.push(href as never);
  const { data, error, loading } = useLoad(() => sa<Stats>('/stats'));
  return (
    <View>
      <Heading title={tr('Overview')} hint={tr('Your stores at a glance. Everything starts from a store: add its demo, its administrators, its credits and its APIs in one place.')}
        right={<Row><Btn testID="sa-home-new" label={tr('New store')} onPress={go('/super-admin/tenants?new=1')} /><Btn label={tr('New demo')} kind="ghost" onPress={go('/super-admin/demos?new=1')} /></Row>} />
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : (
        <View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SA.space.md }}>
            <Stat label={tr('Client Stores')} value={data?.tenants ?? 0} hint={tr('{active} active · {suspended} suspended', { active: data?.active ?? 0, suspended: data?.suspended ?? 0 })} testID="kpi-tenants" onPress={go('/super-admin/tenants')} />
            <Stat label={tr('Demos')} value={data?.demos ?? 0} hint={tr('{n} copied to stores', { n: data?.assignments ?? 0 })} testID="kpi-demos" onPress={go('/super-admin/demos')} />
            <Stat label={tr('Clone Existing Store')} value={data?.themes ?? 0} hint={tr('saved looks for new demos')} testID="kpi-themes" onPress={go('/super-admin/themes')} />
            <Stat label={tr('Credits used')} value={data?.creditsUsed ?? 0} hint={tr('{n} clients in all stores', { n: data?.clients ?? 0 })} testID="kpi-credits" />
            <Stat label={tr('API connections')} value={data?.apis ?? 0} hint={tr(data?.platformManaged === 1 ? '{n} store uses them' : '{n} stores use them', { n: data?.platformManaged ?? 0 })} testID="kpi-apis" onPress={go('/super-admin/apis')} />
          </View>
        </View>
      )}
    </View>
  );
}
