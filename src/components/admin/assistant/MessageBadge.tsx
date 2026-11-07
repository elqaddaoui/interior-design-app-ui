import React from 'react';
import { View } from 'react-native';
import { Txt } from '@/components/ui/Txt';
import { StateBadge } from './ui';
import { useT } from '@/i18n';
import type { ReplyMeta } from '@/data/types';

/** Under an assistant message in the admin inbox: which automation or provider/model answered, and how. Visitors never see it. */
export function MessageBadge({ id, meta }: { id: string; meta: ReplyMeta }) {
  const { t } = useT();
  const who = meta.status === 'automation' ? meta.automationName || meta.label : [meta.label, meta.model].filter(Boolean).join(' · ');
  const tried = (meta.tried ?? []).map((x) => `${x.label} (${t(`asx.p.reason.${x.reason}`, { defaultValue: x.reason })})`).join(', ');
  return (
    <View testID={`admin-msg-meta-${id}`} className="mt-1 gap-0.5" accessibilityLabel={t('asx.m.info')}>
      <View className="flex-row items-center gap-1.5 flex-wrap">
        <StateBadge state={meta.status} text={t(`asx.m.status.${meta.status}`)} />
        <Txt className="text-[11px] text-muted" numberOfLines={1} style={{ flexShrink: 1 }}>{t('asx.m.by')} {who}</Txt>
      </View>
      {tried ? <Txt className="text-[11px] text-muted">{t('asx.m.tried', { list: tried })}</Txt> : null}
    </View>
  );
}
