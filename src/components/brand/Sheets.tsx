 
import React, { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { toast } from '@/store/useToast';
import { canExport, exportAppIcon, exportLogo } from '@/lib/brand/export';
import { sameSpec, type Issue, type LogoSpec } from '@/lib/brand/spec';
import type { BrandVersion } from '@/data/types';
import { LogoView } from './LogoView';
import { Chips, Hint, Label, SwitchRow } from './ui';

const Tag = ({ children }: { children: React.ReactNode }) => <View className="bg-soft rounded-full px-2.5 py-1"><Txt className="text-[11px] font-bold">{children}</Txt></View>;
const Stage = ({ spec, mode, label, accent }: { spec: LogoSpec; mode: 'light' | 'dark'; label: string; accent: string }) => (
  <View style={{ flex: 1, minWidth: 0 }}>
    <Txt className="text-[10px] font-bold text-muted mb-1" numberOfLines={1}>{label}</Txt>
    <View style={{ backgroundColor: mode === 'dark' ? '#0E0E10' : '#FFFFFF', borderRadius: 10, borderWidth: 1, borderColor: '#8883', minHeight: 64, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
      <LogoView spec={spec} mode={mode} accent={accent} maxW={150} maxH={52} />
    </View>
  </View>
);

/** Confirm before publishing: what changes, any advice, before / after. */
export function PublishSheet({ visible, onClose, onConfirm, before, after, groups, issues, busy }: { visible: boolean; onClose: () => void; onConfirm: () => void; before: LogoSpec; after: LogoSpec; groups: string[]; issues: Issue[]; busy: boolean }) {
  const { t } = useT();
  const { colors } = useTheme();
  const warns = issues.filter((i) => i.level === 'warn');
  return (
    <Sheet visible={visible} onClose={onClose} title={t('br.publishTitle')} footer={
      <View className="flex-row gap-2.5 mb-1"><Button full variant="soft" testID="publish-cancel" title={t('br.cancel')} onPress={onClose} disabled={busy} /><Button full testID="publish-confirm" icon="rocket-launch-outline" title={t('br.publish')} onPress={onConfirm} loading={busy} /></View>}>
      <Txt className="text-[14px] leading-[21px] mb-3">{t('br.publishBody')}</Txt>
      <View className="flex-row gap-2.5 mb-3"><Stage spec={before} mode="light" label={t('br.before')} accent={colors.primary} /><Stage spec={after} mode="light" label={t('br.after')} accent={colors.primary} /></View>
      <View className="flex-row gap-2.5 mb-3"><Stage spec={before} mode="dark" label={t('br.before')} accent={colors.primary} /><Stage spec={after} mode="dark" label={t('br.after')} accent={colors.primary} /></View>
      <Label>{t('br.changes')}</Label>
      <View className="flex-row flex-wrap gap-1.5 mb-3">{groups.map((g) => <Tag key={g}>{t(`br.group.${g}`)}</Tag>)}</View>
      {warns.map((i) => <Hint key={i.path + i.key}>{`• ${t(`br.issue.${i.key}`, i.params)}`}</Hint>)}
    </Sheet>
  );
}

/** Published versions, newest first. Restoring loads a version into the draft (undoable) - nothing goes live until it is published again. */
export function HistorySheet({ visible, onClose, versions, published, onRestore }: { visible: boolean; onClose: () => void; versions: BrandVersion[]; published: LogoSpec; onRestore: (v: BrandVersion) => void }) {
  const { t, lang } = useT();
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('br.history')}>
      {!versions.length ? <Txt className="text-muted text-center py-6 text-[13px]">{t('br.historyEmpty')}</Txt> : versions.map((v, i) => {
        const current = i === 0 && sameSpec(v.logo, published);
        return (
          <View key={v.id} testID={`version-${i}`} className="rounded-xl border border-line p-2.5 mb-2">
            <View className="flex-row items-center gap-3">
              <View style={{ width: 130, minHeight: 52, backgroundColor: '#FFFFFF', borderRadius: 8, borderWidth: 1, borderColor: '#8883', alignItems: 'center', justifyContent: 'center', padding: 6 }}><LogoView spec={v.logo} accent={colors.primary} maxW={116} maxH={44} /></View>
              <View className="flex-1" style={{ minWidth: 0 }}>
                <Txt className="font-extrabold text-[13px]" numberOfLines={1}>{t('br.versionOf', { n: versions.length - i })}</Txt>
                <Txt className="text-[11px] text-muted" numberOfLines={1}>{new Date(v.at).toLocaleString(lang === 'fr' ? 'fr-FR' : 'ar-MA')}</Txt>
              </View>
              {current ? <Tag>{t('br.currentVersion')}</Tag> : <Button testID={`rollback-${i}`} size="sm" variant="soft" icon="backup-restore" title={t('br.rollback')} onPress={() => onRestore(v)} />}
            </View>
            {v.groups.length ? <View className="flex-row flex-wrap gap-1 mt-2">{v.groups.map((g) => <Tag key={g}>{t(`br.group.${g}`)}</Tag>)}</View> : null}
          </View>
        );
      })}
    </Sheet>
  );
}

/** SVG / PNG of the logo (light or dark, transparent or not, 1x-4x) and the app icon / favicon PNG sizes. */
export function ExportSheet({ visible, onClose, spec }: { visible: boolean; onClose: () => void; spec: LogoSpec }) {
  const { t } = useT();
  const { colors } = useTheme();
  const [format, setFormat] = useState<'svg' | 'png'>('svg');
  const [scale, setScale] = useState(2);
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [transparent, setTransparent] = useState(true);
  const [busy, setBusy] = useState('');
  const run = async (id: string, job: () => Promise<void>) => { setBusy(id); try { await job(); toast(t('br.exportDone')); } catch { toast(t('br.exportFailed')); } finally { setBusy(''); } };
  return (
    <Sheet visible={visible} onClose={onClose} title={t('br.exportTitle')}>
      {!canExport ? <Hint>{t('br.exportWebOnly')}</Hint> : null}
      <Label>{t('br.exportFormat')}</Label>
      <Chips value={format} testID="export-format" onChange={setFormat} options={[{ key: 'svg', label: 'SVG' }, { key: 'png', label: 'PNG' }]} />
      {format === 'png' ? <><Label>{t('br.exportScale')}</Label><Chips value={scale} testID="export-scale" onChange={setScale} options={[1, 2, 4].map((n) => ({ key: n, label: `${n}x` }))} /></> : null}
      <Label>{t('br.exportVersion')}</Label>
      <Chips value={mode} testID="export-mode" onChange={setMode} options={[{ key: 'light', label: t('br.light'), icon: 'white-balance-sunny' }, { key: 'dark', label: t('br.dark'), icon: 'weather-night' }]} />
      <SwitchRow testID="export-transparent" label={t('br.exportBg')} value={transparent} onChange={setTransparent} />
      <Button full testID="export-logo" icon="download" title={`${t('br.exportLogoBtn')} (${format.toUpperCase()})`} loading={busy === 'logo'} onPress={() => run('logo', () => exportLogo(spec, { mode, transparent, accent: colors.primary, format, scale }))} />
      <View className="h-px bg-line my-4" />
      <Label>{t('br.exportIcons')}</Label>
      <View className="flex-row flex-wrap gap-2">
        {[512, 192, 180, 32, 16].map((n) => <Button key={n} testID={`export-icon-${n}`} size="sm" variant="soft" icon="download" title={`${n}px`} loading={busy === `i${n}`} onPress={() => run(`i${n}`, () => exportAppIcon(spec, n, colors.primary))} />)}
        <Button testID="export-icon-svg" size="sm" variant="soft" icon="download" title="SVG" loading={busy === 'isvg'} onPress={() => run('isvg', () => exportAppIcon(spec, 512, colors.primary, 'svg'))} />
      </View>
    </Sheet>
  );
}
