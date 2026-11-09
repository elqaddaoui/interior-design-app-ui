import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { LayoutPreview } from '@/components/layouts/LayoutPreview';
import { useT } from '@/i18n';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { toast } from '@/store/useToast';
import { useStore } from '@/store/useStore';
import type { LayoutDemoCfg, LayoutDevice, LayoutDevices, LayoutScreen, LayoutsConfig } from '@/data/types';
import { DEFAULT_DEMO, DEVICES, PARAM_KEYS, SCREENS, allowedOn, cfgOf, demoKey, demosOf, normalizeDevices, paramsOf, resolveLayout, type DemoDef, type ParamKey } from '@/lib/layouts';

const PREVIEW = { mobile: { w: 150, h: 270 }, desktop: { w: 330, h: 220 } } as const;
/** The setting keys that depend on the device: phones never show the desktop ones and the other way round. */
const DEVICE_KEYS: Record<ParamKey, LayoutDevice | null> = { gap: null, radius: null, colsM: 'mobile', heightM: 'mobile', colsD: 'desktop', heightD: 'desktop' };

export default function LayoutsAdmin() {
  const contentReady = useStore((s) => s.contentReady);
  const { t } = useT();
  const { draft: settings, patch, save, discard, dirty } = useDraftDoc('settings');
  const [screen, setScreen] = useState<LayoutScreen>('home');
  const [view, setView] = useState<LayoutDevice>('mobile');
  const [editing, setEditing] = useState<string | null>(null);
  const cfg: LayoutsConfig = settings.layouts ?? {};
  const setCfg = (next: LayoutsConfig) => patch({ layouts: next });
  const editDemo = (id: string, change: Partial<LayoutDemoCfg>) => setCfg({ ...cfg, demos: { ...cfg.demos, [demoKey(screen, id)]: { ...cfgOf(cfg, screen, id), ...change } } });
  const use = (id: string, device: LayoutDevice) => setCfg({ ...cfg, [screen]: { ...cfg[screen], [device]: id } });
  /** Limiting a demo to one device must not leave it chosen on the other one. */
  const setDevices = (id: string, devices: LayoutDevices) => {
    const picks = { ...cfg[screen] };
    for (const d of DEVICES) if (picks[d] === id && devices !== 'both' && devices !== d) delete picks[d];
    setCfg({ ...cfg, [screen]: picks, demos: { ...cfg.demos, [demoKey(screen, id)]: { ...cfgOf(cfg, screen, id), devices } } });
  };
  const setEnabled = (id: string, enabled: boolean) => {
    const picks = { ...cfg[screen] };
    if (!enabled) for (const d of DEVICES) if (picks[d] === id) delete picks[d];
    setCfg({ ...cfg, [screen]: picks, demos: { ...cfg.demos, [demoKey(screen, id)]: { ...cfgOf(cfg, screen, id), enabled } } });
  };
  const resetDemo = (id: string) => {
    const demos = { ...cfg.demos }; const old = cfgOf(cfg, screen, id);
    demos[demoKey(screen, id)] = { devices: old.devices, enabled: old.enabled };
    setCfg({ ...cfg, demos });
  };

  if (!contentReady) return <AdminPage title={t('ly.title')}><AdminLoading /></AdminPage>;
  const active = Object.fromEntries(DEVICES.map((d) => [d, resolveLayout(cfg, screen, d).id])) as Record<LayoutDevice, string>;
  const devLabel = (d: LayoutDevice) => t(`ly.${d}`);

  return (
    <AdminPage title={t('ly.title')} audience="clients" right={<Button testID="layouts-submit" size="sm" title={t('ly.submit')} disabled={!dirty} onPress={async () => { if (await save()) toast(t('ly.saved')); }} />}>
      <Txt className="text-muted text-[13px] leading-[20px] mb-3">{t('ly.intro')}</Txt>
      <Card className="p-3 mb-3">
        <View className="flex-row flex-wrap items-center gap-3">
          <View style={{ minWidth: 260 }}><Segmented testID="ly-screen" optionPrefix="ly-screen" value={screen} options={SCREENS.map((k) => ({ key: k, label: t(`ly.${k}`) }))} onChange={(k) => { setScreen(k); setEditing(null); }} /></View>
          <View style={{ minWidth: 280 }}><Segmented testID="ly-view" optionPrefix="ly-view" value={view} options={DEVICES.map((d) => ({ key: d, label: devLabel(d) }))} onChange={setView} /></View>
        </View>
        <View className="flex-row flex-wrap gap-2 mt-3">
          {DEVICES.map((d) => (
            <View key={d} testID={`ly-active-${d}`} className="flex-row items-center gap-2 bg-surface2 rounded-full px-3 h-9">
              <Icon name={d === 'mobile' ? 'cellphone' : 'monitor'} size={16} />
              <Txt className="text-[12px] text-muted">{t('ly.usedOn')} {devLabel(d)}</Txt>
              <Txt className="text-[13px] font-extrabold">{t(`ly.${screen}_${active[d]}`)}</Txt>
            </View>
          ))}
        </View>
        <Txt className="text-muted text-[12px] mt-2">{t('ly.previewNote')} {t('ly.noteDefault')}</Txt>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {demosOf(screen).map((demo) => (
          <DemoCard key={demo.id} demo={demo} screen={screen} cfg={cfg} view={view} active={active} open={editing === demo.id}
            onToggleEdit={() => setEditing(editing === demo.id ? null : demo.id)}
            onUse={(d) => use(demo.id, d)} onDevices={(v) => setDevices(demo.id, v)} onEnabled={(v) => setEnabled(demo.id, v)}
            onParam={(k, v) => editDemo(demo.id, { [k]: v })} onReset={() => resetDemo(demo.id)} />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2 mt-4">
        <Button testID="layouts-discard" title={t('ly.discard')} variant="soft" disabled={!dirty} onPress={discard} />
        <Button testID="layouts-submit-bottom" title={t('ly.submit')} disabled={!dirty} onPress={async () => { if (await save()) toast(t('ly.saved')); }} />
      </View>
    </AdminPage>
  );
}

function DemoCard({ demo, screen, cfg, view, active, open, onToggleEdit, onUse, onDevices, onEnabled, onParam, onReset }: {
  demo: DemoDef; screen: LayoutScreen; cfg: LayoutsConfig; view: LayoutDevice; active: Record<LayoutDevice, string>; open: boolean;
  onToggleEdit: () => void; onUse: (d: LayoutDevice) => void; onDevices: (v: LayoutDevices) => void; onEnabled: (v: boolean) => void; onParam: (k: ParamKey, v: number) => void; onReset: () => void;
}) {
  const { t } = useT();
  const isDefault = demo.id === DEFAULT_DEMO[screen];
  const stored = cfgOf(cfg, screen, demo.id);
  const devices = normalizeDevices(stored.devices);
  const enabled = isDefault || stored.enabled !== false;
  const values = paramsOf(cfg, screen, demo.id);
  const keys = PARAM_KEYS.filter((k) => demo.params[k]);
  const size = PREVIEW[view];
  const usedOn = DEVICES.filter((d) => active[d] === demo.id);
  const previewDevice: LayoutDevice = view;
  const dim = !enabled || (devices !== 'both' && devices !== previewDevice);
  return (
    <Card testID={`ly-demo-${demo.id}`} className={`p-3 ${usedOn.length ? 'border-2 border-primary' : ''}`} style={{ flexGrow: 1, flexBasis: view === 'desktop' ? 380 : 300, minWidth: 0 } as any}>
      <View className="flex-row gap-3">
        <View style={{ opacity: dim ? 0.4 : 1 }}>
          <LayoutPreview screen={screen} id={demo.id} device={previewDevice} cfg={cfg} width={size.w} maxHeight={size.h} />
        </View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <View className="flex-row items-center gap-1.5 mb-1"><Icon name={demo.icon} size={18} /><Txt className="font-extrabold text-[16px] flex-1" numberOfLines={1}>{t(`ly.${screen}_${demo.id}`)}</Txt></View>
          <View className="flex-row flex-wrap gap-1 mb-1.5">
            {isDefault ? <Badge text={t('ly.isDefault')} /> : null}
            {!enabled ? <Badge text={t('ly.disabled')} tone="off" /> : null}
            {usedOn.map((d) => <Badge key={d} testID={`ly-inuse-${demo.id}-${d}`} text={`${t('ly.inUse')} · ${t(`ly.${d}`)}`} tone="on" />)}
          </View>
          <Txt className="text-muted text-[12px] leading-[18px]">{t(`ly.${screen}_${demo.id}_d`)}</Txt>
          <Txt className="text-[11px] mt-1.5 text-muted">{t('ly.inspired')}: <Txt className="text-[11px] font-bold">{demo.refs.join(' · ')}</Txt></Txt>
        </View>
      </View>

      <View className="mt-3 gap-2">
        {!isDefault ? (
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1"><Txt className="font-semibold text-[13px]">{t('ly.enabled')}</Txt><Txt className="text-muted text-[11px]">{t('ly.enabledHint')}</Txt></View>
            <Toggle testID={`ly-enabled-${demo.id}`} label={t('ly.enabled')} value={enabled} onValueChange={onEnabled} />
          </View>
        ) : null}
        <View className="gap-1.5">
          <Txt className="text-[12px] font-bold">{t('ly.availableOn')}{isDefault ? ` · ${t('ly.both')}` : ''}</Txt>
          {isDefault ? null : (
            <Segmented testID={`ly-devices-${demo.id}`} optionPrefix={`ly-devices-${demo.id}`} compact value={devices} options={[{ key: 'mobile', label: t('ly.mobile') }, { key: 'desktop', label: t('ly.desktop') }, { key: 'both', label: t('ly.both') }] as { key: LayoutDevices; label: string }[]} onChange={onDevices} />
          )}
        </View>
        <View className="flex-row flex-wrap gap-2">
          {DEVICES.map((d) => {
            const ok = allowedOn(cfg, screen, demo.id, d);
            const on = active[d] === demo.id;
            return (
              <Pressable key={d} testID={`ly-use-${demo.id}-${d}`} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !ok }} disabled={!ok || on} onPress={() => onUse(d)}
                className={`flex-row items-center gap-1.5 rounded-full px-3 h-9 border ${on ? 'bg-primary border-primary' : 'bg-surface border-line'} ${!ok ? 'opacity-40' : 'active:opacity-70'}`}>
                <Icon name={on ? 'check-circle' : d === 'mobile' ? 'cellphone' : 'monitor'} size={16} tone={on ? 'onprimary' : 'fg'} />
                <Txt className={`text-[12px] font-bold ${on ? 'text-onprimary' : ''}`}>{t('ly.pickFor', { device: t(`ly.${d}`) })}</Txt>
              </Pressable>
            );
          })}
        </View>
        {keys.length ? (
          <Pressable testID={`ly-edit-${demo.id}`} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggleEdit} className="flex-row items-center justify-between border-t border-line pt-2 active:opacity-70">
            <Txt className="font-bold text-[13px]">{t('ly.edit')}</Txt><Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} />
          </Pressable>
        ) : null}
        {open && keys.length ? (
          <View testID={`ly-panel-${demo.id}`} className="gap-3">
            {keys.map((k) => {
              const spec = demo.params[k]!;
              const forDevice = DEVICE_KEYS[k];
              return (
                <View key={k} style={{ opacity: forDevice && forDevice !== view ? 0.45 : 1 }}>
                  <View className="flex-row justify-between"><Txt className="text-[12px] font-semibold">{t(`ly.${k}`)}</Txt><Txt testID={`ly-val-${demo.id}-${k}`} className="text-[12px] font-bold">{values[k]}</Txt></View>
                  <Slider testID={`ly-slider-${demo.id}-${k}`} label={t(`ly.${k}`)} value={values[k] ?? spec.def} min={spec.min} max={spec.max} step={spec.step} onChange={(v) => onParam(k, v)} />
                </View>
              );
            })}
            <Button testID={`ly-reset-${demo.id}`} size="sm" variant="soft" icon="restore" title={t('ly.reset')} onPress={onReset} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function Badge({ text, tone, testID }: { text: string; tone?: 'on' | 'off'; testID?: string }) {
  return (
    <View testID={testID} className={`rounded-full px-2 h-5 items-center justify-center ${tone === 'on' ? 'bg-primary' : tone === 'off' ? 'bg-danger' : 'bg-surface2'}`}>
      <Txt className={`text-[10.5px] font-bold ${tone === 'on' ? 'text-onprimary' : tone === 'off' ? 'text-white' : 'text-muted'}`}>{text}</Txt>
    </View>
  );
}
