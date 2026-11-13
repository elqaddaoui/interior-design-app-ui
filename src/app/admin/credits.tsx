import { useViewState } from '@/hooks/useViewState';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { useBp } from '@/hooks/useBp';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { useCreditLog } from '@/store/useCreditLog';
import { router, useBackCheckpoint, useLeaveGuard } from '@/hooks/useLeaveGuard';
import { toast, toastAction } from '@/store/useToast';
import { BackendError } from '@/lib/backend';
import { PoolWarning } from '@/components/admin/PoolWarning';
import { poolState, useAdminInstance } from '@/store/useAdminInstance';
import { refreshAdminSession } from '@/lib/sync';
import { QUICK_AMOUNTS, ago, canGrant, clampAmount, initialOf, monthTotal, nextBalance, parseAmount, searchUsers, stepAmount, undoneBalance, type Grant } from '@/lib/creditGrants';
import type { AppUser } from '@/data/types';

/** Round avatar with the first letter of the name (theme colours only). */
function Avatar({ user, size = 36 }: { user: Pick<AppUser, 'name' | 'whatsapp'>; size?: number }) {
  return (
    <View className="bg-soft items-center justify-center" style={{ width: size, height: size, borderRadius: size / 2 }}>
      <Txt className="font-extrabold text-primary" style={{ fontSize: size * 0.42 }}>{initialOf(user)}</Txt>
    </View>
  );
}

/** − / value / +. The number is typed or stepped; always left-to-right so "−" stays on the left in Arabic too. */
function Stepper({ value, onChange, testID, minusID, plusID, step = 1, label }: { value: number; onChange: (n: number) => void; testID: string; minusID: string; plusID: string; step?: number; label: string }) {
  const { t } = useT();
  const btn = (id: string, dir: 1 | -1, icon: string, name: string) => (
    <Pressable testID={id} accessibilityRole="button" accessibilityLabel={name} onPress={() => onChange(stepAmount(value, dir, step))} hitSlop={4}
      className={`w-10 h-10 rounded-full items-center justify-center active:opacity-70 ${dir > 0 ? 'bg-primary' : 'bg-surface2'}`}>
      <Icon name={icon} size={20} tone={dir > 0 ? 'onprimary' : 'fg'} />
    </Pressable>
  );
  return (
    <View className="flex-row items-center" style={{ gap: 8, direction: 'ltr' } as never}>
      {btn(minusID, -1, 'minus', t('cr.minus'))}
      <View style={{ width: 84 }}>
        <Input tight testID={testID} accessibilityLabel={label} value={String(value)} onChangeText={(v) => onChange(parseAmount(v))} keyboardType="number-pad" className="text-center font-extrabold" style={{ textAlign: 'center' }} />
      </View>
      {btn(plusID, 1, 'plus', t('cr.plus'))}
    </View>
  );
}

function Stat({ icon, value, label, id }: { icon: string; value: number; label: string; id: string }) {
  return (
    <View testID={id} className="flex-1 bg-surface rounded-2xl border border-line p-3" style={{ minWidth: 96, gap: 6 }}>
      <Icon name={icon} size={18} tone="muted" />
      <Txt className="text-[24px] leading-[28px] font-black">{value}</Txt>
      <Txt className="text-muted text-[12px] font-semibold" numberOfLines={2}>{label}</Txt>
    </View>
  );
}

