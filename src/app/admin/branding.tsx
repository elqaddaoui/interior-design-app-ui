import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Toggle';
import { Txt, ARABIC_FONTS, FRENCH_FONTS } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { useStore } from '@/store/useStore';
import { ImageField } from '@/components/admin/ImageField';
import { ColorPicker } from '@/components/admin/ColorPicker';
import { FieldLabel, OptionTile, Section, Stepper } from '@/components/admin/branding/parts';
import { BrandHeader } from '@/components/BrandHeader';
import { ensureFont, useFontFamily } from '@/lib/fonts';
import { useT } from '@/i18n';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { toast } from '@/store/useToast';

const FONTS = [...new Set(['system', 'Lora', 'NotoNaskhArabic', ...FRENCH_FONTS, ...ARABIC_FONTS])];
const POSITIONS = [['left', 'format-align-left'], ['center', 'format-align-center'], ['right', 'format-align-right']] as const;
const STYLES = ['minimal', 'signature', 'badge'] as const;

/** One font row; the specimen uses the brand name so the admin sees the real result. */
function FontRow({ font, name, selected, onSelect }: { font: string; name: string; selected: boolean; onSelect: () => void }) {
  const family = useFontFamily(font === 'system' ? undefined : font);
  return (
    <Pressable testID={`chip-${font}`} accessibilityRole="radio" accessibilityState={{ selected }} onPress={onSelect}
      className={`flex-row items-center gap-3 rounded-xl border px-3 py-2 mb-1.5 ${selected ? 'border-primary bg-soft' : 'border-line bg-surface'}`}>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Txt className="text-muted text-[11px] font-semibold" numberOfLines={1}>{font}</Txt>
        <Txt style={{ fontFamily: family, fontSize: 22, lineHeight: 32, fontWeight: '800' }} numberOfLines={1}>{name || 'Dwira'}</Txt>
      </View>
      <Icon name={selected ? 'check-circle' : 'radiobox-blank'} size={20} tone={selected ? 'primary' : 'muted'} />
    </Pressable>
  );
}

