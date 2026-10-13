import { useViewState } from '@/hooks/useViewState';
import React from 'react';
import { Pressable, View } from 'react-native';
import { router } from '@/hooks/useLeaveGuard';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useStore, useMe } from '@/store/useStore';
import { useLocal } from '@/store/useLocal';
import { useT } from '@/i18n';
import { ConfirmSheet, EmptyState, GridSelector, Icon, MediaView, Screen, Txt } from '@/components/ui';
import { ME } from '@/data/repositories';
import { toast } from '@/store/useToast';
import { useBp } from '@/hooks/useBp';

export default function History() {
  const { t } = useT();
  const { desktop } = useBp();
  const me = useMe();
  const history = useStore((s) => s.history).filter((h) => h.userId === ME).sort((a, b) => b.createdAt - a.createdAt);
  const chats = useStore((s) => s.conversations).filter((c) => c.userId === ME).sort((a, b) => b.updatedAt - a.updatedAt);
  const tools = useStore((s) => s.tools);
  const { notifications, bannerDismissed, set } = useLocal();
  const [tab, setTab] = useViewState<'designs' | 'chats'>('tab', 'designs');
  const [selecting, setSelecting] = useViewState('selecting', false);
  const [sel, setSel] = useViewState<string[]>('sel', []);
  const [confirm, setConfirm] = useViewState('confirm', false);
  void me;

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const exit = () => { setSelecting(false); setSel([]); };
  const del = async () => {
    await useStore.getState().removeMany(tab === 'designs' ? 'history' : 'conversations', sel);
    exit();
  };
  const enableNotif = () => { set({ notifications: true, bannerDismissed: true }); toast(t('notif.enabled')); };

  const header = (
    <View className="flex-row items-center justify-between h-14">
      <Txt className="text-[26px] font-black">{selecting ? t('history.selected', { count: sel.length }) : t('history.title')}</Txt>
      <View className="flex-row items-center gap-3">
        <Pressable testID="select-toggle" onPress={() => (selecting ? exit() : setSelecting(true))} className={`px-4 h-8 rounded-lg items-center justify-center ${selecting ? 'bg-surface2' : 'bg-primary'} active:opacity-80`}>
          <Txt className={`font-bold text-[13px] ${selecting ? 'text-fg' : 'text-onprimary'}`}>{selecting ? t('history.cancel') : t('history.select')}</Txt>
        </Pressable>
        <Pressable testID="open-settings" onPress={() => router.push('/settings')} hitSlop={8}><Icon name="cog-outline" size={24} /></Pressable>
      </View>
    </View>
  );

  const toolOf = (id?: string) => tools.find((x) => x.id === id);

  return (
    <Screen header={header} bottomInset={selecting ? 90 : 16} footer={selecting ? (
      <Pressable testID="delete-selected" disabled={!sel.length} onPress={() => setConfirm(true)} className={`h-12 rounded-full items-center justify-center flex-row gap-2 ${sel.length ? 'bg-danger' : 'bg-surface2'}`}>
        <Icon name="trash-can-outline" size={20} color={sel.length ? '#fff' : undefined} tone="muted" />
        <Txt className={`font-bold ${sel.length ? 'text-white' : 'text-muted'}`}>{t('history.deleteSel')}</Txt>
      </Pressable>
    ) : undefined}>
      {!notifications && !bannerDismissed ? (
        <Animated.View entering={FadeInDown.duration(300)} className="flex-row items-center gap-3 bg-soft rounded-2xl p-3.5 mt-1 mb-3">
          <Icon name="bell-ring-outline" size={22} tone="fg" />
          <Txt className="flex-1 text-[13px] font-semibold leading-[18px]">{t('history.banner')}</Txt>
          <Pressable testID="banner-enable" onPress={enableNotif} className="w-8 h-8 rounded-full bg-primary items-center justify-center"><Icon name="chevron-right" size={18} tone="onprimary" flip /></Pressable>
          <Pressable onPress={() => set({ bannerDismissed: true })} hitSlop={8}><Icon name="close" size={16} tone="muted" /></Pressable>
        </Animated.View>
      ) : null}

      <View className="flex-row bg-surface2 rounded-xl p-1 mb-4">
        {(['designs', 'chats'] as const).map((k) => (
          <Pressable key={k} testID={`htab-${k}`} onPress={() => { setTab(k); exit(); }} className={`flex-1 h-9 rounded-lg items-center justify-center ${tab === k ? 'bg-surface' : ''}`}>
            <Txt className={`text-[14px] ${tab === k ? 'font-extrabold' : 'text-muted font-semibold'}`}>{t(k === 'designs' ? 'history.designs' : 'history.assistants')}</Txt>
          </Pressable>
        ))}
      </View>

      {tab === 'designs' ? (
        history.length === 0 ? (
          <EmptyState title={t('history.emptyDesigns')} subtitle={t('history.emptyDesignsSub')} action={t('history.start')} onAction={() => router.navigate('/')} />
        ) : (
          <GridSelector items={history} cols={{ m: 2, t: 3, d: 4 }} gap={10} renderItem={(h) => {
            const on = sel.includes(h.id);
            const pending = h.status === 'pending';
            return (
              <Pressable testID={`hist-${h.id}`} onPress={() => {
                if (selecting) return toggle(h.id);
                if (pending) { toast(t('result.pending')); return; }
                router.push({ pathname: '/result/[id]', params: { id: h.id } });
              }} onLongPress={() => { setSelecting(true); toggle(h.id); }} className="active:opacity-90">
                <MediaView uri={h.after ?? h.before} className="rounded-xl" style={{ aspectRatio: 1 }}>
                  {pending ? <View className="absolute inset-0 bg-black/45 items-center justify-center gap-1"><Icon name="whatsapp" size={26} color="#25D366" /><Txt className="text-white text-[11px] font-bold px-2 text-center">{t('history.pending')}</Txt></View> : null}
                  <View className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-black/40"><Txt className="text-white text-[11px] font-semibold" numberOfLines={1}>{toolOf(h.draft.toolId)?.title.fr ?? ''}</Txt></View>
                  {selecting ? <View className={`absolute top-2 end-2 w-6 h-6 rounded-full items-center justify-center border-2 ${on ? 'bg-primary border-primary' : 'border-white bg-black/30'}`}>{on ? <Icon name="check" size={14} tone="onprimary" /> : null}</View> : null}
                </MediaView>
              </Pressable>
            );
          }} />
        )
      ) : chats.length === 0 ? (
        <EmptyState icon="message-text-outline" title={t('history.emptyChats')} subtitle={t('history.emptyChatsSub')} />
      ) : (
        <View style={{ maxWidth: desktop ? 720 : undefined }}>
          {chats.map((c) => {
            const on = sel.includes(c.id);
            const last = c.messages[c.messages.length - 1];
            return (
              <Pressable key={c.id} testID={`chat-${c.id}`} onPress={() => (selecting ? toggle(c.id) : router.push({ pathname: '/chat/[id]', params: { id: c.id } }))} className="flex-row items-center gap-3 p-3 mb-2 rounded-2xl bg-surface2 active:opacity-80">
                {selecting ? <View className={`w-6 h-6 rounded-full items-center justify-center border-2 ${on ? 'bg-primary border-primary' : 'border-line'}`}>{on ? <Icon name="check" size={14} tone="onprimary" /> : null}</View> : <View className="w-10 h-10 rounded-full bg-primary items-center justify-center"><Icon name="face-agent" size={22} tone="onprimary" /></View>}
                <View className="flex-1"><Txt className="font-bold text-[14px]" numberOfLines={1}>{c.title}</Txt><Txt className="text-muted text-[12px]" numberOfLines={1}>{last?.text || '📷'}</Txt></View>
              </Pressable>
            );
          })}
        </View>
      )}
      <ConfirmSheet visible={confirm} onClose={() => setConfirm(false)} onConfirm={del} message={t('history.confirm')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} />
    </Screen>
  );
}
