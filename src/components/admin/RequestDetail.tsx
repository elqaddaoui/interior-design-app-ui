import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { Icon } from '@/components/ui/Icon';
import { ImageViewer, type ViewerItem } from '@/components/ui/ImageViewer';
import { Txt } from '@/components/ui/Txt';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import type { RenderRequest } from '@/data/types';

/** The pictures of a request in viewing order: the client's photo, the AI result, the delivered design, the inspiration. */
export function useRequestShots(r: RenderRequest): ViewerItem[] {
  const { t } = useT();
  const inspiration = useStore((s) => s.inspirations.find((x) => x.id === r.draft?.inspirationId));
  return React.useMemo(() => {
    const list: ViewerItem[] = [];
    if (r.photoUri) list.push({ uri: r.photoUri, label: t('md.viewer.before') });
    if (r.aiResult) list.push({ uri: r.aiResult, label: t('md.viewer.after') });
    if (r.finalResult) list.push({ uri: r.finalResult, label: t('md.viewer.final') });
    const ref = inspiration?.image || r.aiRun?.inputs?.inspiration?.image;
    if (ref) list.push({ uri: ref, label: t('md.req.inspiration') });
    return list;
  }, [r.photoUri, r.aiResult, r.finalResult, r.aiRun, inspiration?.image, t]);
}

/** A thumbnail that opens the viewer (all pictures of the request, starting at this one). */
export function Shot({ uri, label, onOpen, testID, ratio = 4 / 3 }: { uri?: string; label: string; onOpen?: () => void; testID?: string; ratio?: number }) {
  const { t } = useT();
  return (
    <View className="flex-1" style={{ minWidth: 120 }}>
      <Txt className="text-[12px] leading-[18px] font-semibold text-muted mb-1" numberOfLines={1}>{label}</Txt>
      <Pressable testID={testID} disabled={!uri} onPress={onOpen} accessibilityRole="imagebutton" accessibilityLabel={`${t('md.viewer.open')}: ${label}`}
        className="rounded-xl overflow-hidden bg-surface2 items-center justify-center active:opacity-80" style={{ aspectRatio: ratio, maxHeight: 220 }}>
        {uri ? (
          <>
            <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={120} />
            <View className="absolute bottom-1.5 end-1.5 w-7 h-7 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}><Icon name="arrow-expand" size={15} color="#fff" /></View>
          </>
        ) : <View className="items-center gap-1 px-2"><Icon name="image-off-outline" size={22} tone="muted" /><Txt className="text-muted text-[11px] leading-[16px] text-center">{label === t('md.viewer.after') ? t('md.req.noResult') : t('md.req.noPhoto')}</Txt></View>}
      </Pressable>
    </View>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <View className="mt-4">
      <View className="flex-row items-center gap-2 mb-2"><Icon name={icon} size={17} tone="primary" /><Txt className="text-[14px] leading-[20px] font-extrabold">{title}</Txt></View>
      <View className="rounded-2xl border border-line bg-surface overflow-hidden">{children}</View>
    </View>
  );
}

function Row({ label, children, last, testID }: { label: string; children: React.ReactNode; last?: boolean; testID?: string }) {
  return (
    <View testID={testID} className={`flex-row gap-3 px-3 py-2.5 ${last ? '' : 'border-b border-line'}`} style={{ alignItems: 'flex-start' }}>
      <Txt className="text-muted text-[12px] leading-[19px] font-semibold" style={{ width: 104 }}>{label}</Txt>
      <View className="flex-1" style={{ minWidth: 0 }}>{typeof children === 'string' ? <Txt className="text-[13px] leading-[20px]" selectable>{children}</Txt> : children}</View>
    </View>
  );
}

const when = (n?: number) => (n ? new Date(n).toLocaleString() : '');
const engineName = (m?: { engine?: string; model?: string; label?: string }) => (m ? [m.label || m.model, m.engine && m.label && m.label !== m.model ? m.engine : ''].filter(Boolean).join(' · ') : '');

/**
 * Everything the client chose and everything the generation really used, for one request.
 * Client choices come from the saved draft (always there); the model, the exact prompt and the colour roles come from the server's
 * `aiRun` record (requests made before it existed simply show the draft part).
 */
