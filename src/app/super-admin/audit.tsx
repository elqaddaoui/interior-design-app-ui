import React from 'react';
import { View } from 'react-native';
import { sa } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import type { AuditRow } from '@/superadmin/types';
import { Card, Empty, ErrorLine, Heading, Loading, T, useLoad } from '@/superadmin/ui';

export default function Audit() {
  const { data, error, loading } = useLoad(() => sa<AuditRow[]>('/audit?limit=200'));
  return (
    <View>
      <Heading title="Activity" hint="Every action taken in this console, newest first." />
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>Nothing yet.</Empty> : (
        <Card style={{ padding: 0 }}>
          {data.map((row, i) => (
            <View key={row.id} testID="sa-audit-row" style={{ flexDirection: 'row', gap: SA.space.md, padding: SA.space.md, borderTopWidth: i ? 1 : 0, borderColor: SA.color.line, flexWrap: 'wrap' }}>
              <T size="xs" color={SA.color.muted} style={{ width: 150 }}>{new Date(row.at).toLocaleString()}</T>
              <T size="sm" weight="bold" style={{ width: 170 }}>{row.action}</T>
              <T size="sm" color={SA.color.muted} style={{ flex: 1, minWidth: 160 }} numberOfLines={2}>{[row.target, row.detail && row.detail !== '""' ? row.detail : ''].filter(Boolean).join(' · ')}</T>
              <T size="xs" color={SA.color.muted}>{row.actor}</T>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}
