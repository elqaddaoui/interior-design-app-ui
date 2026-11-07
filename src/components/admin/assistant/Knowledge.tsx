import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Txt } from '@/components/ui/Txt';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { Label, Note } from '@/components/admin/promptcards/ui';
import { api } from '@/lib/backend';
import { useT } from '@/i18n';
import type { AssistantConfig } from '@/data/types';

interface Overview { sections: { id: string; title: string; keywords: number; chars: number; text: string }[]; screens: (string | { path?: string; title?: string })[] }

/** What the assistant knows (built from the app docs and data) plus the owner's own notes. */
export function Knowledge({ c, setC }: { c: AssistantConfig; setC: (v: AssistantConfig) => void }) {
  const { t } = useT();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { api<Overview>('/admin/assistant/knowledge').then(setData).catch(() => setFailed(true)); }, []);
  const screens = (data?.screens ?? []).map((x) => (typeof x === 'string' ? x : x.path || x.title || '')).filter(Boolean);
  return (
    <View style={{ gap: 12 }} testID="asx-panel-knowledge">
      <Card className="p-3">
        <Txt className="text-[15px] font-extrabold">{t('asx.k.title')}</Txt>
        <Txt className="text-[12px] text-muted mt-0.5 mb-2">{t('asx.k.hint')}</Txt>
        <Note tone="info" testID="asx-k-rule" text={t('asx.k.rule')} />
        {failed ? <Txt className="text-danger text-[12px]">{t('asx.k.empty')}</Txt> : !data ? <AdminLoading testID="asx-k-loading" /> : (<>
          <Label>{t('asx.k.sections')} ({data.sections.length})</Label>
          <View style={{ gap: 6 }}>
            {data.sections.map((s) => {
              const on = open === s.id;
              return (
                <View key={s.id} testID={`asx-k-${s.id}`} className="border border-line rounded-xl bg-surface overflow-hidden">
                  <Pressable testID={`asx-k-${s.id}-open`} accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={() => setOpen(on ? null : s.id)} className="flex-row items-center gap-2 px-3 py-2.5">
                    <View className="flex-1" style={{ minWidth: 0 }}>
                      <Txt className="font-bold text-[13.5px]" numberOfLines={1}>{s.title}</Txt>
                      <Txt className="text-[11.5px] text-muted">{t('asx.k.chars', { count: s.chars })} · {t('asx.k.kw', { count: s.keywords })}</Txt>
                    </View>
                    <Icon name={on ? 'chevron-up' : 'chevron-down'} size={20} tone="muted" />
                  </Pressable>
                  {on ? <View className="px-3 pb-3 border-t border-line"><Txt className="text-[12.5px] leading-[19px] mt-2" selectable>{s.text}</Txt></View> : null}
                </View>
              );
            })}
          </View>
          {screens.length ? (
            <View className="mt-3">
              <Label>{t('asx.k.screens')} ({screens.length})</Label>
              <View className="flex-row flex-wrap gap-1.5">{screens.map((p) => <View key={p} className="px-2.5 h-7 rounded-full bg-surface2 items-center justify-center"><Txt className="text-[11.5px] font-semibold">{p}</Txt></View>)}</View>
            </View>
          ) : null}
        </>)}
      </Card>
      <Card className="p-3">
        <Label hint={t('asx.k.notesHint')}>{t('asx.k.notes')}</Label>
        <Input tight testID="asx-notes" value={c.knowledgeNotes ?? ''} onChangeText={(v) => setC({ ...c, knowledgeNotes: v })} placeholder={t('asx.k.notesPlaceholder')} multiline maxLength={2000} style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: 12 }} />
      </Card>
    </View>
  );
}
