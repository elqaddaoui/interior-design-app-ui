import React from 'react';
import { View } from 'react-native';
import { Checkbox } from '@/components/ui/Checkbox';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { AREAS, type Area, type Level, type Permissions } from '@/lib/access';
import { ADMIN_GROUPS } from '@/lib/adminNav';
import { Choice, useSa } from './ui';

export type Grant = { permissions: Permissions; ui: string[] };

/** The access matrix: a level per area (what the server enforces) and the admin pages that show up in the menu. */
export function PermissionEditor({ value, onChange, disabled }: { value: Grant; onChange: (next: Grant) => void; disabled?: boolean }) {
  const { t } = useSa();
  const { t: tr } = useT();
  const setLevel = (area: Area, level: Level | 'none') => {
    const permissions = { ...value.permissions };
    if (level === 'none') delete permissions[area]; else permissions[area] = level;
    onChange({ ...value, permissions });
  };
  const toggle = (key: string) => onChange({ ...value, ui: value.ui.includes(key) ? value.ui.filter((k) => k !== key) : [...value.ui, key] });
  const keys = ADMIN_GROUPS.flatMap((g) => g.items.map((i) => i.key));
  const setAll = (on: boolean) => onChange({ ...value, ui: on ? keys : ['dashboard'] });

  return (
    <View testID="sa-perm-editor" pointerEvents={disabled ? 'none' : 'auto'} style={{ opacity: disabled ? 0.6 : 1 }}>
      <Txt className="text-[14px] font-extrabold mb-0.5">{t('permissions')}</Txt>
      <Txt className="text-muted text-[12px] mb-3">{t('permissionsHint')}</Txt>
      {AREAS.map((area) => (
        <Choice<Level | 'none'> key={area} testID={`sa-perm-${area}`} label={t(`area_${area}`)} value={value.permissions[area] ?? 'none'} onChange={(l) => setLevel(area, l)}
          options={[{ key: 'none', label: t('lvNone') }, { key: 'view', label: t('lvView') }, { key: 'manage', label: t('lvManage') }]} />
      ))}

      <View className="flex-row items-center justify-between mt-2 mb-0.5" style={{ gap: 8 }}>
        <Txt className="text-[14px] font-extrabold flex-1">{t('uiAccess')}</Txt>
        <Txt testID="sa-ui-all" accessibilityRole="button" onPress={() => setAll(true)} className="text-[12px] font-bold text-muted">{t('allPages')}</Txt>
        <Txt testID="sa-ui-none" accessibilityRole="button" onPress={() => setAll(false)} className="text-[12px] font-bold text-muted">{t('noPages')}</Txt>
      </View>
      <Txt className="text-muted text-[12px] mb-2">{t('uiAccessHint')}</Txt>
      {ADMIN_GROUPS.map((g) => (
        <View key={g.key} className="mb-2">
          <Txt className="text-muted text-[11px] font-extrabold uppercase mb-0.5">{tr(`admin.group.${g.key}`)}</Txt>
          <View className="flex-row flex-wrap" style={{ columnGap: 8 }}>
            {g.items.map((item) => (
              <View key={item.key} style={{ flexBasis: 200, flexGrow: 1 }}>
                <Checkbox testID={`sa-ui-${item.key}`} state={item.key === 'dashboard' ? true : value.ui.includes(item.key)} disabled={item.key === 'dashboard'} onPress={() => toggle(item.key)}
                  label={tr(`admin.nav.${item.key}`)} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
