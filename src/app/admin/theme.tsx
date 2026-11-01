import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { useStore } from '@/store/useStore';
import { ColorPicker } from '@/components/admin/ColorPicker';
import { useBp } from '@/hooks/useBp';
import { useL, useT } from '@/i18n';
import { ThemeScope } from '@/theme/ThemeProvider';
import { CUSTOM_KEYS, PRESETS, PRESET_BY_ID, PRESET_CATEGORIES, type PresetCategory } from '@/theme/tokens';
import { toast } from '@/store/useToast';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { useViewState } from '@/hooks/useViewState';

const CKEY: Record<string, string> = { primary: 'colorPrimary', bg: 'colorBg', surface: 'colorSurface', fg: 'colorFg', ink: 'colorInk' };

function Preview() {
  const { t } = useT();
  return (
    <View className="flex-1 p-4 gap-3 rounded-2xl" style={{ minHeight: 360 }}>
      <View className="flex-row items-center justify-between">
        <Txt className="font-extrabold text-[18px]">Dwira</Txt>
        <View className="bg-primary rounded-full px-3 h-8 flex-row items-center gap-1.5"><Icon name="star-four-points" size={14} tone="onprimary" /><Txt className="text-onprimary font-bold text-[13px]">1</Txt></View>
      </View>
      <View className="flex-row gap-2">
        <View className="bg-ink rounded-full px-3 h-8 items-center justify-center"><Txt className="text-onink font-bold text-[12px]">{t('common.all')}</Txt></View>
        <View className="bg-surface2 border border-line rounded-full px-3 h-8 items-center justify-center"><Txt className="text-muted font-semibold text-[12px]">{t('tabs.explore')}</Txt></View>
      </View>
      <View className="bg-surface border border-line rounded-2xl p-3">
        <View className="h-20 rounded-xl bg-surface2 mb-2" />
        <Txt className="font-bold">{t('admin.theme.title')}</Txt>
        <Txt className="text-muted text-[12px] mb-3">{t('admin.theme.preview')}</Txt>
        <View className="bg-ink rounded-full h-10 items-center justify-center"><Txt className="text-onink font-bold">{t('common.try')}</Txt></View>
      </View>
      <View className="flex-row gap-2">
        <View className="bg-primary rounded-full px-4 h-9 items-center justify-center"><Txt className="text-onprimary font-bold text-[13px]">{t('common.save')}</Txt></View>
        <View className="bg-soft rounded-full px-4 h-9 items-center justify-center"><Txt className="font-bold text-[13px]">{t('common.new')}</Txt></View>
        <View className="bg-danger rounded-full px-3 h-9 items-center justify-center"><Txt className="text-white font-bold text-[13px]">!</Txt></View>
      </View>
      <View className="bg-surface border border-line rounded-full p-1 flex-row justify-around">
        <View className="bg-ink rounded-full h-9 px-4 flex-row items-center gap-1.5"><Icon name="home-variant" size={17} tone="onink" /><Txt className="text-onink text-[12px] font-bold">{t('tabs.home')}</Txt></View>
        <View className="h-9 w-9 items-center justify-center"><Icon name="compass-outline" size={19} tone="muted" /></View>
        <View className="h-9 w-9 items-center justify-center"><Icon name="clock-outline" size={19} tone="muted" /></View>
      </View>
    </View>
  );
}

function Swatch({ id, active, onPress }: { id: string; active: boolean; onPress: () => void }) {
  const L = useL();
  const { desktop } = useBp();
  const p = PRESET_BY_ID[id];
  const c = p.tokens;
  return (
    <Pressable testID={`theme-${id}`} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={onPress}
      className={`rounded-2xl border-2 p-2 ${active ? 'border-primary' : 'border-line'} bg-surface`} style={{ width: desktop ? 150 : '100%', minWidth: 0 }}>
      <View className="rounded-xl overflow-hidden p-2 gap-1.5" style={{ backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, height: 84 }}>
        <View className="flex-row items-center justify-between"><View style={{ width: 34, height: 6, borderRadius: 3, backgroundColor: c.fg }} /><View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.primary }} /></View>
        <View style={{ flex: 1, borderRadius: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, padding: 5, gap: 3 }}>
          <View style={{ width: '60%', height: 4, borderRadius: 2, backgroundColor: c.muted }} />
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 'auto' }}>
            <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: c.ink }} />
            <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: c.primary }} />
          </View>
        </View>
      </View>
      <View className="flex-row items-center gap-1 mt-2 px-0.5">
        <Txt numberOfLines={1} className="font-bold text-[13px] flex-1">{L(p.name)}</Txt>
        {active ? <Icon name="check-circle" size={16} tone="primary" /> : null}
      </View>
    </Pressable>
  );
}

