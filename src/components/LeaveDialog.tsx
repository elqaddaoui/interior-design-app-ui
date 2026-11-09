import React, { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { clip, summaryKey, type Described, type Val } from '@/lib/changeLabels';

/** How many chips fit the one-line preview; the rest hide behind "+N" / "عرض التفاصيل". */
const MAX_CHIPS = 3;

/** One value inside a chip: a colour dot, or short text. */
function Value({ v, strong, max }: { v: Val; strong?: boolean; max: number }) {
  const { colors } = useTheme();
  if (v.color) return <View accessibilityLabel={v.text} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: v.color, borderWidth: 1, borderColor: colors.line }} />;
  return <Txt className={`text-[12px] ${strong ? 'font-extrabold' : 'text-muted'}`} numberOfLines={1}>{clip(v.text, max)}</Txt>;
}

/** old → new, inline. The arrow mirrors in RTL. */
function Delta({ before, after, max = 14 }: { before: Val; after: Val; max?: number }) {
  return (
    <View className="flex-row items-center" style={{ gap: 5, flexShrink: 0 }}>
      <Value v={before} max={max} />
      <Icon name="arrow-right" size={13} tone="muted" flip />
      <Value v={after} strong max={max} />
    </View>
  );
}

function Chip({ d, index }: { d: Described; index: number }) {
  return (
    <View testID={`unsaved-chip-${index}`} className="flex-row items-center rounded-full bg-surface2 border border-line" style={{ gap: 7, height: 32, paddingHorizontal: 11, maxWidth: '100%' }}>
      <Txt className="text-[11px] font-bold text-muted" numberOfLines={1} style={{ flexShrink: 1, minWidth: 0 }}>{clip(d.label, 30)}</Txt>
      <Delta before={d.before} after={d.after} />
    </View>
  );
}

export interface LeaveDialogProps {
  visible: boolean;
  changes: Described[];
  /** False when there is nothing to save (a wizard in progress): the primary action disappears. */
  canSave: boolean;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}

/**
 * The "leave?" confirmation. A compact centred modal (never scrolls in its normal state):
 *   title, one-line summary, a row of change chips (label + old → new), a "show details" toggle,
 *   then three actions: primary Save, secondary Discard, tertiary text link Stay.
 * Every colour comes from the active theme tokens, so it follows whichever theme is on.
 */