export default function Branding() {
  const contentReady = useStore((s) => s.contentReady);
  const { t } = useT();
  const { draft, set: setDraft, save: submitDraft, discard, dirty } = useDraftDoc('branding');
  const [busy, setBusy] = useState(false);
  const [fonts, setFonts] = useState(false);
  const [width, setWidth] = useState(0);
  const wide = width >= 760;
  const set = (key: string, value: any) => setDraft((b) => ({ ...b, [key]: value }));
  const mode = (draft.logoMode ?? (draft.logoUri ? 'image' : 'text')) as 'text' | 'image';
  const font = draft.logoFont ?? 'Lora';
  const size = Math.min(40, Math.max(18, draft.logoSize ?? 28));
  const spacing = Math.min(6, Math.max(-2, draft.logoSpacing ?? -0.5));
  const position = draft.logoPosition ?? 'left';
  const style = draft.logoStyle ?? 'signature';
  const save = async () => {
    setBusy(true);
    try { setDraft({ ...draft, appName: draft.appName.trim() || 'Dwira', logoSize: size, logoSpacing: spacing }); if (await submitDraft()) toast(t('admin.crud.saved')); }
    catch { toast(t('improve.saveError')); } finally { setBusy(false); }
  };

  const preview = (
    <Card testID="brand-preview" className="p-3 mb-3" style={Platform.OS === 'web' && wide ? ({ position: 'sticky', top: 8 } as any) : undefined}>
      <View className="flex-row items-center gap-2 mb-2">
        <Icon name="eye-outline" size={16} tone="muted" />
        <Txt className="flex-1 text-[12px] font-bold text-muted">{t('admin.theme.preview')}</Txt>
        {dirty ? <View className="bg-soft rounded-full px-2.5 py-0.5"><Txt className="text-[11px] font-bold">{t('improve.unsavedTitle')}</Txt></View> : null}
      </View>
      <View className="bg-bg rounded-xl border border-line px-3" style={{ minHeight: 72, justifyContent: 'center' }}>
        <BrandHeader branding={draft} actions={<View className="w-8 h-8 rounded-full bg-surface2 items-center justify-center"><Icon name="menu" size={16} /></View>} />
      </View>
      <Txt className="text-muted text-[11px] mt-2">{t('improve.brandPreviewHint')}</Txt>
    </Card>
  );

  const identity = (
    <Section icon="card-text-outline" title={t('improve.brandIdentity')} testID="brand-identity">
      <Input testID="brand-name" label={t('admin.brand.appName')} value={draft.appName} maxLength={40} onChangeText={(v) => set('appName', v)} />
      <FieldLabel>{t('improve.logoMode')}</FieldLabel>
      <View className="flex-row gap-2 mb-3">
        <OptionTile testID="chip-text" selected={mode === 'text'} label={t('improve.text')} visual={<Txt className="text-[20px] font-extrabold" style={{ lineHeight: 26 }}>Aa</Txt>} onPress={() => set('logoMode', 'text')} />
        <OptionTile testID="chip-image" selected={mode === 'image'} label={t('improve.image')} icon="image-outline" onPress={() => set('logoMode', 'image')} />
      </View>
      {mode === 'image' ? <ImageField label={t('admin.brand.logo')} value={draft.logoUri} onChange={(v) => set('logoUri', v)} /> : null}
    </Section>
  );

  const typography = mode === 'text' ? (
    <Section icon="format-font" title={t('improve.brandTypography')} testID="brand-typography">
      <FieldLabel>{t('improve.logoFont')}</FieldLabel>
      <Pressable testID="brand-font" accessibilityRole="button" onPress={() => setFonts(true)} className="flex-row items-center gap-2 rounded-xl border border-line bg-surface2 px-3 h-11 mb-3">
        <Txt className="flex-1 font-semibold" numberOfLines={1}>{font === 'system' ? t('improve.system') : font}</Txt>
        <Icon name="chevron-down" size={18} />
      </Pressable>
      <View className="flex-row gap-4 mb-3">
        <Stepper testID="brand-size" label={t('improve.logoSizeShort')} value={size} min={18} max={40} step={1} format={(v) => `${v}px`} onChange={(v) => set('logoSize', v)} />
        <Stepper testID="brand-spacing" label={t('improve.logoSpacingShort')} value={spacing} min={-2} max={6} step={0.5} onChange={(v) => set('logoSpacing', v)} />
      </View>
      <View className="flex-row items-center justify-between bg-surface2 rounded-xl px-3 h-11">
        <Txt className="font-semibold text-[14px] flex-1">{t('improve.logoItalic')}</Txt>
        <Toggle testID="sw-logoItalic" label={t('improve.logoItalic')} value={!!draft.logoItalic} onValueChange={(v) => set('logoItalic', v)} />
      </View>
    </Section>
  ) : null;

  const color = mode === 'text' ? (
    <Section icon="palette-outline" title={t('improve.logoColor')} testID="brand-color"
      right={draft.logoColor ? <Pressable testID="brand-color-reset" accessibilityRole="button" onPress={() => set('logoColor', '')} className="flex-row items-center gap-1 h-8 px-2.5 rounded-full bg-surface2"><Icon name="restore" size={14} /><Txt className="text-[12px] font-bold">{t('improve.themeColor')}</Txt></Pressable> : <View className="bg-soft rounded-full px-2.5 py-1"><Txt className="text-[11px] font-bold">{t('improve.usingTheme')}</Txt></View>}>
      <ColorPicker value={draft.logoColor || ''} onChange={(v) => set('logoColor', v)} compact />
    </Section>
  ) : null;

  const layout = (
    <Section icon="view-dashboard-outline" title={t('improve.brandLayout')} testID="brand-layout">
      <FieldLabel>{t('improve.logoPosition')}</FieldLabel>
      <View className="flex-row gap-2 mb-3" style={{ direction: 'ltr' } as any}>
        {POSITIONS.map(([key, icon]) => <OptionTile key={key} testID={`chip-${key}`} selected={position === key} icon={icon} label={t(`improve.${key}`)} onPress={() => set('logoPosition', key)} />)}
      </View>
      <FieldLabel>{t('improve.logoStyle')}</FieldLabel>
      <View className="flex-row gap-2">
        {STYLES.map((key) => <OptionTile key={key} testID={`chip-${key}`} selected={style === key} label={t(`improve.${key}`)}
          visual={<View style={{ alignItems: 'center', height: 30, justifyContent: 'center' }}>
            <View className={key === 'badge' ? 'bg-bg rounded-xl px-2.5' : ''}><Txt className="text-[16px] font-extrabold" style={{ lineHeight: 22 }}>Aa</Txt></View>
            {key === 'signature' ? <View className="bg-primary rounded-full" style={{ height: 3, width: 20, marginTop: -1 }} /> : null}
          </View>} onPress={() => set('logoStyle', key)} />)}
      </View>
    </Section>
  );

  const bar = (
    <Card className="p-2.5 rounded-2xl flex-row items-center gap-2" style={{ boxShadow: '0 6px 28px rgba(0,0,0,0.18)' } as any}>
      <View className="flex-1 flex-row items-center gap-1.5" style={{ minWidth: 0 }}>
        <Icon name={dirty ? 'circle-edit-outline' : 'check-circle-outline'} size={18} tone={dirty ? 'primary' : 'muted'} />
        <Txt className={`text-[12px] font-bold flex-1 ${dirty ? '' : 'text-muted'}`} numberOfLines={2}>{dirty ? t('improve.unsavedTitle') : t('improve.allSaved')}</Txt>
      </View>
      {dirty ? <Button testID="brand-discard" size="sm" variant="soft" title={t('improve.discard')} onPress={discard} disabled={busy} /> : null}
      <Button testID="brand-save" size="sm" title={t('improve.submit')} onPress={save} loading={busy} disabled={!dirty && !busy} />
    </Card>
  );

  if (!contentReady) return <AdminPage title={t('admin.nav.branding')}><AdminLoading /></AdminPage>;
  return (
    <AdminPage title={t('admin.nav.branding')} max={1000} floating={bar}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {wide ? (
          <View className="flex-row gap-4 items-start">
            <View style={{ flex: 1.15, minWidth: 0 }}>{identity}{typography}</View>
            <View style={{ flex: 1, minWidth: 0 }}>{preview}{layout}{color}</View>
          </View>
        ) : <>{preview}{identity}{typography}{color}{layout}</>}
      </View>
      <Sheet visible={fonts} onClose={() => setFonts(false)} title={t('improve.logoFont')}>
        {fonts ? FONTS.map((f) => <FontRow key={f} font={f} name={draft.appName} selected={f === font} onSelect={() => { ensureFont(f).catch(() => {}); set('logoFont', f); setFonts(false); }} />) : null}
      </Sheet>
    </AdminPage>
  );
}
