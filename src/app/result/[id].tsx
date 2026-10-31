import React, { Suspense, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useUserSession } from '@/store/useUserSession';
import { router, useBackCheckpoint } from '@/hooks/useLeaveGuard';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useMe, useStore } from '@/store/useStore';
import { useWizard } from '@/store/useWizard';
import { useL, useT } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/StepHeader';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { MediaView } from '@/components/ui/MediaView';
// Own chunk (with the gesture library): the slider code is only downloaded when a result is opened.
const BeforeAfter = React.lazy(() => import('@/components/GestureKit').then((m) => ({ default: m.BeforeAfter })));
import { saveImage, shareImage } from '@/lib/share';
import { toast } from '@/store/useToast';
import { freshUser } from '@/lib/credits';
import { useBp } from '@/hooks/useBp';
import { NO_CONTEXT_MENU, NO_SELECT } from '@/lib/noSelect';

export default function Result() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const { t } = useT();
  const L = useL();
  const { desktop } = useBp();
  const user = useUserSession(s => s.user);
  const item = useStore((s) => s.history.find((x) => x.id === id && x.userId === user?.id));
  const tool = useStore((s) => s.tools.find((x) => x.id === item?.draft.toolId));
  const me = useMe();
  const [hold, setHold] = useState(false);
  // Straight after a generation Back (header, browser or hardware) means Home, never the editable request.
  useBackCheckpoint(fresh === '1', () => router.dismissTo('/'));

  if (!item || !item.after) return <Redirect href="/" />;

  // Straight after a generation the request is claimed and can no longer be edited: Back always means Home.
  // A result opened from History keeps the normal Back behaviour.
  const goBack = () => (fresh === '1' ? router.dismissTo('/') : router.back());
  const regenerate = async () => {
    const current = (await freshUser()) ?? me;
    if ((current?.credits ?? 0) <= 0) { toast(t('result.noCredits')); router.push('/pro'); return; }
    const w = useWizard.getState();
    w.start(item.draft.toolId, item.draft);
    if (item.before) w.setPhoto(item.before);
    // Credits available: go straight to the render, no paywall in between.
    router.replace('/render');
  };
  const newDesign = () => {
    const toolId = item.draft.toolId;
    useWizard.getState().start(toolId);
    router.dismissAll();
    router.replace({ pathname: '/tool/[id]', params: { id: toolId } });
  };
  const save = async () => { toast((await saveImage(item.after!)) ? t('result.savedGallery') : t('common.error')); };
  const share = () => shareImage(item.after!, t('result.sharedMsg'));

  const actions = (
    <View className="flex-row gap-2.5 mt-5">
      <Button testID="btn-save" title={t('result.save')} icon="download" variant="soft" onPress={save} className="flex-1" />
      <Button testID="btn-share" title={t('result.share')} icon="share-variant" variant="soft" onPress={share} className="flex-1" />
    </View>
  );

  return (
    <Screen max={desktop ? 760 : 620} header={<PageHeader title={L(tool?.title) || t('result.title')} onBack={goBack} />}
      footer={<View className="flex-row gap-2.5"><Button testID="btn-regen" title={t('result.regenerate')} icon="refresh" variant="outline" onPress={regenerate} className="flex-1" /><Button testID="btn-new" title={t('result.newDesign')} onPress={newDesign} className="flex-1" /></View>}>
      <Animated.View entering={FadeInDown.duration(400)}>
        <Suspense fallback={<View style={{ aspectRatio: desktop ? 1.25 : 0.9, width: '100%' }} className="rounded-3xl overflow-hidden bg-surface2" />}>
          {item.before
            ? <BeforeAfter before={item.before} after={item.after} hold={hold} aspect={desktop ? 1.25 : 0.9} />
            : <MediaView uri={item.after} className="rounded-3xl" style={{ aspectRatio: desktop ? 1.25 : 0.9, width: '100%' }} />}
        </Suspense>
      </Animated.View>
      {item.before ? <View className="flex-row items-center justify-between mt-4">
        <Pressable testID="btn-before" onPressIn={() => setHold(true)} onPressOut={() => setHold(false)} {...NO_CONTEXT_MENU} style={NO_SELECT} className={`flex-row items-center gap-2 h-11 px-5 rounded-full border ${hold ? 'bg-ink border-ink' : 'bg-surface border-line'} active:opacity-90`}>
          <Icon name="image-filter-hdr" size={18} tone={hold ? 'onink' : 'fg'} />
          <Txt style={NO_SELECT} className={`font-bold ${hold ? 'text-onink' : 'text-fg'}`}>{t('result.before')}</Txt>
        </Pressable>
        <Txt style={NO_SELECT} className="text-muted text-[12px] flex-1 text-end ms-3">{t('result.holdHint')}</Txt>
      </View> : null}
      {actions}
    </Screen>
  );
}
