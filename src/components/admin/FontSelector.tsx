import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, Sheet, Txt } from '@/components/ui';

/** A compact dropdown with genuine type specimens, not labels in the current font. */
export function FontSelector({ value, options, language, onChange }: { value?: string; options: string[]; language: 'fr' | 'ar'; onChange: (font: string) => void }) {
  const [open, setOpen] = useState(false);
  const rtl = language === 'ar'; const selected = options.includes(value ?? '') ? value! : options[0];
  const sample = rtl ? 'مساحة تُلهمك، وتفاصيل تشبهك.' : 'Un intérieur qui vous ressemble.';
  return <View className="flex-1" style={{ minWidth: 0 }}>
    <Txt className="font-semibold text-muted text-[12px] mb-2">{rtl ? 'العربية · RTL' : 'Français · LTR'}</Txt>
    <Pressable testID={`font-dropdown-${language}`} accessibilityRole="button" accessibilityLabel={`Choose ${rtl ? 'Arabic' : 'French'} font`} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} className="flex-row items-center border border-line rounded-xl bg-surface2 px-3 h-11 gap-2">
      <Txt style={{ fontFamily: selected }} className="flex-1" numberOfLines={1}>{selected}</Txt><Icon name="chevron-down" size={18} />
    </Pressable>
    <View testID={`font-preview-${language}`} className="rounded-xl bg-soft p-3 mt-2" style={{ direction: rtl ? 'rtl' : 'ltr' }}>
      <Txt style={{ fontFamily: selected, fontSize: rtl ? 23 : 19, lineHeight: rtl ? 36 : 29, writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }}>{sample}</Txt>
      <Txt style={{ fontFamily: selected, writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }} className="text-muted text-[12px] mt-1">{rtl ? 'من الفكرة إلى بيتك · ١٢٣' : 'De l’idée à votre maison · 123'}</Txt>
    </View>
    <Sheet visible={open} onClose={() => setOpen(false)} title={rtl ? 'اختر الخط العربي' : 'Choisir la typographie'}>
      {options.map((font) => <Pressable key={font} testID={`chip-${font}`} accessibilityRole="radio" accessibilityState={{ selected: font === selected }} onPress={() => { onChange(font); setOpen(false); }} className={`rounded-xl border p-3 mb-2 ${font === selected ? 'border-primary bg-soft' : 'border-line bg-surface'}`}>
        <View className="flex-row items-center gap-2"><Txt style={{ fontFamily: font }} className="flex-1 text-[15px]">{font}</Txt><Icon name={font === selected ? 'check-circle' : 'radiobox-blank'} tone={font === selected ? 'primary' : 'muted'} size={20} /></View>
        <Txt style={{ fontFamily: font, writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', fontSize: rtl ? 21 : 17, lineHeight: 30 }} className="mt-2">{sample}</Txt>
      </Pressable>)}
    </Sheet>
  </View>;
}