export default function ThemeAdmin() {
  const contentReady = useStore((s) => s.contentReady);
  const { t } = useT();
  const { desktop } = useBp();
  const { draft: cfg, set: setCfg, save: submitDraft, dirty } = useDraftDoc('theme');
  const [cat, setCat] = useViewState<PresetCategory | 'all'>('theme-category', 'all');
  const groups = useMemo(() => PRESET_CATEGORIES.filter((c) => cat === 'all' || c === cat).map((c) => ({ c, items: PRESETS.filter((p) => p.category === c) })), [cat]);
  const save = async () => { if (await submitDraft()) toast(t('admin.crud.saved')); };
  const pill = (on: boolean) => `px-3.5 h-9 rounded-full items-center justify-center ${on ? 'bg-ink' : 'bg-surface2'}`;

  if (!contentReady) return <AdminPage title={t('admin.theme.title')}><AdminLoading /></AdminPage>;
  return (
    <AdminPage title={t('admin.theme.title')} right={<Button testID="theme-save" size="sm" icon="check" title={t('improve.submit')} disabled={!dirty} onPress={save} />}>
      <View className={desktop ? 'flex-row gap-6 items-start' : 'gap-5'}>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Card className="p-4 mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <Txt className="font-extrabold text-[16px]">{t('admin.theme.presets')}</Txt>
              <Txt className="text-muted text-[12px]">{t('admin.theme.count', { count: PRESETS.length })}</Txt>
            </View>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {(['all', ...PRESET_CATEGORIES] as const).map((c) => (
                <Pressable key={c} testID={`themecat-${c}`} onPress={() => setCat(c)} className={pill(cat === c)}>
                  <Txt className={`text-[13px] font-semibold ${cat === c ? 'text-onink' : ''}`}>{c === 'all' ? t('admin.theme.all') : t(`admin.theme.cat.${c}`)}</Txt>
                </Pressable>
              ))}
            </View>
            {groups.map(({ c, items }) => (
              <View key={c} className="mb-4">
                <Txt className="text-muted text-[12px] font-bold uppercase tracking-wide mb-2">{t(`admin.theme.cat.${c}`)}</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
                  {items.map((p) => <View key={p.id} style={{ width: desktop ? 158 : '50%', padding: 4, minWidth: 0 }}><Swatch id={p.id} active={cfg.active === p.id} onPress={() => setCfg((x) => ({ ...x, active: p.id }))} /></View>)}
                </View>
              </View>
            ))}
          </Card>
          <Card className="p-4">
            <Pressable testID="theme-custom" onPress={() => setCfg((x) => ({ ...x, active: 'custom' }))} className="flex-row items-center gap-2 mb-1">
              <Icon name={cfg.active === 'custom' ? 'radiobox-marked' : 'radiobox-blank'} size={20} tone={cfg.active === 'custom' ? 'primary' : 'muted'} />
              <Txt className="font-extrabold text-[16px]">{t('admin.theme.custom')}</Txt>
            </Pressable>
            <Txt className="text-muted text-[12px] mb-3">{t('admin.theme.customDesc')}</Txt>
            {cfg.active === 'custom' ? CUSTOM_KEYS.map((k) => (
              <ColorPicker key={k} label={t(`admin.theme.${CKEY[k]}`)} value={cfg.custom[k]} onChange={(v) => setCfg((x) => ({ ...x, custom: { ...x.custom, [k]: v } }))} />
            )) : null}
          </Card>
        </View>
        <View style={[{ width: desktop ? 340 : '100%' }, desktop ? ({ position: 'sticky', top: 16 } as any) : null]}>
          <Txt className="text-muted text-[13px] font-semibold mb-2">{t('admin.theme.preview')}</Txt>
          <View className="rounded-2xl overflow-hidden border border-line" testID="theme-preview"><ThemeScope config={cfg} className="flex-none"><Preview /></ThemeScope></View>
          <View className="flex-row items-center gap-1.5 mt-2"><Icon name="shield-check-outline" size={15} tone="success" /><Txt className="text-muted text-[12px]">{t('admin.theme.readable')}</Txt></View>
        </View>
      </View>
    </AdminPage>
  );
}
