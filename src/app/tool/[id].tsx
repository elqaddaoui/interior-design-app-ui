import React, { useEffect, useMemo, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import { useStore } from '@/store/useStore';
import { useWizard, wizardReady } from '@/store/useWizard';
import { useL, useT } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { useUserSession } from '@/store/useUserSession';
import { freshUser, needsPro } from '@/lib/credits';
import { useWizardGuard } from '@/hooks/useWizardGuard';
import { Screen } from '@/components/ui/Screen';
import { StepHeader } from '@/components/ui/StepHeader';
import { StepPhoto } from '@/components/wizard/StepPhoto';
import { StepRoom } from '@/components/wizard/StepRoom';
import { StepStyle } from '@/components/wizard/StepStyle';
import { StepMode } from '@/components/wizard/StepMode';
import { StepCustom } from '@/components/wizard/StepCustom';
import { ModelBadge } from '@/components/wizard/ModelBadge';
import { resolveModelId } from '@/lib/models';
import type { StepKey } from '@/data/types';

const ORDER: StepKey[] = ['room', 'style', 'mode'];

export default function ToolWizard() {
  const { id, step } = useLocalSearchParams<{ id: string; step?: string }>();
  const { t } = useT();
  const L = useL();
  const tool = useStore((s) => s.tools.find((x) => x.id === id));
  const allModels = useStore((s) => s.models);
  const w = useWizard();
  const i = Math.max(0, Number(step) || 0);
  useWizardGuard();
  const user = useUserSession(s => s.user);
  const [checking, setChecking] = useState(false);
  const pickerOn = useStore((s) => s.doc.settings.aiModelPicker) === true;

  // Ensure the store is primed when the route is opened directly (deep link / refresh).
  useEffect(() => { const wizard = useWizard.getState(); if (id && wizard.toolId !== id) wizard.start(id); }, [id]);

  const steps = useMemo<StepKey[]>(() => ['photo' as any, ...ORDER.filter((s) => tool?.steps.includes(s))], [tool]);

  const close = () => router.dismissTo('/');
  const back = () => router.back();

  if (!tool) return <Redirect href="/" />;

  const key = steps[Math.min(i, steps.length - 1)] as string;
  const d = w.draft;
  const valid =
    key === 'photo' ? wizardReady(w) :
    key === 'room' ? !!d.roomTypeId :
    key === 'style' ? !!d.styleId :
    true;
  const last = i === steps.length - 1;

  const next = async () => {
    if (!valid || checking) return;
    if (!last) { router.push({ pathname: '/tool/[id]', params: { id, step: String(i + 1), forward: '1' } }); return; }
    // The AI model is chosen by the admin (tool config), never by the user.
    const allowed = d.modelId && allModels.some((m) => m.id === d.modelId && m.enabled && tool.modelIds.includes(m.id));
    const modelId = pickerOn && allowed ? d.modelId : resolveModelId(tool, allModels);
    w.patch({ modelId, mode: d.mode ?? 'restyle' });
    // First free render => collect name + WhatsApp, the design is delivered there.
    if (!user) { router.push('/lead'); return; }
    // The admin may have granted credits since this device last synced: always check the server first.
    setChecking(true);
    const current = (await freshUser()) ?? user;
    setChecking(false);
    if (needsPro(current)) router.push({ pathname: '/pro', params: { generation: '1' } });
    else router.push('/render');
  };

  return (
    <Screen
      max={720}
      header={<StepHeader title={L(tool.title)} step={i + 1} total={steps.length} onBack={i > 0 ? back : undefined} onClose={close} />}
      footer={<Button testID="wizard-continue" title={last ? t('wizard.generate') : t('common.continue')} onPress={next} disabled={!valid} loading={checking} full size="lg" />}
    >
      {key === 'photo' && <StepPhoto photo={w.photoUri} onChange={w.setPhoto} draft={d} onDraft={(p) => w.patch(p)} />}
      {key === 'room' && <StepRoom group={tool.roomGroup} value={d.roomTypeId} onChange={(v) => w.patch({ roomTypeId: v })} />}
      {key === 'style' && <StepStyle value={d.styleId} onChange={(v) => w.patch({ styleId: v })} />}
      {key === 'mode' && <StepMode mode={d.mode} paletteId={d.paletteId} onMode={(m) => w.patch({ mode: m })} onPalette={(p) => w.patch({ paletteId: p })} />}
      {last && <StepCustom draft={d} onChange={(p) => w.patch(p)} showPrompt={d.source !== 'text'} />}
      {last && <ModelBadge tool={tool} draft={d} hasPhoto={!!w.photoUri} onChange={(modelId) => w.patch({ modelId })} />}

    </Screen>
  );
}
