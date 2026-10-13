import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useMe, useStore } from '@/store/useStore';
import { useWizard } from '@/store/useWizard';
import { useL, useT } from '@/i18n';
import { Button, Icon, PageHeader, Screen, Txt } from '@/components/ui';
import { BeforeAfter } from '@/components/result/BeforeAfter';
import { saveImage, shareImage } from '@/lib/share';
import { toast } from '@/store/useToast';
import { useBp } from '@/hooks/useBp';

export default function Result() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const L = useL();
  const { desktop } = useBp();
  const item = useStore((s) => s.history.find((x) => x.id === id));
  const tool = useStore((s) => s.tools.find((x) => x.id === item?.draft.toolId));
  const me = useMe();
  const [hold, setHold] = useState(false);

  if (!item || !item.after) return <Redirect href="/" />;

  const goHome = () => { router.dismissAll(); router.replace('/'); };
  const regenerate = () => {
    if ((me?.credits ?? 0) <= 0) { toast(t('result.noCredits')); router.push('/pro'); return; }
    const w = useWizard.getState();
    w.start(item.draft.toolId, item.draft);
    w.setPhoto(item.before);
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
    <Screen max={desktop ? 760 : 620} header={<PageHeader title={L(tool?.title) || t('result.title')} onBack={goHome} />}
      footer={<View className="flex-row gap-2.5"><Button testID="btn-regen" title={t('result.regenerate')} icon="refresh" variant="outline" onPress={regenerate} className="flex-1" /><Button testID="btn-new" title={t('result.newDesign')} onPress={newDesign} className="flex-1" /></View>}>
      <Animated.View entering={FadeInDown.duration(400)}>
        <BeforeAfter before={item.before} after={item.after} hold={hold} aspect={desktop ? 1.25 : 0.9} />
      </Animated.View>
      <View className="flex-row items-center justify-between mt-4">
        <Pressable testID="btn-before" onPressIn={() => setHold(true)} onPressOut={() => setHold(false)} className={`flex-row items-center gap-2 h-11 px-5 rounded-full border ${hold ? 'bg-ink border-ink' : 'bg-surface border-line'} active:opacity-90`}>
          <Icon name="image-filter-hdr" size={18} tone={hold ? 'onink' : 'fg'} />
          <Txt className={`font-bold ${hold ? 'text-onink' : 'text-fg'}`}>{t('result.before')}</Txt>
        </Pressable>
        <Txt className="text-muted text-[12px] flex-1 text-end ms-3">{t('result.holdHint')}</Txt>
      </View>
      {actions}
    </Screen>
  );
}