export function LeaveDialog({ visible, changes, canSave, busy, onSave, onDiscard, onStay }: LeaveDialogProps) {
  const { t, rtl } = useT();
  const { colors, dark, style } = useTheme();
  const [open, setOpen] = useState(false);
  const n = changes.length;
  const shown = changes.slice(0, MAX_CHIPS);
  const more = n - shown.length;
  const summary = n > 0 ? t(summaryKey(n), { n }) : t('leaveConfirm.message');
  const toggleLabel = open ? t('lv.hide') : t('lv.details');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onStay(); }} statusBarTranslucent>
      <View style={[style, { flex: 1, direction: rtl ? 'rtl' : 'ltr' } as any]}>
        {/* scrim: the page colour (dark themes) or the ink colour (light themes), so it is never a foreign black */}
        <Pressable accessibilityLabel={t('lv.stay')} onPress={() => { if (!busy) onStay(); }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <Animated.View entering={FadeIn.duration(160)} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: dark ? colors.bg : colors.ink, opacity: dark ? 0.78 : 0.5 }} />
          <Animated.View entering={FadeInDown.duration(200)} style={{ width: '100%', maxWidth: 400 }}>
            <Pressable testID="unsaved-dialog" accessibilityRole="alert" onPress={() => {}} className="bg-bg rounded-3xl border border-line"
              style={{ padding: 22, gap: 18, ...(Platform.OS === 'web' ? ({ boxShadow: `0 18px 48px ${colors.ink}40` } as object) : { elevation: 12 }) }}>
              {/* focal point: the title and ONE sentence */}
              <View className="items-center" style={{ gap: 12 }}>
                <View testID="unsaved-badge" className="w-14 h-14 rounded-full bg-primary items-center justify-center"><Icon name={n > 0 ? 'content-save-edit-outline' : 'exit-run'} size={28} tone="onprimary" flip={n === 0} /></View>
                <View className="items-center" style={{ gap: 4 }}>
                  <Txt accessibilityRole="header" className="text-[20px] leading-[26px] font-black text-center">{t('leaveConfirm.title')}</Txt>
                  <Txt testID="unsaved-message" className="text-[14px] leading-[20px] text-muted text-center">{summary}</Txt>
                </View>
              </View>

              {n > 0 ? (
                <View style={{ gap: 10 }}>
                  <View testID="unsaved-chips" className="flex-row flex-wrap justify-center" style={{ gap: 8 }}>
                    {shown.map((d, i) => <Chip key={i} d={d} index={i} />)}
                    {more > 0 && !open ? (
                      <Pressable testID="unsaved-more" accessibilityRole="button" onPress={() => setOpen(true)} className="rounded-full bg-soft items-center justify-center active:opacity-70" style={{ height: 32, paddingHorizontal: 12 }}>
                        <Txt className="text-[12px] font-extrabold">{t('lv.more', { n: more })}</Txt>
                      </Pressable>
                    ) : null}
                  </View>
                  <Pressable testID="unsaved-details-toggle" accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} className="self-center flex-row items-center active:opacity-70" style={{ gap: 4, minHeight: 28 }}>
                    <Txt className="text-[12.5px] font-bold text-muted">{toggleLabel}</Txt>
                    <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} tone="muted" />
                  </Pressable>
                  {open ? (
                    <Animated.View entering={FadeIn.duration(160)} testID="unsaved-differences" className="rounded-2xl border border-line bg-surface" style={{ maxHeight: 220, overflow: 'hidden' }}>
                      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
                        {changes.map((d, i) => (
                          <View key={i} className={`flex-row items-center ${i > 0 ? 'border-t border-line' : ''}`} style={{ gap: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
                            <Txt className="text-[12.5px] font-bold" numberOfLines={1} style={{ flexShrink: 1, flexBasis: '34%' }}>{d.label}</Txt>
                            <View className="flex-row items-center flex-1 justify-end" style={{ gap: 6, minWidth: 0 }}>
                              <View testID={`change-old-${i}`} style={{ flexShrink: 1, minWidth: 0 }}><DetailValue v={d.before} /></View>
                              <Icon name="arrow-right" size={13} tone="muted" flip />
                              <View testID={`change-new-${i}`} style={{ flexShrink: 1, minWidth: 0 }}><DetailValue v={d.after} strong /></View>
                            </View>
                          </View>
                        ))}
                      </ScrollView>
                    </Animated.View>
                  ) : null}
                </View>
              ) : null}

              {/* actions: one primary, one quiet secondary, one text link */}
              <View style={{ gap: 10 }}>
                {canSave ? (
                  <Pressable testID="unsaved-save" accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onSave}
                    className="bg-primary rounded-2xl flex-row items-center justify-center active:opacity-85" style={{ height: 52, gap: 8, opacity: busy ? 0.7 : 1 }}>
                    {busy ? <Spinner size={20} /> : <Icon name="content-save-outline" size={20} tone="onprimary" />}
                    <Txt className="text-[16px] font-extrabold text-onprimary">{t('improve.saveChanges')}</Txt>
                  </Pressable>
                ) : null}
                <Pressable testID="unsaved-discard" accessibilityRole="button" disabled={busy} onPress={onDiscard}
                  className={`rounded-2xl flex-row items-center justify-center active:opacity-80 ${canSave ? 'bg-surface2' : 'bg-primary'}`} style={{ height: canSave ? 46 : 52, gap: 8, opacity: busy ? 0.5 : 1 }}>
                  <Icon name={canSave ? 'close-circle-outline' : 'exit-run'} size={19} tone={canSave ? 'danger' : 'onprimary'} flip={!canSave} />
                  <Txt className={`text-[15px] font-bold ${canSave ? 'text-danger' : 'text-onprimary'}`}>{canSave ? t('lv.discard') : t('lv.leave')}</Txt>
                </Pressable>
                <Pressable testID="unsaved-cancel" accessibilityRole="button" disabled={busy} onPress={onStay} hitSlop={8} className="self-center items-center justify-center active:opacity-60" style={{ minHeight: 40, paddingHorizontal: 18 }}>
                  <Txt className="text-[14px] font-bold text-muted" style={{ textDecorationLine: 'underline' }}>{t('lv.stay')}</Txt>
                </Pressable>
              </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </View>
    </Modal>
  );
}

function DetailValue({ v, strong }: { v: Val; strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center" style={{ gap: 5, minWidth: 0 }}>
      {v.color ? <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: v.color, borderWidth: 1, borderColor: colors.line }} /> : null}
      <Txt className={`text-[12.5px] ${strong ? 'font-extrabold' : 'text-muted'}`} numberOfLines={2} style={{ flexShrink: 1 }}>{v.text}</Txt>
    </View>
  );
}
