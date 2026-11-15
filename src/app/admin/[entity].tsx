import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { CrudScreen } from '@/components/admin/CrudScreen';
import { ENTITIES } from '@/admin/entities';
import { useStore } from '@/store/useStore';
import NotFound from '../+not-found';
import { AdminPage } from '@/components/admin/AdminShell';
import { ApiHealth } from '@/components/admin/ApiHealth';
import { useCan } from '@/store/useAdminProfile';
import { useT } from '@/i18n';

export default function EntityRoute() {
  const { entity } = useLocalSearchParams<{ entity: string }>();
  const bulk = useStore((s) => s.doc.settings.bulkPanels?.includes(entity) ?? false);
  const canStoreApi = useCan('storeApi');
  const { t } = useT();
  if (!ENTITIES[entity]) return <NotFound />;
  // Without the Store API permission the AI models (provider, key, endpoint) are not shown at all: only a read-only health word.
  if (entity === 'models' && !canStoreApi) return <AdminPage title={t('admin.nav.models')} max={640}><ApiHealth /></AdminPage>;
  return <CrudScreen key={`${entity}-${bulk}`} entity={entity} />;
}