export function RequestInfo({ r, onOpenShot }: { r: RenderRequest; onOpenShot: (index: number) => void }) {
  const s = useStore();
  const L = useL();
  const { t } = useT();
  const d = r.draft;
  const run = r.aiRun;
  const [showPrompt, setShowPrompt] = React.useState(false);
  const shots = useRequestShots(r);
  const indexOf = (uri?: string) => (uri ? shots.findIndex((x) => x.uri === uri) : -1);
  const tool = s.tools.find((x) => x.id === d.toolId), room = s.roomTypes.find((x) => x.id === d.roomTypeId), style = s.styles.find((x) => x.id === d.styleId);
  const palette = s.palettes.find((x) => x.id === d.paletteId);
  const inspiration = s.inspirations.find((x) => x.id === d.inspirationId);
  // Titles as they were when the picture was generated win over today's names.
  const name = (saved: { title?: any } | null | undefined, live?: { title: any }) => L(saved?.title) || L(live?.title);
  const applied = run?.applied;
  const modeShown = run ? applied?.mode : d.mode;
  const colors = applied?.colors?.length ? applied.colors : (d.colors?.length ? d.colors : palette && !palette.isSurprise ? palette.colors : []).map((hex) => ({ hex, name: '', role: '' }));
  const colorSource = applied?.colorSource || (d.colors?.length ? 'custom' : palette ? (palette.isSurprise ? 'surprise' : 'preset') : 'none');
  const asked = s.models.find((x) => x.id === d.modelId);
  const requested = run?.inputs?.requestedModel;
  const used = run?.used || r.aiModel;
  const tried = run?.tried || [];
  const prompt = run?.prompt;
  const copy = async () => {
    try { await (globalThis as any).navigator?.clipboard?.writeText(prompt || ''); toast(t('md.req.copied')); } catch { /* selectable text is the fallback */ }
  };
  const sec = (ms?: number) => (ms ? t('md.req.seconds', { n: (ms / 1000).toFixed(1) }) : '');
  const inspirationUri = inspiration?.image || run?.inputs?.inspiration?.image;

  return (
    <View testID="req-info">
      <Section title={t('md.req.inputs')} icon="tune-variant">
        <Row label={t('md.req.tool')}>{name(run?.inputs?.tool, tool) || d.toolId || '—'}</Row>
        {d.roomTypeId ? <Row label={t('md.req.room')}>{name(run?.inputs?.room, room) || d.roomTypeId}</Row> : null}
        {d.styleId ? <Row label={t('md.req.style')}>{name(run?.inputs?.style, style) || d.styleId}</Row> : null}
        {modeShown ? <Row label={t('md.req.mode')}>{modeShown === 'renovation' ? t('md.req.modeRenovation') : t('md.req.modeRestyle')}</Row> : null}
        <Row label={t('md.req.source')}>{d.source === 'text' ? t('md.req.srcText') : t('md.req.srcPhoto')}</Row>
        {d.paletteId || palette ? <Row label={t('md.req.palette')}>{name(run?.inputs?.palette, palette) || d.paletteId || '—'}</Row> : null}
        <Row label={t('md.req.colors')} testID="req-colors">
          {colors.length ? (
            <View className="gap-1.5">
              <View className="flex-row flex-wrap gap-2">
                {colors.map((c, i) => (
                  <View key={`${c.hex}${i}`} className="flex-row items-center gap-1.5 rounded-full bg-surface2 ps-1 pe-2.5 py-1">
                    <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c.hex, borderWidth: 1, borderColor: 'rgba(128,128,128,0.4)' }} />
                    <Txt className="text-[11px] leading-[16px]" style={{ writingDirection: 'ltr' }}>{c.hex}{c.name ? ` · ${c.name}` : ''}{c.role ? ` · ${t(`md.req.role.${c.role}`, { defaultValue: c.role })}` : ''}</Txt>
                  </View>
                ))}
              </View>
              <Txt className="text-muted text-[11px] leading-[16px]">{t('md.req.colorSource')}: {t(`md.req.cs${colorSource === 'custom' ? 'Custom' : colorSource === 'preset' ? 'Preset' : colorSource === 'surprise' ? 'Surprise' : 'None'}`)}</Txt>
            </View>
          ) : <Txt className="text-[13px] leading-[20px]">{t(`md.req.cs${colorSource === 'surprise' ? 'Surprise' : 'None'}`)}</Txt>}
        </Row>
        <Row label={t('md.req.note')} testID="req-note">
          {d.prompt ? (
            <View className="gap-1">
              <Txt className="text-[13px] leading-[20px]" selectable>{d.prompt}</Txt>
              {applied?.brief?.english ? <Txt className="text-muted text-[12px] leading-[18px]" selectable style={{ writingDirection: 'ltr', textAlign: 'left' }}>{t('md.req.noteEnglish')}: {applied.brief.english}</Txt> : null}
            </View>
          ) : <Txt className="text-muted text-[13px] leading-[20px]">—</Txt>}
        </Row>
        <Row label={t('md.req.inspiration')} last>
          {inspirationUri ? (
            <Pressable testID="req-inspiration" onPress={() => onOpenShot(Math.max(0, indexOf(inspirationUri)))} className="flex-row items-center gap-2.5 active:opacity-80">
              <Image source={{ uri: inspirationUri }} style={{ width: 56, height: 42, borderRadius: 8 }} contentFit="cover" />
              {run ? <Txt className="text-muted text-[12px] leading-[18px] flex-1">{applied?.reference ? t('md.req.inspirationSent') : t('md.req.inspirationSkipped')}</Txt> : null}
            </Pressable>
          ) : <Txt className="text-muted text-[13px] leading-[20px]">—</Txt>}
        </Row>
      </Section>

      <Section title={t('md.req.ai')} icon="creation-outline">
        <Row label={t('md.req.modelAsked')}>{requested?.name ? `${requested.name}${requested.modelName ? ` · ${requested.modelName}` : ''}` : asked?.name ? `${asked.name}${asked.modelName ? ` · ${asked.modelName}` : ''}` : t('md.req.modelAuto')}</Row>
        <Row label={t('md.req.modelUsed')} testID="req-model-used">
          {used ? <View className="flex-row items-center gap-2"><Icon name="check-circle" size={16} tone="success" /><Txt className="text-[13px] leading-[20px] font-bold flex-1" selectable style={{ writingDirection: 'ltr', textAlign: 'left' }}>{engineName(used)}{used.model && used.label && used.model !== used.label ? ` (${used.model})` : ''}</Txt></View>
            : <Txt className="text-muted text-[13px] leading-[20px]">{run?.failed ? t('md.req.modelNone') : '—'}</Txt>}
        </Row>
        {tried.length ? (
          <Row label={t('md.req.modelTried')}>
            <View className="gap-1">
              {tried.map((x, i) => (
                <View key={i} className="flex-row items-center gap-1.5">
                  <Icon name={x.ok ? 'check' : 'close'} size={14} tone={x.ok ? 'success' : 'danger'} />
                  <Txt className="text-[12px] leading-[18px] flex-1" style={{ writingDirection: 'ltr', textAlign: 'left' }}>{engineName(x)}{x.ok ? '' : x.status ? ` · ${x.status}` : ''}{x.ms ? ` · ${sec(x.ms)}` : ''}</Txt>
                </View>
              ))}
            </View>
          </Row>
        ) : null}
        {run?.images ? (
          <Row label={t('md.req.imagesSent')} testID="req-images">
            <View className="gap-1.5">
              <View className="flex-row items-center gap-1.5"><Icon name="check" size={14} tone="success" /><Txt className="text-[12px] leading-[18px] flex-1">{t('md.req.imgPhoto')}</Txt></View>
              {run.images.map((im) => (
                <View key={im.role} className="flex-row items-center gap-1.5">
                  <Icon name={im.sent ? 'check' : 'close'} size={14} tone={im.sent ? 'success' : 'muted'} />
                  <Txt className="text-[12px] leading-[18px] flex-1">{t(`md.req.imgRole.${im.role}`)} · {t(im.sent ? 'md.req.imgSent' : 'md.req.imgNotSent')}{im.why ? ` · ${t(`md.req.imgWhy.${im.why}`)}` : ''}</Txt>
                </View>
              ))}
            </View>
          </Row>
        ) : null}
        {run?.rules ? <Row label={t('md.req.rulesApplied')} testID="req-rules">{t(run.rules.applied ? 'md.req.rulesOn' : 'md.req.rulesOff')}</Row> : null}
        {run?.size ? <Row label={t('md.req.size')}>{run.size}</Row> : null}
        {run?.photo ? <Row label={t('md.req.photoSize')}>{`${run.photo.width}×${run.photo.height}${run.photo.bytes ? ` · ${(run.photo.bytes / 1024).toFixed(0)} KB` : ''}`}</Row> : null}
        {run?.durationMs ? <Row label={t('md.req.duration')}>{sec(run.durationMs)}</Row> : null}
        <Row label={t('md.req.date')} last={!prompt}>{when(run?.at || r.createdAt)}</Row>
        {!run ? <View className="px-3 py-2.5 border-t border-line"><Txt className="text-muted text-[12px] leading-[19px]">{t('md.req.noRun')}</Txt></View> : null}
        {prompt ? (
          <View className="border-t border-line">
            <View className="flex-row items-center gap-2 px-3 py-2">
              <Pressable testID="req-prompt-toggle" onPress={() => setShowPrompt((v) => !v)} className="flex-row items-center gap-1.5 flex-1 py-1 active:opacity-70" accessibilityRole="button">
                <Icon name={showPrompt ? 'chevron-up' : 'chevron-down'} size={18} tone="primary" />
                <Txt className="text-primary text-[13px] leading-[20px] font-bold">{showPrompt ? t('md.req.hidePrompt') : t('md.req.showPrompt')}</Txt>
              </Pressable>
              {Platform.OS === 'web' ? <Pressable testID="req-prompt-copy" onPress={copy} hitSlop={8} className="flex-row items-center gap-1 px-2.5 h-8 rounded-full bg-surface2 active:opacity-70" accessibilityRole="button"><Icon name="content-copy" size={14} /><Txt className="text-[12px] leading-[18px] font-semibold">{t('md.req.copyPrompt')}</Txt></Pressable> : null}
            </View>
            {showPrompt ? <View className="px-3 pb-3"><Txt testID="req-prompt" className="text-[12px] leading-[19px] text-muted" selectable style={{ writingDirection: 'ltr', textAlign: 'left' }}>{prompt}</Txt></View> : null}
          </View>
        ) : null}
      </Section>
    </View>
  );
}

/** Opens the viewer on the request's pictures. `index` null = closed. */
export function RequestViewer({ r, index, onIndex, onClose }: { r: RenderRequest; index: number | null; onIndex?: (i: number) => void; onClose: () => void }) {
  const shots = useRequestShots(r);
  return <ImageViewer items={shots} index={index} onIndexChange={onIndex} onClose={onClose} />;
}
