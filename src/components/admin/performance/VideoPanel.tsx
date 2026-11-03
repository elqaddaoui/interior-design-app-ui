import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Image } from 'expo-image';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { Txt } from '@/components/ui/Txt';
import { useL, useT } from '@/i18n';
import { toast } from '@/store/useToast';
import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme/ThemeProvider';
import { mediaUploadsEnabled, uploadBlob } from '@/lib/media';
import { availFromKey, availKey, cardEffectList, effectiveStudio, imageHeight, mediaFx, resolveGlobal, slideshowImages } from '@/lib/toolCards';
import { accentOf, studioSig } from '@/lib/fxStudio';
import { VIDEO_QUALITY_ORDER, VIDEO_RTL, qualityPreset, videoSignature, videoSize, videoStatus, type VideoStatus } from '@/lib/cardVideoPlan';
import { canRenderVideo, renderCardVideo, type RenderSupport } from '@/lib/cardVideoRender';
import type { Tool, VideoMode, VideoQuality } from '@/data/types';

/** Width a phone card typically has: the video takes the shape of the image zone at this width (the card itself crops with `cover`). */
const REF_WIDTH = 360;
/** Demo mode has no media storage: a small video is kept inside the stored tool itself (data URL) so the whole flow still works. */
const DEMO_MAX = 1.5 * 1024 * 1024;
const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  if (blob.size > DEMO_MAX) return reject(new Error('MEDIA_TOO_LARGE'));
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('read failed'));
  reader.readAsDataURL(blob);
});
const fmtSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

type Job = { state: 'wait' | 'run' | 'upload' | 'done' | 'error'; pct: number; error?: string; size?: number };

