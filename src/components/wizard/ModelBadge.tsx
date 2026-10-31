import React from 'react';
import { Pressable, View } from 'react-native';
import { useStore } from '@/store/useStore';
import { useT } from '@/i18n';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useAiStatus } from '@/lib/aiStatus';
import { resolveModelId } from '@/lib/models';
import type { Draft, Tool } from '@/data/types';

/**
 * Shows which AI model will draw the design. The model the admin configured for the tool is the default; when the admin
 * enables the picker (Admin > AI models) the client can switch between the models that tool allows.
 * A model without an `engine` is handled by the free automatic chain, so the badge names the model that really runs first.
 */
export function ModelBadge({ tool, draft, onChange, hasPhoto }: { tool: Tool; draft: Draft; onChange: (modelId: string) => void; hasPhoto: boolean }) {
  const { t } = useT();
  const models = useStore((s) => s.models);
  const picker = useStore((s) => s.doc.settings.aiModelPicker) === true;
  const status = useAiStatus();
  const allowed = [...models].filter((m) => m.enabled && m.visible !== false && tool.modelIds.includes(m.id)).sort((a, b) => a.order - b.order);
  const activeId = draft.modelId && allowed.some((m) => m.id === draft.modelId) ? draft.modelId : resolveModelId(tool, models);
  const label = (id?: string) => {
    const m = models.find((x) => x.id === id);
    if (m?.engine) return m.name;
    const auto = (hasPhoto ? status?.chain.image : status?.chain.text)?.[0];
    return auto || m?.name || t('wizard.modelAuto');
  };
  return (
    <View testID="model-badge" className="mt-6">
      <View className="flex-row items-center gap-2">
        <Icon name="creation" size={16} tone="muted" />
        <Txt className="text-[12.5px] text-muted">{t('wizard.modelActive')}</Txt>
        <Txt testID="model-active" className="text-[13px] font-extrabold flex-1" numberOfLines={1}>{status && !status.live ? t('wizard.modelDemo') : label(activeId)}</Txt>
      </View>
      {picker && allowed.length > 1 ? (
        <View className="flex-row flex-wrap gap-2 mt-2.5">
          {allowed.map((m) => {
            const on = m.id === activeId;
            return (
              <Pressable key={m.id} testID={`model-${m.id}`} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(m.id)}
                className={`px-3.5 h-9 rounded-full items-center justify-center border ${on ? 'bg-primary border-primary' : 'bg-surface2 border-transparent'} active:opacity-80`}>
                <Txt className={`text-[13px] font-semibold ${on ? 'text-onprimary' : ''}`} numberOfLines={1}>{label(m.id)}</Txt>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
