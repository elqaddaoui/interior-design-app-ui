import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Txt } from '@/components/ui/Txt';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';
import { Card2, Loading, PermissionMatrix, Pill, SectionTitle, SuperPage, countLevels, numText, parseNum, useFail, useLoad, usePlainDate } from '@/components/super/ui';
import { useT } from '@/i18n';
import { toast } from '@/store/useToast';
import { errorKey, useSuper } from '@/store/useSuper';
import { superApi, type Limits, type Plan, type Tenant } from '@/lib/superApi';

const LIMIT_KEYS = ['maxClients', 'maxAdmins', 'monthlyDesigns', 'startCredits'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Offers: price, limits and the pages each offer unlocks. Edited as one list, saved with a single PUT. */
export default function AccessPage() {
  const { t } = useT();
  const fail = useFail();
  const fmt = usePlainDate();
  const catalog = useSuper((s) => s.catalog);
  const remote = useLoad(() => superApi<Plan[]>('/plans'));
  const tenants = useLoad(() => superApi<Tenant[]>('/tenants'));
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => { if (remote.data && !seeded.current) { seeded.current = true; setPlans(remote.data); } }, [remote.data]);
  const dirty = !!plans && !!remote.data && !same(plans, remote.data);
  const usage = (id: string) => (tenants.data || []).filter((x) => x.planId === id).length;
  const edit = (id: string, fn: (p: Plan) => Plan) => setPlans((list) => (list ? list.map((p) => (p.id === id ? fn(p) : p)) : list));
  const current = plans?.find((p) => p.id === open) || null;

  const save = async () => {
    if (!plans || busy) return;
    setBusy(true); setErr('');
    try {
      const saved = await superApi<Plan[]>('/plans', { method: 'PUT', body: plans.map((p) => ({ ...p, limits: Object.fromEntries(Object.entries(p.limits).filter(([, v]) => v != null)) })) });
      remote.setData(saved); setPlans(saved); toast(t('sx.c.saved')); setOpen(null);
      void tenants.reload();
    } catch (e) { const key = errorKey(e); setErr(t(key)); if (key === 'sx.err.SESSION') fail(e); }
    finally { setBusy(false); }
  };
  const discard = () => { if (remote.data) setPlans(remote.data); setErr(''); setOpen(null); };

  const addPlan = () => {
    if (!adding || !plans) return;
    const id = adding.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (id.length < 2 || plans.some((p) => p.id === id) || !adding.name.trim()) { setErr(t('sx.err.GENERIC')); return; }
    setPlans([...plans, { id, name: adding.name.trim(), price: 0, limits: {}, features: {} }]);
    setAdding(null); setErr(''); setOpen(id);
  };
  const removePlan = (id: string) => { setPlans((list) => (list ? list.filter((p) => p.id !== id) : list)); setRemoving(null); setOpen(null); };

  return (
    <SuperPage title={t('sx.ac.title')} sub={t('sx.ac.sub')} right={<Button testID="plan-new" size="sm" icon="plus" title={t('sx.ac.newPlan')} onPress={() => { setErr(''); setAdding({ id: '', name: '' }); }} />}>
      <View className="flex-row bg-soft rounded-2xl p-3 mb-4" style={{ gap: 10 }}>
        <Icon name="information-outline" size={18} />
        <Txt className="text-[12px] leading-[18px] flex-1">{t('sx.ac.sharedNote')}</Txt>
      </View>

      {!plans ? <Loading error={remote.error} onRetry={remote.reload} /> : (
        <View style={{ gap: 10 }}>
          {plans.map((p) => {
            const c = countLevels(p.features);
            return (
              <Card2 key={p.id} testID={`plan-row-${p.id}`} onPress={() => { setErr(''); setOpen(p.id); }}>
                <View className="flex-row items-center" style={{ gap: 12 }}>
                  <View className="w-11 h-11 rounded-2xl bg-ink items-center justify-center"><Icon name="shield-lock-outline" size={22} tone="onink" /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>
                      <Txt numberOfLines={1} className="font-extrabold text-[16px]">{p.name}</Txt>
                      <Pill label={p.id} tone="muted" />
                      <Pill label={t('sx.ac.tenants', { n: usage(p.id) })} tone="primary" />
                    </View>
                    <Txt numberOfLines={1} className="text-muted text-[12px] mt-0.5">{t('sx.rl.summary', { e: c.e, v: c.v })}</Txt>
                  </View>
                  <View className="items-end">
                    <Txt className="font-black text-[18px]">{fmt.num(p.price)}</Txt>
                    <Txt className="text-muted text-[10px] font-bold uppercase">{t('sx.c.price')}</Txt>
                  </View>
                </View>
                <View className="flex-row flex-wrap mt-3" style={{ gap: 8 }}>
                  {LIMIT_KEYS.map((k) => (
                    <View key={k} className="bg-surface2 rounded-xl px-3 py-1.5" style={{ flexGrow: 1, flexBasis: 120 }}>
                      <Txt numberOfLines={1} className="text-muted text-[10px] font-bold uppercase" style={{ letterSpacing: 0.6 }}>{t(`sx.tn.${k}`)}</Txt>
                      <Txt className="font-extrabold text-[13px]">{p.limits[k] == null ? t('sx.c.unlimited') : fmt.num(p.limits[k] as number)}</Txt>
                    </View>
                  ))}
                </View>
              </Card2>
            );
          })}
        </View>
      )}

      {dirty ? (
        <View testID="plans-bar" className="bg-ink rounded-2xl p-3 flex-row items-center flex-wrap" style={{ gap: 10, marginTop: 16 }}>
          <Txt className="text-onink font-bold text-[13px] flex-1" style={{ minWidth: 160 }}>{t('sx.ac.unsaved')}</Txt>
          {err && !open ? <Txt accessibilityRole="alert" className="text-onink text-[12px] w-full">{err}</Txt> : null}
          <Button testID="plans-discard" size="sm" variant="soft" title={t('sx.ac.discard')} onPress={discard} />
          <Button testID="plans-save" size="sm" title={t('sx.ac.savePlans')} loading={busy} onPress={save} />
        </View>
      ) : null}

      <Sheet visible={!!current} wide onClose={() => setOpen(null)} title={current?.name}
        footer={current ? (
          <View>
            {err ? <Txt testID="plan-error" accessibilityRole="alert" className="text-danger text-[13px] mb-2">{err}</Txt> : null}
            <View className="flex-row" style={{ gap: 8 }}>
              <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.ac.discard')} onPress={discard} full /></View>
              <View style={{ flex: 1 }}><Button testID="plan-save" title={t('sx.ac.savePlans')} loading={busy} disabled={!dirty} onPress={save} full /></View>
            </View>
          </View>
        ) : undefined}>
        {current ? (
          <View>
            <View className="flex-row flex-wrap" style={{ columnGap: 10 }}>
              <View style={{ flexGrow: 1, flexBasis: 200 }}><Input testID="plan-name" label={t('sx.ac.name')} value={current.name} onChangeText={(v) => edit(current.id, (p) => ({ ...p, name: v }))} /></View>
              <View style={{ flexGrow: 1, flexBasis: 140 }}><Input testID="plan-price" label={t('sx.c.price')} value={String(current.price)} keyboardType="decimal-pad" onChangeText={(v) => { const n = Number(v.replace(/[^\d.]/g, '')); edit(current.id, (p) => ({ ...p, price: Number.isFinite(n) ? Math.min(1e6, n) : 0 })); }} /></View>
            </View>
            <SectionTitle>{t('sx.ac.limits')}</SectionTitle>
            <Txt className="text-muted text-[12px] mb-2">{t('sx.tn.limitsHint').split('.')[0]}.</Txt>
            <View className="flex-row flex-wrap" style={{ columnGap: 10 }}>
              {LIMIT_KEYS.map((k) => (
                <View key={k} style={{ flexGrow: 1, flexBasis: 180 }}>
                  <Input testID={`plan-${k}`} label={t(`sx.tn.${k}`)} value={numText(current.limits[k])} placeholder={t('sx.c.unlimited')} keyboardType="number-pad"
                    onChangeText={(v) => { const n = parseNum(v); edit(current.id, (p) => { const limits: Partial<Limits> = { ...p.limits }; if (n === null) delete limits[k]; else limits[k] = n; return { ...p, limits }; }); }} />
                </View>
              ))}
            </View>
            <SectionTitle>{t('sx.ac.features')}</SectionTitle>
            {catalog ? <PermissionMatrix testID="plan-features" features={catalog.features} groups={catalog.groups} value={current.features} onChange={(v) => edit(current.id, (p) => ({ ...p, features: v }))} /> : null}
            <View style={{ marginTop: 18 }}>
              <Button testID="plan-delete" size="sm" variant="danger" icon="delete-outline" title={t('sx.ac.deletePlan')} disabled={plans!.length <= 1 || usage(current.id) > 0} onPress={() => setRemoving(current.id)} />
              {usage(current.id) > 0 ? <Txt className="text-muted text-[11px] mt-1">{t('sx.err.PLAN_IN_USE')}</Txt> : null}
            </View>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={!!adding} onClose={() => setAdding(null)} title={t('sx.ac.newPlan')}>
        {adding ? (<View>
          <Input testID="plan-new-name" label={t('sx.ac.name')} value={adding.name} onChangeText={(v) => setAdding({ ...adding, name: v, id: adding.id || v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) })} />
          <Input testID="plan-new-id" label={t('sx.ac.id')} value={adding.id} onChangeText={(v) => setAdding({ ...adding, id: v.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} autoCapitalize="none" autoCorrect={false} />
          {err ? <Txt accessibilityRole="alert" className="text-danger text-[13px] mb-2">{err}</Txt> : null}
          <View className="flex-row gap-2.5">
            <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.c.cancel')} onPress={() => setAdding(null)} full /></View>
            <View style={{ flex: 1 }}><Button testID="plan-new-confirm" title={t('sx.c.create')} onPress={addPlan} full /></View>
          </View>
        </View>) : null}
      </Sheet>

      <Sheet visible={!!removing} onClose={() => setRemoving(null)}>
        <Txt className="text-[15px] leading-[22px] font-bold text-center mb-3 mt-1">{t('sx.ac.deleteConfirm', { name: plans?.find((p) => p.id === removing)?.name })}</Txt>
        <View className="flex-row gap-2.5">
          <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.c.cancel')} onPress={() => setRemoving(null)} full /></View>
          <View style={{ flex: 1 }}><Button testID="plan-delete-confirm" variant="danger" title={t('sx.c.delete')} onPress={() => removing && removePlan(removing)} full /></View>
        </View>
      </Sheet>
    </SuperPage>
  );
}
