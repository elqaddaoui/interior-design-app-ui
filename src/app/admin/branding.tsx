import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Input, Txt } from '@/components/ui';
import { AdminPage } from '@/components/admin/AdminShell';
import { ImageField } from '@/components/admin/ImageField';
import { ColorPicker } from '@/components/admin/ColorPicker';
import { Field } from '@/components/admin/FormModal';
import { BrandHeader } from '@/components/BrandHeader';
import { ARABIC_FONTS, FRENCH_FONTS } from '@/components/ui/Txt';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { toast } from '@/store/useToast';

export default function Branding() {
  const { t } = useT(); const L = useL(); const s = useStore();
  const { draft, set: setDraft, save: submitDraft } = useDraftDoc('branding');
  const [busy, setBusy] = useState(false);
  const ctx = { s, L, t };
  const set = (key: string, value: any) => setDraft((b) => ({ ...b, [key]: value }));
  const choice = (key: string, values: string[], fallback: string) => <Field f={{ kind: 'select', key, label: t(`improve.${key}`), options: () => values.map((value) => ({ value, label: t(`improve.${value}`, { defaultValue: value }) })) }} value={(draft as any)[key] ?? fallback} onChange={(v) => set(key, v)} ctx={ctx} />;
  const save = async () => {
    setBusy(true);
    try { setDraft({ ...draft, appName: draft.appName.trim() || 'Dwira', logoSize: Math.min(40, Math.max(18, draft.logoSize ?? 28)), logoSpacing: Math.min(6, Math.max(-2, draft.logoSpacing ?? -0.5)) }); await submitDraft(); toast(t('admin.crud.saved')); }
    catch { toast(t('improve.saveError')); } finally { setBusy(false); }
  };
  return (
    <AdminPage title={t('admin.nav.branding')} max={900}>
      <Card className="p-5 mb-4">
        <Txt className="font-bold text-[16px] mb-3">{t('admin.theme.preview')}</Txt>
        <BrandHeader branding={draft} />
      </Card>
      <Card className="p-5">
        <Input testID="brand-name" label={t('admin.brand.appName')} value={draft.appName} onChangeText={(v) => set('appName', v)} />
        {choice('logoMode', ['text', 'image'], draft.logoUri ? 'image' : 'text')}
        {(draft.logoMode ?? (draft.logoUri ? 'image' : 'text')) === 'image' ? <ImageField label={t('admin.brand.logo')} value={draft.logoUri} onChange={(v) => set('logoUri', v)} /> : <>
          {choice('logoFont', [...new Set([...FRENCH_FONTS, ...ARABIC_FONTS])], 'Lora')}
          <ColorPicker label={t('improve.logoColor')} value={draft.logoColor || ''} onChange={(v) => set('logoColor', v)} />
          <Button size="sm" variant="soft" title={t('improve.themeColor')} onPress={() => set('logoColor', '')} />
          <View className="h-3" />
          <Input label={t('improve.logoSize')} keyboardType="numeric" value={String(draft.logoSize ?? 28)} onChangeText={(v) => set('logoSize', Number(v) || 28)} />
          <Input label={t('improve.logoSpacing')} keyboardType="numeric" value={String(draft.logoSpacing ?? -0.5)} onChangeText={(v) => set('logoSpacing', Number(v) || 0)} />
          <Field f={{ kind: 'bool', key: 'logoItalic', label: t('improve.logoItalic') }} value={draft.logoItalic} onChange={(v) => set('logoItalic', v)} ctx={ctx} />
        </>}
        {choice('logoPosition', ['left', 'center', 'right'], 'left')}
        {choice('logoStyle', ['minimal', 'signature', 'badge'], 'signature')}
        <Button testID="brand-save" title="Submit" onPress={save} loading={busy} />
      </Card>
    </AdminPage>
  );
}
