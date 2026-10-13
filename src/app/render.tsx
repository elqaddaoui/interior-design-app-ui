import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { Redirect } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import { useStore, useMe } from '@/store/useStore';
import { useWizard } from '@/store/useWizard';
import { services, ME } from '@/data/repositories';
import { useT } from '@/i18n';
import { Button, Screen } from '@/components/ui';
import { RenderingView } from '@/components/result/RenderingView';
import { toast } from '@/store/useToast';

/** Runs the (mock) render, then creates history/request entries and routes to the result or the WhatsApp success page. */
export default function RenderPage() {
  const { t } = useT();
  const w = useWizard();
  const me = useMe();
  const [state, setState] = useState({ progress: 0, stage: 0 });
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const signal = useRef({ cancelled: false });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const run = async () => {
    const st = useStore.getState();
    const wiz = useWizard.getState();
    const user = st.users.find((u) => u.id === ME);
    if (!user) return;
    setFailed(false);
    signal.current = { cancelled: false };
    try {
      const { imageUri } = await services.render.render({ photoUri: wiz.photoUri, draft: wiz.draft }, (p) => setState(p), signal.current);
      if (signal.current.cancelled) return;
      const lead = wiz.lead;
      const fresh = useStore.getState();
      const meNow = fresh.users.find((u) => u.id === ME)!;
      await fresh.update('users', ME, { credits: Math.max(0, meNow.credits - 1) });

      if (lead) {
        // First free render: deliver through WhatsApp (admin queue).
        const req = fresh.requests.find((r) => r.userId === ME && !r.aiResult && r.status === 'pending');
        const auto = fresh.doc.settings.autoSendWhatsApp;
        const hist = await fresh.create('history', { userId: ME, before: wiz.photoUri, after: auto ? imageUri : undefined, status: auto ? 'done' : 'pending', draft: wiz.draft, createdAt: Date.now(), requestId: req?.id });
        if (req) {
          let status: 'pending' | 'delivered' = 'pending';
          if (auto) { await services.whatsapp.sendDesign({ whatsapp: lead.whatsapp, name: lead.name, imageUri }); status = 'delivered'; }
          await fresh.update('requests', req.id, { aiResult: imageUri, historyId: hist.id, status, autoSent: auto });
        }
        wiz.setLead(undefined);
        router.replace('/lead-success');
        return;
      }
      const hist = await fresh.create('history', { userId: ME, before: wiz.photoUri, after: imageUri, status: 'done', draft: wiz.draft, createdAt: Date.now() });
      router.replace({ pathname: '/result/[id]', params: { id: hist.id } });
    } catch {
      if (!signal.current.cancelled) setFailed(true);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
    return () => { signal.current.cancelled = true; };
  }, []);

  if (!w.photoUri || !me) return <Redirect href="/" />;

  const cancel = () => { signal.current.cancelled = true; router.back(); };
  return (
    <Screen max={560} scroll={false} padded>
      <View className="flex-1 justify-center py-6">
        <RenderingView photo={w.photoUri} progress={state.progress} stage={state.stage} />
        <View className="mt-8 items-center">
          {failed ? <Button title={t('common.retry')} onPress={() => { setState({ progress: 0, stage: 0 }); run(); toast(t('render.failed')); }} /> : <Button variant="ghost" title={t('render.cancel')} onPress={cancel} />}
        </View>
      </View>
    </Screen>
  );
}
