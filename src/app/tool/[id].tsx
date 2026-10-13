import React, { useEffect, useMemo, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import { Redirect } from 'expo-router';
import { useStore, useMe } from '@/store/useStore';
import { useWizard } from '@/store/useWizard';
import { useL, useT } from '@/i18n';
import { Button, ConfirmSheet, Screen, StepHeader } from '@/components/ui';
import { StepPhoto } from '@/components/wizard/StepPhoto';
import { StepRoom } from '@/components/wizard/StepRoom';
import { StepStyle } from '@/components/wizard/StepStyle';
import { StepMode } from '@/components/wizard/StepMode';
import { resolveModelId } from '@/lib/models';
import { toast } from '@/store/useToast';
import type { StepKey } from '@/data/types';

const ORDER: StepKey[] = ['room', 'style', 'mode'];

export default function ToolWizard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const L = useL();
  const tool = useStore((s) => s.tools.find((x) => x.id === id));
  const allModels = useStore((s) => s.models);
  const me = useMe();
  const w = useWizard();
  const [i, setI] = useState(0);
  const [leave, setLeave] = useState(false);

  // Ensure the store is primed when the route is opened directly (deep link / refresh).
  useEffect(() => { if (id && w.toolId !== id) w.start(id); }, [id]);

  const steps = useMemo<StepKey[]>(() => ['photo' as any, ...ORDER.filter((s) => tool?.steps.includes(s))], [tool]);

  const close = () => setLeave(true);
  const back = () => (i > 0 ? setI(i - 1) : close());

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => sub.remove();
  }, [i]);

  if (!tool) return <Redirect href="/" />;

  const key = steps[i] as string;
  const d = w.draft;
  const valid =
    key === 'photo' ? !!w.photoUri :
    key === 'room' ? !!d.roomTypeId :
    key === 'style' ? !!d.styleId :
    true;
  const last = i === steps.length - 1;

  const next = () => {
    if (!valid) return;
    if (!last) { setI(i + 1); return; }
    const credits = me?.credits ?? 0;
    if (credits <= 0) { toast(t('result.noCredits')); router.push('/pro'); return; }
    // The AI model is chosen by the admin (tool config), never by the user.
    const modelId = resolveModelId(tool, allModels);
    w.patch({ modelId, mode: d.mode ?? 'restyle' });
    // First free render => collect name + WhatsApp, the design is delivered there.
    if (me && !me.leadDone) router.push('/lead');
    else router.push('/render');
  };

  return (
    <Screen
      max={720}
      header={<StepHeader title={L(tool.title)} step={i + 1} total={steps.length} onBack={i > 0 ? back : undefined} onClose={close} />}
      footer={<Button testID="wizard-continue" title={last ? t('wizard.generate') : t('common.continue')} onPress={next} disabled={!valid} full size="lg" />}
    >
      {key === 'photo' && <StepPhoto photo={w.photoUri} onChange={w.setPhoto} />}
      {key === 'room' && <StepRoom group={tool.roomGroup} value={d.roomTypeId} onChange={(v) => w.patch({ roomTypeId: v })} />}
      {key === 'style' && <StepStyle value={d.styleId} onChange={(v) => w.patch({ styleId: v })} />}
      {key === 'mode' && <StepMode mode={d.mode} paletteId={d.paletteId} onMode={(m) => w.patch({ mode: m })} onPalette={(p) => w.patch({ paletteId: p })} />}
      <ConfirmSheet visible={leave} onClose={() => setLeave(false)} message={`${t('wizard.leave')} ${t('wizard.leaveMsg')}`} confirmLabel={t('common.yes')} cancelLabel={t('common.no')}
        onConfirm={() => { w.start(tool.id); router.dismissTo('/'); }} />
    </Screen>
  );
}