export default function Credits() {
  const { t } = useT();
  const { tablet } = useBp();
  const s = useStore();
  const { log, load: loadLog, add: addLog, undone: markLogUndone } = useCreditLog();
  useEffect(() => { void loadLog(); }, [loadLog]);
  const pool = useAdminInstance((st) => st.instance?.credits);
  const users = useMemo(() => s.users.filter((u) => u.role === 'user'), [s.users]);
  const saved = s.doc.settings.defaultFreeCredits;

  // default credits: inline stepper, "Apply" only appears once the number changed
  const [def, setDef] = useState(saved);
  const dirty = def !== saved;
  // The shared limit of the store refused a hand-out: say how many credits are really left to give.
  const poolRefused = (error: unknown) => {
    if (!(error instanceof BackendError) || error.code !== 'STORE_POOL_EXCEEDED') return false;
    toast(t('sp.poolExceeded', { available: (error.body as { available?: number } | undefined)?.available ?? 0 }));
    void refreshAdminSession();
    return true;
  };
  const saveDef = async () => { try { await s.patchDoc('settings', { defaultFreeCredits: clampAmount(def) }); } catch (error) { if (poolRefused(error)) return; throw error; } void refreshAdminSession(); toast(t('admin.crud.saved')); };
  useLeaveGuard(dirty, saveDef, () => setDef(saved), { before: { defaultFreeCredits: saved }, after: { defaultFreeCredits: def } });
  useBackCheckpoint(dirty, () => router.back());

  // grant: picked user + amount (both survive a remount of the page)
  const [uid, setUid] = useViewState<string>('credit-user', '');
  const [amount, setAmount] = useViewState<number>('credit-amount', 0);
  const [query, setQuery] = useState('');
  const picked = users.find((u) => u.id === uid);
  const nameOf = (u: Pick<AppUser, 'name' | 'whatsapp'>) => u.name || u.whatsapp || t('admin.enums.user');
  const matches = useMemo(() => searchUsers(users, query), [users, query]);
  const ready = canGrant(picked?.id, amount);

  const undo = async (g: Grant) => {
    const u = useStore.getState().users.find((x) => x.id === g.userId);
    markLogUndone(g.id);
    if (u) await useStore.getState().update('users', u.id, { credits: undoneBalance(u.credits, g) });
    toast(t('cr.undone'));
  };
  const grant = async () => {
    if (!picked || !ready) return;
    const n = clampAmount(amount);
    const g: Grant = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, userId: picked.id, name: nameOf(picked), amount: n, before: picked.credits, at: Date.now() };
    try { await s.update('users', picked.id, { credits: picked.credits + n }); } catch (error) { if (poolRefused(error)) return; throw error; }
    void refreshAdminSession();
    addLog(g);
    setAmount(0);
    toastAction(t('cr.granted', { n, name: g.name }), { label: t('cr.undo'), run: () => { void undo(g); } });
  };

  if (!s.contentReady || !s.adminLoaded) return <AdminPage title={t('admin.nav.credits')} max={980} audience="clients"><AdminLoading /></AdminPage>;

  const when = (at: number) => { const a = ago(at); return t(`cr.${a.unit}`, { n: a.n }); };

  const defaultCard = (
    <Card className="p-3" >
      <View className="flex-row items-center" style={{ gap: 10 }}>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt className="font-extrabold text-[15px]" numberOfLines={2}>{t('cr.defaultTitle')}</Txt>
          <Txt className="text-muted text-[12px]">{t('cr.defaultNote')}</Txt>
        </View>
        <Stepper testID="credits-default" minusID="credits-default-minus" plusID="credits-default-plus" label={t('cr.defaultTitle')} value={def} onChange={setDef} />
      </View>
      {dirty ? (
        <Pressable testID="credits-save" accessibilityRole="button" onPress={saveDef} className="self-end mt-3 bg-primary rounded-full flex-row items-center active:opacity-85" style={{ height: 36, paddingHorizontal: 16, gap: 6 }}>
          <Icon name="check" size={17} tone="onprimary" />
          <Txt className="text-onprimary font-bold text-[13px]">{t('cr.apply')}</Txt>
        </Pressable>
      ) : null}
    </Card>
  );

  const grantCard = (
    <Card className="p-3" style={{ gap: 14 }}>
      <Txt className="font-extrabold text-[17px]">{t('cr.grantTitle')}</Txt>

      {/* 1 · who */}
      {picked ? (
        <View testID="credits-picked" className="flex-row items-center bg-soft rounded-full ps-1.5 pe-1.5" style={{ gap: 10, height: 52 }}>
          <Avatar user={picked} size={40} />
          <View className="flex-1" style={{ minWidth: 0 }}>
            <Txt className="font-bold text-[14px]" numberOfLines={1}>{nameOf(picked)}</Txt>
            <Txt className="text-muted text-[12px]" numberOfLines={1}>{t('cr.balance')} {picked.credits}</Txt>
          </View>
          <Pressable testID="credits-clear-user" accessibilityRole="button" accessibilityLabel={t('cr.change')} onPress={() => setUid('')} hitSlop={6} className="w-9 h-9 rounded-full bg-surface items-center justify-center active:opacity-70"><Icon name="close" size={18} /></Pressable>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <View>
            <Input tight testID="credits-search" accessibilityLabel={t('cr.searchPh')} placeholder={t('cr.searchPh')} value={query} onChangeText={setQuery} autoCapitalize="none" />
          </View>
          <View testID="credits-users" className="border border-line rounded-2xl overflow-hidden bg-bg">
            {users.length === 0 ? <Txt className="text-muted text-[13px] text-center p-4">{t('cr.noUsers')}</Txt>
              : matches.length === 0 ? <Txt className="text-muted text-[13px] text-center p-4">{t('cr.noMatch')}</Txt>
              : (
                <ScrollView style={{ maxHeight: 264 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {matches.map((u, i) => (
                    <Pressable key={u.id} testID={`grant-user-${u.id}`} accessibilityRole="button" onPress={() => { setUid(u.id); setQuery(''); }} className={`flex-row items-center px-3 active:bg-surface2 ${i ? 'border-t border-line' : ''}`} style={{ gap: 10, minHeight: 56 }}>
                      <Avatar user={u} />
                      <View className="flex-1" style={{ minWidth: 0 }}>
                        <Txt className="font-bold text-[14px]" numberOfLines={1}>{nameOf(u)}</Txt>
                        <Txt className="text-muted text-[12px]" numberOfLines={1} style={{ textAlign: 'auto' }}>{u.whatsapp}</Txt>
                      </View>
                      <View className="bg-surface2 rounded-full px-2.5 h-7 items-center justify-center"><Txt className="font-extrabold text-[12.5px]">{u.credits}</Txt></View>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
          </View>
        </View>
      )}

      {/* 2 · how many */}
      <View style={{ gap: 10, opacity: picked ? 1 : 0.55 }} pointerEvents={picked ? 'auto' : 'none'}>
        <Txt className="text-[13px] font-semibold text-muted">{t('cr.amount')}</Txt>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {QUICK_AMOUNTS.map((q) => {
            const on = amount === q;
            return (
              <Pressable key={q} testID={`credits-quick-${q}`} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setAmount(on ? 0 : q)} className={`h-10 px-4 rounded-full items-center justify-center border ${on ? 'bg-ink border-ink' : 'bg-surface2 border-line'}`}>
                <Txt className={`font-extrabold text-[14px] ${on ? 'text-onink' : ''}`}>+{q}</Txt>
              </Pressable>
            );
          })}
        </View>
        <View className="flex-row items-center justify-between" style={{ gap: 10 }}>
          <Txt className="text-muted text-[12.5px] font-semibold flex-1">{t('cr.custom')}</Txt>
          <Stepper testID="credits-amount" minusID="credits-amount-minus" plusID="credits-amount-plus" label={t('cr.amount')} value={amount} onChange={setAmount} />
        </View>
      </View>

      {/* 3 · result */}
      <View testID="credits-preview" className="bg-surface2 rounded-2xl items-center justify-center" style={{ minHeight: 48, paddingHorizontal: 12 }} accessibilityLabel={picked && amount > 0 ? t('cr.preview', { from: picked.credits, to: nextBalance(picked.credits, amount) }) : t('cr.pickFirst')}>
        {picked && amount > 0 ? (
          <View className="flex-row items-center" style={{ gap: 10, direction: 'ltr' } as never}>
            <Txt className="text-muted font-bold text-[13px]">{t('cr.balance')}</Txt>
            <Txt className="font-bold text-[18px] text-muted">{picked.credits}</Txt>
            <Icon name="arrow-right" size={18} tone="muted" />
            <Txt testID="credits-preview-after" className="font-black text-[22px] text-success">{nextBalance(picked.credits, amount)}</Txt>
          </View>
        ) : <Txt className="text-muted text-[13px]">{picked ? t('cr.amount') : t('cr.pickFirst')}</Txt>}
      </View>

      <Pressable testID="credits-grant" accessibilityRole="button" accessibilityState={{ disabled: !ready }} disabled={!ready} onPress={() => { void grant(); }} className="bg-primary rounded-2xl flex-row items-center justify-center active:opacity-85" style={{ height: 52, gap: 8, opacity: ready ? 1 : 0.4 }}>
        <Icon name="plus-circle-outline" size={21} tone="onprimary" />
        <Txt className="text-onprimary font-extrabold text-[16px]">{t('admin.credits.grantBtn')}</Txt>
      </Pressable>
    </Card>
  );

  // The limit of the store is shared by all its clients: how much is held, used and still free to hand out.
  const poolCard = pool && pool.limit != null && poolState(pool) !== 'over' ? (
    <Card testID="credits-pool" className="p-3">
      <Txt className="text-muted text-[12px] leading-[18px]">{t('sp.poolShared', { limit: pool.limit, allocated: pool.allocated ?? 0, used: pool.used, available: pool.available ?? 0 })}</Txt>
    </Card>
  ) : null;

  const recent = log.slice(0, 8);
  const activityCard = (
    <Card className="p-3" style={{ gap: 4 }}>
      <View className="flex-row items-center" style={{ gap: 8, marginBottom: 4 }}>
        <Icon name="history" size={18} tone="muted" />
        <Txt className="font-extrabold text-[15px]">{t('cr.activity')}</Txt>
      </View>
      {recent.length === 0 ? <Txt testID="credits-activity-empty" className="text-muted text-[13px] py-3 text-center">{t('cr.activityEmpty')}</Txt> : (
        <View testID="credits-activity">
          {recent.map((g, i) => (
            <View key={g.id} testID={`credits-activity-${g.id}`} className={`flex-row items-center ${i ? 'border-t border-line' : ''}`} style={{ gap: 10, minHeight: 54, opacity: g.undone ? 0.5 : 1 }}>
              <Avatar user={{ name: g.name, whatsapp: '' }} size={32} />
              <View className="flex-1" style={{ minWidth: 0 }}>
                <Txt className="font-bold text-[13.5px]" numberOfLines={1}>{g.name}</Txt>
                <Txt className="text-muted text-[12px]" numberOfLines={1}>{when(g.at)}{g.undone ? ` · ${t('cr.undoneTag')}` : ''}</Txt>
              </View>
              <Txt className={`font-black text-[15px] ${g.undone ? 'text-muted' : 'text-success'}`} style={{ direction: 'ltr', textDecorationLine: g.undone ? 'line-through' : 'none' } as never}>+{g.amount}</Txt>
            </View>
          ))}
        </View>
      )}
    </Card>
  );

  return (
    <AdminPage title={t('admin.nav.credits')} max={980} audience="clients">
      <View style={{ marginBottom: 12, gap: 12 }}><PoolWarning />{poolCard}</View>
      <View testID="credits-stats" className="flex-row mb-3" style={{ gap: 10 }}>
        <Stat id="credits-stat-users" icon="account-multiple-outline" value={users.length} label={t('cr.statUsers')} />
        <Stat id="credits-stat-month" icon="gift-outline" value={monthTotal(log)} label={t('cr.statMonth')} />
        <Stat id="credits-stat-default" icon="star-circle-outline" value={saved} label={t('cr.statDefault')} />
      </View>
      {tablet ? (
        <View className="flex-row items-start" style={{ gap: 12 }}>
          <View style={{ flex: 1.25, gap: 12, minWidth: 0 }}>{grantCard}</View>
          <View style={{ flex: 1, gap: 12, minWidth: 0 }}>{defaultCard}{activityCard}</View>
        </View>
      ) : (
        <View style={{ gap: 12 }}>{defaultCard}{grantCard}{activityCard}</View>
      )}
    </AdminPage>
  );
}
