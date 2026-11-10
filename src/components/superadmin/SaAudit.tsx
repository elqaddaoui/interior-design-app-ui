import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { Txt } from '@/components/ui/Txt';
import { Panel } from '@/components/admin/dashboard/Kit';
import { saApi, type SaAudit } from '@/lib/superadmin';
import { actionLabel } from './SaDashboard';
import { Empty, SaPage, SearchBox, useSa } from './ui';

const SIZE = 30;

export function SaAudit() {
  const { t, dateTime } = useSa();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SaAudit[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (before?: number) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const r = await saApi<{ items: SaAudit[] }>(`/audit?limit=${SIZE}&q=${encodeURIComponent(query)}${before ? `&before=${before}` : ''}`);
      if (mine !== seq.current) return;
      setItems((prev) => (before ? [...prev, ...r.items] : r.items));
      setMore(r.items.length === SIZE); setFailed(false);
    } catch { if (mine === seq.current) setFailed(true); }
    if (mine === seq.current) setLoading(false);
  }, [query]);

  useEffect(() => { const h = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(h); }, [search]);
  useEffect(() => { void load(); }, [load]);

  return (
    <SaPage title={t('auditTitle')} sub={t('auditSub')} max={940}>
      <View className="flex-row flex-wrap" style={{ gap: 10 }}><SearchBox testID="sa-audit-search" value={search} onChangeText={setSearch} placeholder={t('auditSearch')} /></View>
      {failed && !items.length ? (
        <Panel><View className="items-center" style={{ gap: 10 }}><Txt className="text-[14px] font-semibold">{t('loadFailed')}</Txt><Button size="sm" variant="soft" icon="refresh" title={t('retry')} onPress={() => load()} /></View></Panel>
      ) : !items.length && loading ? <View className="items-center py-16"><Spinner size={44} /></View>
      : !items.length ? <Empty text={t('empty')} /> : (
        <Panel testID="sa-audit-list">
          {items.map((a, i) => (
            <View key={a.id} testID={`sa-audit-${a.id}`} className={`flex-row items-center py-3 ${i ? 'border-t border-line' : ''}`} style={{ gap: 12 }}>
              <View className="w-9 h-9 rounded-full bg-soft items-center justify-center"><Icon name="history" size={17} tone="fg" /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt className="text-[14px] font-bold" numberOfLines={1}>{actionLabel(t, a.action)}{a.target ? ` · ${a.target}` : ''}</Txt>
                <Txt className="text-muted text-[12px]" numberOfLines={1}>{t('by', { actor: a.actor })}{a.ip ? ` · ${a.ip}` : ''}</Txt>
              </View>
              <Txt className="text-muted text-[12px]">{dateTime(a.at)}</Txt>
            </View>
          ))}
          {more ? <View className="items-center pt-3"><Button size="sm" variant="soft" title={t('more')} loading={loading} onPress={() => load(items[items.length - 1]?.at)} testID="sa-audit-more" /></View> : null}
        </Panel>
      )}
    </SaPage>
  );
}
