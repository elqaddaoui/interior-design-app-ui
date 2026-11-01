import React from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ConfirmSheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { RightClick, sep, type MenuItem } from '@/components/admin/ContextMenu';
import { StatusPill, useCampaignError } from '@/components/admin/campaigns/parts';
import { useT, useL } from '@/i18n';
import { formatWhen } from '@/lib/campaignTime';
import { useAdminCampaigns, type Campaign } from '@/store/useAdminCampaigns';
import { toast } from '@/store/useToast';

const KIND_ICON = { once: 'send-outline', recurring: 'calendar-sync-outline', trigger: 'lightning-bolt-outline' } as const;

function Stat({ icon, text, tone = 'muted' }: { icon: string; text: string; tone?: 'muted' | 'success' | 'danger' }) {
  return <View className="flex-row items-center gap-1"><Icon name={icon} size={13} tone={tone} /><Txt className={`text-[12px] ${tone === 'muted' ? 'text-muted' : tone === 'success' ? 'text-success' : 'text-danger'}`}>{text}</Txt></View>;
}

/** One row per campaign. A single press opens the editor; the action buttons never open it. */
export function CampaignList({ items, kind, onOpen, onCreate }: { items: Campaign[]; kind: 'campaign' | 'automation'; onOpen: (c: Campaign) => void; onCreate: () => void }) {
  const { t } = useT();
  const l = useL();
  const store = useAdminCampaigns();
  const explain = useCampaignError();
  const [del, setDel] = React.useState<Campaign | null>(null);
  const [busy, setBusy] = React.useState('');
  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(id);
    try { await fn(); toast(t(done)); } catch (e) { toast(explain(e)); } finally { setBusy(''); }
  };
  if (!items.length) {
    return (
      <Card testID={`camp-empty-${kind}`} className="p-6 items-center gap-2">
        <View className="w-12 h-12 rounded-2xl bg-surface2 items-center justify-center"><Icon name={kind === 'automation' ? 'lightning-bolt-outline' : 'bell-plus-outline'} size={24} tone="muted" /></View>
        <Txt className="font-bold text-[15px]">{t(kind === 'automation' ? 'camp.emptyA' : 'camp.emptyC')}</Txt>
        <Txt className="text-muted text-[13px] text-center">{t(kind === 'automation' ? 'camp.emptyASub' : 'camp.emptyCSub')}</Txt>
        <View className="mt-2"><Button testID={`camp-create-empty-${kind}`} size="sm" icon="plus" title={t(kind === 'automation' ? 'camp.newAutomation' : 'camp.newCampaign')} onPress={onCreate} /></View>
      </Card>
    );
  }
  return (
    <>
      <View className="gap-2.5">
        {items.map(c => {
          const live = c.status === 'scheduled' || c.status === 'active';
          const resumable = c.status === 'paused' || (c.kind !== 'once' && c.status === 'draft') || (c.kind === 'once' && c.status === 'draft');
          const when = c.nextAt && live ? `${t('camp.next')}: ${formatWhen(c.nextAt)}` : c.lastRunAt ? `${t('camp.last')}: ${formatWhen(c.lastRunAt)}` : '';
          const text = l(c.title) || l(c.body);
          const menu = (): MenuItem[] => [
            { key: 'edit', label: t('common.edit'), icon: 'pencil-outline', onPress: () => onOpen(c) },
            { key: 'duplicate', label: t('camp.duplicate'), icon: 'content-copy', disabled: !!busy, onPress: () => { void act(c.id, () => store.duplicate(c.id), 'camp.duplicated'); } },
            ...(live ? [{ key: 'pause', label: t('camp.pause'), icon: 'pause-circle-outline', disabled: !!busy, onPress: () => { void act(c.id, () => store.pause(c.id), 'camp.pausedOk'); } } as MenuItem]
              : resumable ? [{ key: 'resume', label: t('camp.resume'), icon: 'play-circle-outline', disabled: !!busy, onPress: () => { void act(c.id, () => store.activate(c.id), 'camp.activated'); } } as MenuItem] : []),
            sep('s1'),
            { key: 'delete', label: t('camp.delete'), icon: 'trash-can-outline', danger: true, onPress: () => setDel(c) },
          ];
          return (
            <RightClick key={c.id} items={menu}><Card testID={`camp-row-${c.id}`} className="overflow-hidden">
              <Pressable testID={`camp-open-${c.id}`} accessibilityRole="button" onPress={() => onOpen(c)} className="p-3.5 gap-2 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <View className="w-10 h-10 rounded-xl bg-soft items-center justify-center"><Icon name={KIND_ICON[c.kind]} size={20} tone="primary" /></View>
                  <View className="flex-1" style={{ minWidth: 0 }}>
                    <Txt className="font-bold text-[15px]" numberOfLines={1}>{c.name}</Txt>
                    <Txt className="text-muted text-[12.5px]" numberOfLines={1}>{text}</Txt>
                  </View>
                  <StatusPill status={c.status} testID={`camp-status-${c.id}`} />
                </View>
                <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
                  {c.kind === 'trigger' && c.trigger ? <Stat icon="flash-outline" text={t(`camp.events.${c.trigger.event}`)} /> : null}
                  {c.kind === 'recurring' && c.schedule?.freq ? <Stat icon="repeat" text={`${t(`camp.freq.${c.schedule.freq}`)} · ${c.schedule.time}`} /> : null}
                  {when ? <Stat icon="clock-outline" text={when} /> : null}
                  {c.stats.sent ? <Stat icon="check-circle-outline" tone="success" text={t('camp.sentTo', { n: c.stats.sent })} /> : null}
                  {c.stats.pending ? <Stat icon="timer-sand" text={t('camp.pending', { n: c.stats.pending })} /> : null}
                  {c.stats.failed ? <Stat icon="alert-circle-outline" tone="danger" text={t('camp.failed', { n: c.stats.failed })} /> : null}
                  {c.stats.skipped ? <Stat icon="debug-step-over" text={t('camp.skipped', { n: c.stats.skipped })} /> : null}
                </View>
              </Pressable>
              <View className="flex-row items-center justify-end gap-1 px-2 pb-2">
                {live ? <Button testID={`camp-pause-${c.id}`} size="sm" variant="ghost" icon="pause-circle-outline" title={t('camp.pause')} loading={busy === c.id} onPress={() => { void act(c.id, () => store.pause(c.id), 'camp.pausedOk'); }} />
                  : resumable ? <Button testID={`camp-resume-${c.id}`} size="sm" variant="ghost" icon="play-circle-outline" title={t('camp.resume')} loading={busy === c.id} onPress={() => { void act(c.id, () => store.activate(c.id), 'camp.activated'); }} /> : null}
                <Button testID={`camp-dup-${c.id}`} size="sm" variant="ghost" icon="content-copy" title={t('camp.duplicate')} disabled={!!busy} onPress={() => { void act(c.id, () => store.duplicate(c.id), 'camp.duplicated'); }} />
                <Pressable testID={`camp-del-${c.id}`} accessibilityRole="button" accessibilityLabel={t('camp.delete')} onPress={() => setDel(c)} hitSlop={6} className="w-9 h-9 rounded-full items-center justify-center active:opacity-70"><Icon name="trash-can-outline" size={18} tone="danger" /></Pressable>
              </View>
            </Card></RightClick>
          );
        })}
      </View>
      <ConfirmSheet visible={!!del} onClose={() => setDel(null)} message={t('camp.deleteAsk', { name: del?.name ?? '' })} confirmLabel={t('camp.confirm')} cancelLabel={t('camp.cancel')}
        onConfirm={() => { const id = del?.id; if (id) void act(id, () => store.remove(id), 'camp.deleted'); }} />
    </>
  );
}
