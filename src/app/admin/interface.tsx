import React from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, Icon, Toggle, Txt } from '@/components/ui';
import { AdminPage } from '@/components/admin/AdminShell';
import { NavPreview } from '@/components/admin/NavPreview';
import { useT } from '@/i18n';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { FontSelector } from '@/components/admin/FontSelector';
import { ExhibitionLayouts } from '@/components/admin/ExhibitionLayouts';
import { toast } from '@/store/useToast';
import { ARABIC_FONTS, FRENCH_FONTS } from '@/components/ui/Txt';
import { ENTITIES } from '@/admin/entities';
import type { AdminNavMode, UserNavStyle } from '@/data/types';

const USER: UserNavStyle[] = ['classic', 'floating', 'minimal'];
const ADMIN: AdminNavMode[] = ['rail', 'drawer', 'top'];

function Option({ id, active, title, desc, testID, onPress, children }: { id: string; active: boolean; title: string; desc: string; testID: string; onPress: () => void; children: React.ReactNode }) {
  const { t } = useT();
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={onPress} className={`flex-1 rounded-2xl border-2 p-3 ${active ? 'border-primary bg-soft' : 'border-line bg-surface'}`} style={{ minWidth: 200 }}>
      <View className="rounded-xl bg-surface2 overflow-hidden mb-3 items-center justify-center" style={{ height: 120 }}>{children}</View>
      <View className="flex-row items-center gap-2">
        <Txt className="font-extrabold text-[15px] flex-1">{title}</Txt>
        {active ? <View className="flex-row items-center gap-1 bg-primary rounded-full px-2 h-6"><Icon name="check" size={13} tone="onprimary" /><Txt className="text-onprimary text-[11px] font-bold">{t('admin.iface.current')}</Txt></View> : null}
      </View>
      <Txt className="text-muted text-[12px] mt-1">{desc}</Txt>
    </Pressable>
  );
}

export default function InterfaceAdmin() {
  const { t } = useT();
  const { draft: settings, patch: set, save, discard, dirty } = useDraftDoc('settings');
  const wrap = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 12 };
  return (
    <AdminPage title={t('admin.iface.title')} right={<Button testID="interface-submit" size="sm" title="Submit" disabled={!dirty} onPress={async () => { await save(); toast(t('admin.crud.saved')); }} />}>
      <Txt className="text-muted text-[12px] mb-3">Live preview · Changes are only saved when you submit.</Txt>
      <Card className="p-3 mb-3">
        <Txt className="font-extrabold text-[17px]">{t('admin.iface.userNav')}</Txt>
        <Txt className="text-muted text-[13px] mb-4">{t('admin.iface.userNavDesc')}</Txt>
        <View style={wrap}>
          {USER.map((id) => (
            <Option key={id} id={id} testID={`usernav-${id}`} active={(settings.userNavStyle ?? 'floating') === id} title={t(`admin.iface.${id}`)} desc={t(`admin.iface.${id}Desc`)} onPress={() => set({ userNavStyle: id })}>
              <NavPreview kind="user" id={id} />
            </Option>
          ))}
        </View>
      </Card>
      <Card className="p-3 mb-3">
        <Txt className="font-extrabold text-[17px]">{t('admin.iface.adminNav')}</Txt>
        <Txt className="text-muted text-[13px] mb-4">{t('admin.iface.adminNavDesc')}</Txt>
        <View style={wrap}>
          {ADMIN.map((id) => (
            <Option key={id} id={id} testID={`adminnav-${id}`} active={(settings.adminNavMode ?? 'drawer') === id} title={t(`admin.iface.${id}`)} desc={t(`admin.iface.${id}Desc`)} onPress={() => set({ adminNavMode: id })}>
              <NavPreview kind="admin" id={id} />
            </Option>
          ))}
        </View>
      </Card>
      <Card className="p-3 mb-3">
        <Txt className="font-extrabold text-[17px] mb-4">{t('improve.fonts')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <View style={{ flexGrow: 1, flexBasis: 280, minWidth: 0 }}><FontSelector language="fr" options={FRENCH_FONTS} value={settings.frenchFont} onChange={(frenchFont) => set({ frenchFont })} /></View>
          <View style={{ flexGrow: 1, flexBasis: 280, minWidth: 0 }}><FontSelector language="ar" options={ARABIC_FONTS} value={settings.arabicFont} onChange={(arabicFont) => set({ arabicFont })} /></View>
        </View>
      </Card>
      <Card className="p-3 mb-3">
        <Txt className="font-bold text-[17px] mb-1">Exhibition Planning</Txt>
        <Txt className="text-muted text-[12px] mb-3">Choose how your inspiration collection is presented.</Txt>
        <ExhibitionLayouts value={settings.galleryLayout ?? 'grid'} onChange={(galleryLayout) => set({ galleryLayout })} />
      </Card>
      <Card className="p-4">
        <Txt className="font-extrabold text-[17px] mb-2">{t('improve.bulkPanels')}</Txt>
        <Txt className="text-muted text-[13px] mb-4">{t('improve.bulkDesc')}</Txt>
        {Object.entries(ENTITIES).map(([key, cfg]) => <View key={key} className="flex-row items-center justify-between py-2 border-t border-line gap-3">
          <Txt className="flex-1 font-semibold">{t(`admin.nav.${cfg.navKey}`)}</Txt>
          <Toggle testID={`bulk-enable-${key}`} label={t(`admin.nav.${cfg.navKey}`)} value={settings.bulkPanels?.includes(key) ?? false} onValueChange={(on) => set({ bulkPanels: on ? [...(settings.bulkPanels ?? []), key] : (settings.bulkPanels ?? []).filter((x) => x !== key) })} />
        </View>)}
      </Card>
      <View className="flex-row gap-2 mt-3"><Button title="Discard draft" variant="soft" disabled={!dirty} onPress={discard} /><Button testID="interface-submit-bottom" title="Submit" disabled={!dirty} onPress={save} /></View>
    </AdminPage>
  );
}
