import { useViewState } from '@/hooks/useViewState';
import React, { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useWizardGuard } from '@/hooks/useWizardGuard';
import { useWizard, wizardReady } from '@/store/useWizard';
import { Pressable, View } from 'react-native';
import { router } from '@/hooks/useLeaveGuard';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { tArr, useL, useT } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { toast } from '@/store/useToast';
import { sorted, useMe, useStore } from '@/store/useStore';
import { freshUser, needsPro } from '@/lib/credits';

/** While a generation waits on this paywall, the server balance is re-read this often. */
const CREDIT_POLL_MS = 3000;

/** Paywall UI only: no real payment. */
export default function Pro() {
  const { t } = useT();
  useWizardGuard();
  const me = useMe();
  const L = useL();
  // Plans, prices and the highlighted one are edited by the admin and stored in the database.
  const plans = sorted(useStore((s) => s.plans)).filter((p) => p.visible);
  const { generation } = useLocalSearchParams<{ generation?: string }>();
  const canContinue = generation === '1' && wizardReady(useWizard.getState()) && (me?.credits ?? 0) > 0;
  // Credits granted by the admin WHILE this screen is open resume the same generation automatically:
  //  - the balance is watched live (the sync loop refreshes the session when the admin changes this client),
  //  - and re-read from the server every few seconds while waiting, so nothing depends on the person tapping.
  const waiting = generation === '1';
  const resumed = useRef(false);
  const credits = me?.credits ?? 0;
  const freeUsed = !!me?.freeUsed;
  const signedIn = !!me;
  useEffect(() => {
    if (!waiting || resumed.current || !signedIn || needsPro({ credits, freeUsed: freeUsed ? 1 : 0 }) || !wizardReady(useWizard.getState())) return;
    resumed.current = true;
    useWizard.setState({ proSeen: true });
    toast(t('improve.creditsArrived'));
    router.replace('/render');
  }, [waiting, signedIn, credits, freeUsed, t]);
  useEffect(() => {
    if (!waiting) return;
    void freshUser();
    const timer = setInterval(() => { if (!resumed.current) void freshUser(); }, CREDIT_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);
  const [picked, setPlan] = useViewState<string>('plan', '');
  const plan = plans.some((p) => p.id === picked) ? picked : (plans.find((p) => p.popular) ?? plans[0])?.id;
  const [confirming, setConfirming] = useState(false);
  const confirmation = useRef(false);
  const confirmUpgrade = async () => {
    if (canContinue) { useWizard.setState({ proSeen: true }); router.replace('/render'); return; }
    if (confirmation.current) return;
    confirmation.current = true; setConfirming(true);
    // Existing demo upgrade-confirmation event: pro-cta -> pro.thanks toast.
    // No real payment or credits are claimed; the admin report labels this explicitly.
    toast(t('pro.thanks'));
    confirmation.current = false; setConfirming(false);
  };
  return (
    <Screen max={520} padded={false} footer={<View className="px-4"><Button testID="pro-cta" title={t(canContinue ? 'wizard.generate' : 'pro.cta')} size="lg" full loading={confirming} onPress={() => { void confirmUpgrade(); }} /><Txt className="text-muted text-[11px] text-center mt-2">{t('pro.demoNote')}</Txt></View>}>
      <LinearGradient colors={['#FBDD2D', '#F7B500']} style={{ paddingTop: 20, paddingBottom: 36, paddingHorizontal: 20, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
        <View className="flex-row justify-between items-center">
          <Pressable testID="pro-close" onPress={() => router.back()} className="w-10 h-10 rounded-full bg-black/10 items-center justify-center"><Icon name="close" size={22} color="#111" /></Pressable>
          <View className="bg-black/80 rounded-lg px-3 py-1 flex-row items-center gap-1"><Icon name="star-four-points" size={13} color="#FBDD2D" /><Txt className="text-white font-extrabold">{me?.credits ?? 0}</Txt></View>
        </View>
        <Animated.View entering={FadeInDown.duration(400)} className="items-center mt-4">
          <View className="w-20 h-20 rounded-3xl bg-black items-center justify-center mb-3"><Icon name="crown" size={42} color="#FBDD2D" /></View>
          <Txt className="text-[30px] font-black text-[#111]" style={{ color: '#111' }}>{t('pro.title')}</Txt>
          <Txt className="text-[16px] mt-1" style={{ color: '#111' }}>{t('pro.subtitle')}</Txt>
        </Animated.View>
      </LinearGradient>
      <View className="px-5 pt-6">
        {tArr(t, 'pro.features').map((f, i) => (
          <Animated.View key={i} entering={FadeInDown.delay(150 + i * 70)} className="flex-row items-center gap-3 mb-3">
            <View className="w-6 h-6 rounded-full bg-primary items-center justify-center"><Icon name="check" size={15} tone="onprimary" /></View>
            <Txt className="text-[15px] font-semibold flex-1">{f}</Txt>
          </Animated.View>
        ))}
        <View className="mt-4 gap-2.5">
          {plans.map((p) => {
            const on = plan === p.id;
            return (
              <Pressable key={p.id} testID={`plan-${p.id.replace(/^plan_/, '')}`} onPress={() => setPlan(p.id)} className={`flex-row items-center rounded-2xl px-4 py-4 border-2 ${on ? 'border-primary bg-soft' : 'border-line bg-surface'}`}>
                <View className={`w-6 h-6 rounded-full border-2 items-center justify-center me-3 ${on ? 'border-ink bg-ink' : 'border-line'}`}>{on ? <Icon name="check" size={14} tone="onink" /> : null}</View>
                <Txt className="font-extrabold text-[16px] flex-1">{L(p.title)}</Txt>
                {p.popular ? <View className="bg-danger rounded-md px-2 py-0.5 me-2"><Txt className="text-white text-[10px] font-black">{t('pro.popular')}</Txt></View> : null}
                <Txt className="font-black text-[16px]">{p.price}<Txt className="text-muted text-[12px] font-semibold">{L(p.period)}</Txt></Txt>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={() => toast(t('pro.demoNote'))} className="mt-4 items-center"><Txt className="text-muted text-[13px] underline">{t('pro.restore')}</Txt></Pressable>
      </View>
    </Screen>
  );
}
