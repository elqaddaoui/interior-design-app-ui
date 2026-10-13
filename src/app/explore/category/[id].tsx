import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import { sorted, useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { EmptyState, PageHeader, Screen } from '@/components/ui';

import { InspirationGallery } from '@/components/ui/InspirationGallery';

export default function CategoryPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const L = useL();
  const cat = useStore((s) => s.categories.find((x) => x.id === id));
  const defaultLayout = useStore((s) => s.doc.settings.galleryLayout) ?? 'grid';
  const items = useStore((s) => s.inspirations);
  const list = sorted(items).filter((i) => i.visible && i.categoryId === id);

  return (
    <Screen header={<PageHeader title={L(cat?.title)} onBack={() => router.back()} />} bottomInset={16}>
      {list.length === 0 ? <EmptyState title={t('explore.emptyCat')} /> : (
        <InspirationGallery items={list} layout={cat?.galleryLayout || defaultLayout} />
      )}
    </Screen>
  );
}