/** Admin > Performance > Video preview: renders the looping MP4 of each animated card, uploads it, and assigns it to the card. */
export function VideoPanel({ videoMode, onMode, extras, onExtras, quality, onQuality }: { videoMode: VideoMode; onMode: (m: VideoMode) => void; extras: boolean; onExtras: (on: boolean) => void; quality: VideoQuality; onQuality: (q: VideoQuality) => void }) {
  const { t } = useT();
  const { colors } = useTheme();
  const pick = useL();
  const tools = useStore((s) => s.tools);
  const settings = useStore((s) => s.doc.settings.toolCards);
  const key = availKey(settings);
  const avail = useMemo(() => availFromKey(key), [key]);
  const global = resolveGlobal(settings);
  const ratio = REF_WIDTH / imageHeight(global.height, global.textPlacement === 'inside', 72);
  const preset = qualityPreset(quality);
  const size = videoSize(ratio, preset.maxWidth);

  const [support, setSupport] = useState<RenderSupport | null>(null);
  useEffect(() => { let alive = true; void canRenderVideo(size).then((s) => { if (alive) setSupport(s); }); return () => { alive = false; }; }, [size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animated cards = slideshows with 2+ pictures.
  const cards = useMemo(() => tools.filter((x) => slideshowImages(x.media).length >= 2).map((tool) => {
    const fx = mediaFx(tool.media);
    const images = slideshowImages(tool.media);
    // The card's Animation Studio style (its own, else the global one): it changes the picture of the video, so it is part of the signature.
    const studio = effectiveStudio(global.studio, fx);
    const effects = cardEffectList(fx, avail, false, studio);
    const sig = videoSignature(images, effects, fx.hold, fx.speed, VIDEO_RTL, extras, quality, studio ? studioSig(studio) : '');
    return { tool, images, fx, effects, sig, studio, status: videoStatus(tool.media.video, tool.media.videoSig, sig) as VideoStatus };
  }), [tools, avail, extras, quality, global.studio]);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const ids = cards.map((c) => c.tool.id);
  const allOn = ids.length > 0 && ids.every((id) => picked.has(id));
  const someOn = ids.some((id) => picked.has(id));
  const toggle = (id: string) => setPicked((old) => { const n = new Set(old); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(ids));
  const setJob = (id: string, job: Job) => setJobs((old) => ({ ...old, [id]: job }));

  const errText = (e: unknown) => {
    const m = e instanceof Error ? e.message : '';
    if (m === 'IMAGE_CORS') return t('ax.vid.errCors');
    if (m === 'ABORTED') return t('ax.vid.cancelled');
    if (m === 'VIDEO_TOO_LONG') return t('ax.vid.errLong');
    if (m === 'VIDEO_RENDER_UNSUPPORTED') return t('ax.vid.noEncoder');
    if (m === 'MEDIA_TOO_LARGE') return t('ax.vid.errBig');
    return t('ax.vid.errGeneric');
  };

  /** Renders, uploads and assigns the video of the given cards, one after the other (one encoder at a time keeps a phone browser alive). */
  const run = useCallback(async (list: typeof cards) => {
    if (!list.length || busy) return;
    setBusy(true);
    const ctl = new AbortController(); abort.current = ctl;
    setJobs((old) => { const n = { ...old }; list.forEach((c) => { n[c.tool.id] = { state: 'wait', pct: 0 }; }); return n; });
    let ok = 0;
    for (const c of list) {
      if (ctl.signal.aborted) break;
      const id = c.tool.id;
      try {
        setJob(id, { state: 'run', pct: 0 });
        const blob = await renderCardVideo({ images: c.images, effects: c.effects, hold: c.fx.hold, speed: c.fx.speed, rtl: VIDEO_RTL, extras, quality, accent: accentOf(c.studio, colors.primary), studio: c.studio, width: size.width, height: size.height, signal: ctl.signal, onProgress: (d, total) => setJob(id, { state: 'run', pct: d / total }) });
        setJob(id, { state: 'upload', pct: 1 });
        const url = mediaUploadsEnabled ? await uploadBlob(blob) : await toDataUrl(blob);
        // Assigned straight away: the card's video type is this file from now on (the latest media is read again: the admin may have edited the card meanwhile).
        const latest = useStore.getState().tools.find((x) => x.id === id) ?? c.tool;
        await useStore.getState().update('tools', id, { media: { ...latest.media, video: url, videoSig: c.sig } });
        setJob(id, { state: 'done', pct: 1, size: blob.size });
        ok++;
      } catch (e) { setJob(id, { state: 'error', pct: 0, error: errText(e) }); }
    }
    abort.current = null;
    setBusy(false);
    if (ok) toast(t('ax.vid.done', { count: ok }));
  }, [busy, size.width, size.height, extras, quality, colors.primary]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (tool: Tool) => {
    const { video: _v, videoSig: _s, ...rest } = tool.media;
    await useStore.getState().update('tools', tool.id, { media: rest });
    setJobs((old) => { const n = { ...old }; delete n[tool.id]; return n; });
    if (preview === tool.media.video) setPreview(null);
  };

  const chosen = cards.filter((c) => picked.has(c.tool.id));
  const outdated = cards.filter((c) => c.status !== 'ready');
  const unsupported = support && !support.ok;
  const title = (tool: Tool) => pick(tool.title) || tool.id;
  const modes: { key: VideoMode; label: string }[] = [{ key: 'lowEnd', label: t('ax.vid.modeLow') }, { key: 'always', label: t('ax.vid.modeAlways') }, { key: 'off', label: t('ax.vid.modeOff') }];

  return (
    <View testID="video-panel">
      <Card className="p-3 mb-3">
        <View className="flex-row items-center gap-2 mb-1">
          <Icon name="movie-open-outline" size={20} tone="primary" />
          <Txt className="font-extrabold text-[17px] flex-1">{t('ax.vid.title')}</Txt>
        </View>
        <Txt className="text-muted text-[13px] mb-3">{t('ax.vid.intro')}</Txt>
        <Txt className="font-bold text-[13px] mb-2">{t('ax.vid.mode')}</Txt>
        <Segmented testID="video-mode" value={videoMode} options={modes} onChange={onMode} />
        <Txt className="text-muted text-[12px] mt-2">{t(`ax.vid.modeHint.${videoMode}`)}</Txt>
        <Txt className="font-bold text-[13px] mt-4 mb-2">{t('ax.vid.quality')}</Txt>
        <Segmented testID="video-quality" value={quality} options={VIDEO_QUALITY_ORDER.map((q) => ({ key: q, label: t(`ax.vid.q.${q}`) }))} onChange={onQuality} />
        <Txt testID="video-quality-hint" className="text-muted text-[12px] mt-2">{t(`ax.vid.qHint.${quality}`, { w: preset.maxWidth, fps: preset.fps })}</Txt>
        <Txt className="text-muted text-[12px] mt-1">{t('ax.vid.qNote')}</Txt>
        <View className="mt-3 flex-row items-start gap-3">
          <Checkbox testID="video-extras" state={extras} onPress={() => onExtras(!extras)} label={t('ax.vid.extras')} />
          <View className="flex-1">
            <Txt className="font-bold text-[13px]" onPress={() => onExtras(!extras)}>{t('ax.vid.extras')}</Txt>
            <Txt className="text-muted text-[12px] mt-1">{t('ax.vid.extrasHint')}</Txt>
          </View>
        </View>
        <View className="mt-3 flex-row items-center gap-2">
          <Icon name={unsupported ? 'alert-outline' : 'check-circle-outline'} size={16} tone={unsupported ? 'danger' : 'primary'} />
          <Txt testID="video-support" className="text-[12px] flex-1 text-muted">
            {support == null ? t('ax.vid.checking') : support.ok ? t('ax.vid.supported', { codec: String(support.codec).toUpperCase(), w: size.width, h: size.height }) : support.reason === 'native' || Platform.OS !== 'web' ? t('ax.vid.nativeNote') : support.reason === 'no-webcodecs' ? t('ax.vid.noWebcodecs') : t('ax.vid.noEncoder')}
          </Txt>
        </View>
      </Card>

      <Card className="p-3 mb-3">
        <View className="flex-row items-center gap-3 mb-2">
          <Checkbox testID="video-select-all" state={allOn ? true : someOn ? 'mixed' : false} onPress={toggleAll} label={t('ax.vid.selectAll')} disabled={busy || !cards.length} />
          <Txt className="font-bold flex-1">{t('ax.vid.selectAll')} <Txt className="text-muted font-normal">({t('ax.vid.selected', { n: chosen.length, total: cards.length })})</Txt></Txt>
        </View>
        <View className="flex-row flex-wrap gap-2 mb-1">
          <Button testID="video-render-selected" size="sm" icon="movie-open-outline" title={t('ax.vid.renderSelected', { n: chosen.length })} disabled={!chosen.length || !!unsupported || busy || !support} onPress={() => run(chosen)} />
          <Button testID="video-render-missing" size="sm" variant="soft" title={t('ax.vid.renderMissing', { n: outdated.length })} disabled={!outdated.length || !!unsupported || busy || !support} onPress={() => run(outdated)} />
          {busy ? <Button testID="video-cancel" size="sm" variant="outline" title={t('ax.vid.cancel')} onPress={() => abort.current?.abort()} /> : null}
        </View>
        {!cards.length ? <Txt testID="video-empty" className="text-muted text-[13px] py-6 text-center">{t('ax.vid.empty')}</Txt> : null}
        {cards.map((c) => {
          const job = jobs[c.tool.id];
          const running = job && (job.state === 'run' || job.state === 'upload' || job.state === 'wait');
          const badge = c.status === 'ready' ? { icon: 'check-circle-outline', text: t('ax.vid.ready'), tone: 'primary' as const } : c.status === 'outdated' ? { icon: 'alert-outline', text: t('ax.vid.outdated'), tone: 'danger' as const } : { icon: 'minus-circle-outline', text: t('ax.vid.none'), tone: 'muted' as const };
          return (
            <View key={c.tool.id} testID={`video-row-${c.tool.id}`} className="py-3 border-t border-line">
              <View className="flex-row items-center gap-3">
                <Checkbox testID={`video-pick-${c.tool.id}`} state={picked.has(c.tool.id)} onPress={() => toggle(c.tool.id)} label={title(c.tool)} disabled={busy} />
                <Image source={{ uri: c.images[0] }} style={{ width: 56, height: 40, borderRadius: 8 }} contentFit="cover" />
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <Txt className="font-bold text-[14px]" numberOfLines={1}>{title(c.tool)}</Txt>
                  <View className="flex-row items-center gap-1 mt-0.5">
                    <Icon name={badge.icon} size={14} tone={badge.tone} />
                    <Txt testID={`video-status-${c.tool.id}`} className="text-muted text-[12px]" numberOfLines={1}>{badge.text} · {t('ax.vid.pictures', { n: c.images.length })}{job?.size ? ` · ${fmtSize(job.size)}` : ''}</Txt>
                  </View>
                </View>
                <Button testID={`video-render-${c.tool.id}`} size="sm" variant="soft" title={c.status === 'none' ? t('ax.vid.render') : t('ax.vid.rerender')} disabled={!!unsupported || busy || !support} onPress={() => run([c])} />
              </View>
              {running ? (
                <View className="mt-2">
                  <View className="h-2 rounded-full bg-surface2 overflow-hidden"><View testID={`video-bar-${c.tool.id}`} className="h-2 bg-primary" style={{ width: `${Math.round((job.state === 'run' ? job.pct : 1) * 100)}%` }} /></View>
                  <Txt className="text-muted text-[11px] mt-1">{job.state === 'wait' ? t('ax.vid.waiting') : job.state === 'run' ? t('ax.vid.rendering', { pct: Math.round(job.pct * 100) }) : t('ax.vid.uploading')}</Txt>
                </View>
              ) : null}
              {job?.state === 'error' ? <Txt className="text-danger text-[12px] mt-1">{job.error}</Txt> : null}
              {c.tool.media.video ? (
                <View className="flex-row gap-2 mt-2">
                  <Button testID={`video-preview-${c.tool.id}`} size="sm" variant="ghost" icon="play" title={preview === c.tool.media.video ? t('ax.vid.hide') : t('ax.vid.preview')} onPress={() => setPreview(preview === c.tool.media.video ? null : c.tool.media.video!)} />
                  <Button testID={`video-delete-${c.tool.id}`} size="sm" variant="ghost" icon="delete-outline" title={t('ax.vid.delete')} disabled={busy} onPress={() => remove(c.tool)} />
                </View>
              ) : null}
              {preview && preview === c.tool.media.video && Platform.OS === 'web'
                ? <View className="mt-2 rounded-xl overflow-hidden bg-surface2" style={{ aspectRatio: size.width / size.height, maxWidth: 480 }}>{React.createElement('video', { src: preview, controls: true, loop: true, muted: true, autoPlay: true, playsInline: true, style: { width: '100%', height: '100%', objectFit: 'cover' } })}</View>
                : null}
            </View>
          );
        })}
      </Card>
    </View>
  );
}
