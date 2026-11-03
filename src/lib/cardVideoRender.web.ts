import { backMotion, ease, frontMotion, layerFrame, layerGeometry, motionOrigin, type Cfg } from './toolCardFx';
import { frames, planTimeline, qualityPreset, presetBitrate, type RenderSettings } from './cardVideoPlan';
import { apiBlob } from './backend';
import { cfgFor, drawExtras } from './cardVideoExtras';
import { studioHasExtras, studioMoves } from './fxStudio';
import type { FramePreview, RenderOptions, RenderSupport } from './cardVideoRender';

export type { FramePreview, RenderInfo, RenderOptions, RenderSupport } from './cardVideoRender';

/** Encoders tried in order: H.264 plays everywhere (every phone has a hardware decoder), then VP9 / AV1 in MP4 for browsers that cannot encode H.264. */
const CODECS = ['avc', 'vp9', 'av1'] as const;

/** Whether this browser can render and encode (WebCodecs) and which codec it will use (`prefer` first, then the usual order). */
export async function canRenderVideo(size = { width: 720, height: 450 }, prefer: 'auto' | 'avc' | 'vp9' | 'av1' = 'auto'): Promise<RenderSupport> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return { ok: false, reason: 'no-webcodecs' };
  const { getFirstEncodableVideoCodec } = await import('mediabunny');
  const order = prefer === 'auto' ? [...CODECS] : [prefer, ...CODECS.filter((c) => c !== prefer)];
  const codec = await getFirstEncodableVideoCodec(order, { width: size.width, height: size.height }).catch(() => null);
  return codec ? { ok: true, codec } : { ok: false, reason: 'no-encoder' };
}

/**
 * The real path of a picture on this server, or null for an external picture. Stored media is `/api/media/<hash>.<ext>` (relative, or absolute
 * on a native-style build); both forms are the server's own files, which the admin proxy can always read.
 */
const mediaId = (url: string) => /\/api\/media\/([a-f0-9]{32}\.[a-z0-9]+)(?:[?#].*)?$/.exec(url)?.[1] ?? null;

/**
 * One picture as a bitmap. A direct CORS read is tried first (no extra traffic when the storage allows it). Browsers refuse to read a picture
 * served without CORS headers (an R2 bucket with no rule for the admin origin, or an external image link), and a canvas fed by such a picture
 * could not be encoded. In that case the picture is fetched through the signed-in admin proxy of OUR server (`/admin/media/fetch`), which is
 * same-origin and needs no bucket setup. Only when both fail is the CORS error reported.
 */
async function loadBitmap(url: string): Promise<ImageBitmap> {
  let blob: Blob | null = null;
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error('IMAGE_LOAD');
    blob = await res.blob();
  } catch (error) {
    if (error instanceof Error && error.message === 'IMAGE_LOAD' && mediaId(url) === null) throw error;
    try { blob = await apiBlob(`/admin/media/fetch?url=${encodeURIComponent(url)}`, 60000); }
    catch (proxyError) {
      const code = (proxyError as { code?: string; status?: number }).code ?? '';
      // The proxy answered (the picture is blocked / missing / too big): it is a load problem. No answer at all: the original CORS refusal stands.
      throw new Error(code && code !== 'BACKEND_UNAVAILABLE' && code !== 'UNAUTHORIZED' ? 'IMAGE_LOAD' : 'IMAGE_CORS');
    }
  }
  try { return await createImageBitmap(blob); } catch { throw new Error('IMAGE_DECODE'); }
}

/** Draws one picture covering the whole W x H canvas (object-fit: cover). Pictures keep their own ratio, so they are centre-filled exactly like the live card does. */
function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap, W: number, H: number, m?: { s: number; tx: number; ty: number }, o?: { x: number; y: number }) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s, h = img.height * s;
  if (m && (m.s !== 1 || m.tx !== 0 || m.ty !== 0) && o) {
    // The Studio's photo motion: translate, then zoom about the photo's own origin (same order as the live transform list).
    ctx.save();
    ctx.translate(m.tx, m.ty); ctx.translate(o.x, o.y); ctx.scale(m.s, m.s); ctx.translate(-o.x, -o.y);
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    ctx.restore();
    return;
  }
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

/**
 * Draws one frame of a transition: `front` fully, then `back` revealed through the effect's window.
 * Same maths as the live engine (lib/toolCardFx.ts): the window is the clipping container (rect or circle) moved by the container transform;
 * the photo inside has the exact inverse transform, so it never moves: drawing it untransformed inside the clip is the same picture.
 */
function drawTransition(ctx: CanvasRenderingContext2D, front: ImageBitmap, back: ImageBitmap, cfg: Cfg, W: number, H: number, u: number) {
  const q = ease(cfg.e, u, cfg.ep);
  const o = motionOrigin(cfg, W, H);
  // The covered photo keeps growing / is pushed while the incoming one covers it (Studio photo motion; identity without a style).
  drawCover(ctx, front, W, H, frontMotion(cfg, W, H, q), o);
  const f = layerFrame(cfg, W, H, 1, q);
  if (f.o <= 0) return;
  const g = layerGeometry(cfg, W, H).box as { left: number; top: number; width: number; height: number; borderRadius?: number; transformOrigin?: string };
  const [ox, oy] = String(g.transformOrigin ?? '50% 50%').split(' ').map((p, i) => (p.endsWith('%') ? (parseFloat(p) / 100) * (i ? g.height : g.width) : parseFloat(p)));
  ctx.save();
  // container transform about its origin (CSS order: the list is applied left to right)
  ctx.translate(g.left + ox, g.top + oy);
  for (const t of f.ct as Record<string, number | string>[]) {
    if ('rotate' in t) ctx.rotate((parseFloat(String(t.rotate)) * Math.PI) / 180);
    else if ('translateX' in t) ctx.translate(Number(t.translateX), 0);
    else if ('scaleX' in t) ctx.scale(Number(t.scaleX), 1);
    else if ('scaleY' in t) ctx.scale(1, Number(t.scaleY));
  }
  ctx.translate(-(g.left + ox), -(g.top + oy));
  ctx.beginPath();
  if ((g.borderRadius ?? 0) >= g.width / 2 && g.width === g.height) ctx.arc(g.left + g.width / 2, g.top + g.height / 2, g.width / 2, 0, Math.PI * 2);
  else ctx.rect(g.left, g.top, g.width, g.height);
  ctx.clip();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.min(1, Math.max(0, f.o));
  drawCover(ctx, back, W, H, backMotion(cfg, q), o);
  ctx.restore();
}

/** Lets the page paint (progress bar, other cards) between frames: the render is long but never freezes the admin. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Settings of a render: the explicit ones, else the quality preset at the requested size. */
function settingsOf(o: RenderOptions): RenderSettings {
  if (o.render) return o.render;
  const p = qualityPreset(o.quality);
  return { quality: o.quality ?? 'balanced', width: o.width, height: o.height, fps: p.fps, fit: false, minMB: 1, maxMB: 1.5, bitrate: null, bitrateStep: p.bitrate, keyInt: 2, codec: 'auto', real: false };
}

type Codec = 'avc' | 'vp9' | 'av1';
/** Bit rate asked from the encoder (bit/s). `null` = the preset's own quality step. */
type Rate = number | null;

/**
 * One encoding pass: draws every frame of `plan` (optionally only the frames `keep` accepts) and encodes them at `rate`.
 * The same drawing code serves the full render, the size-fitting passes and the short clip of the frame preview.
 */
async function encodePass(o: RenderOptions, rs: RenderSettings, codec: Codec, rate: Rate, bitmaps: ImageBitmap[], plan: ReturnType<typeof planTimeline>, studio: RenderOptions['studio'], opts: { keep?: (t: number) => boolean; pass: number; passes: number; report: boolean }): Promise<Blob> {
  const cursors = new Map<unknown, number>();
  plan.segments.filter((x) => x.kind === 'transition').forEach((x, k) => cursors.set(x, k));
  const cursor = (seg: unknown) => cursors.get(seg) ?? 0;
  const abort = () => { if (o.signal?.aborted) throw new Error('ABORTED'); };
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality } = await import('mediabunny');
  const canvas = document.createElement('canvas');
  canvas.width = rs.width; canvas.height = rs.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('VIDEO_RENDER_UNSUPPORTED');
  ctx.imageSmoothingQuality = 'high';
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const quality = rate ? new Quality({ bitrate: rate, bitrateMode: 'variable' }) : new Quality(rs.bitrateStep === 'low' ? 'low' : rs.bitrateStep === 'high' ? 'high' : rs.bitrateStep === 'very-high' ? 'very-high' : 'medium');
  const source = new CanvasSource(canvas, { codec, quality, keyFrameInterval: rs.keyInt });
  output.addVideoTrack(source, { frameRate: rs.fps });
  await output.start();
  let done = 0, t0 = -1;
  for (const f of frames(plan)) {
    abort();
    if (opts.keep && !opts.keep(f.t)) continue;
    if (t0 < 0) t0 = f.t;
    if (f.seg.kind === 'hold') drawCover(ctx, bitmaps[f.seg.from], rs.width, rs.height);
    else {
      // Number of the transition in the loop: the style's direction modes (alternate / random) depend on it, exactly like the live card.
      const { def, cfg } = cfgFor(f.seg.effect, o.rtl, studio ?? null, cursor(f.seg));
      drawTransition(ctx, bitmaps[f.seg.from], bitmaps[f.seg.to], cfg, rs.width, rs.height, f.u);
      // Optional: every animated element of the transition (edge line, knob, doors, ring, star badges ...) and the style's tint / bar / pieces, exactly like the live card.
      if (o.extras) drawExtras(ctx, def, cfg, rs.width, rs.height, f.u, o.accent ?? '#1D9E75', studio ?? null);
    }
    await source.add(f.t - t0, f.dur);
    done++;
    if (done % 4 === 0) { if (opts.report) o.onProgress?.(done, plan.frames, opts.pass, opts.passes); await breathe(); }
  }
  source.close();
  await output.finalize();
  if (!target.buffer) throw new Error('VIDEO_RENDER_UNSUPPORTED');
  return new Blob([target.buffer], { type: 'video/mp4' });
}

const MB = 1048576;
/** Most passes the size fitting may take (each pass is a full encode; the first one is usually within 25 % of the window). */
const MAX_PASSES = 5;

/**
 * Renders the looping card animation to an MP4 (no audio, fast-start so it streams) entirely in the browser.
 * With a size window (`render.fit`, the "Best" preset) the encoder is re-run with a corrected bit rate until the file lands between
 * `minMB` and `maxMB`; without it the preset's quality step (or the manual bit rate) is used once.
 * Resolves the MP4 as a Blob. Rejects with: VIDEO_RENDER_UNSUPPORTED, IMAGE_CORS / IMAGE_LOAD / IMAGE_DECODE, VIDEO_TOO_LONG, ABORTED.
 */
export async function renderCardVideo(o: RenderOptions): Promise<Blob> {
  const rs = settingsOf(o);
  const plan = planTimeline(o.images.length, o.effects, o.hold, o.speed, rs.fps);
  // A style that neither moves anything nor draws anything is the plain effect.
  const studio = o.studio && (studioMoves(o.studio) || studioHasExtras(o.studio)) ? o.studio : null;
  if (!plan.segments.length) throw new Error('VIDEO_NOTHING_TO_RENDER');
  if (plan.duration > 60) throw new Error('VIDEO_TOO_LONG');
  const support = await canRenderVideo({ width: rs.width, height: rs.height }, rs.codec);
  if (!support.ok || !support.codec) throw new Error('VIDEO_RENDER_UNSUPPORTED');
  const codec = support.codec as Codec;
  const abort = () => { if (o.signal?.aborted) throw new Error('ABORTED'); };

  const bitmaps: ImageBitmap[] = [];
  try {
    for (const url of o.images) { abort(); bitmaps.push(await loadBitmap(url)); }
    if (!rs.fit) {
      const blob = await encodePass(o, rs, codec, rs.bitrate, bitmaps, plan, studio, { pass: 1, passes: 1, report: true });
      o.onProgress?.(plan.frames, plan.frames, 1, 1);
      o.onInfo?.({ passes: 1, bytes: blob.size, bitrate: rs.bitrate ?? presetBitrate(rs.bitrateStep, rs.width, rs.height, codec), codec, inWindow: true });
      return blob;
    }
    // Size window: aim at the middle of it (a little below: the container adds ~1 %), correct the bit rate by the ratio target / actual.
    const lo = rs.minMB * MB, hi = rs.maxMB * MB, goal = (lo + hi) / 2 * 0.985;
    let rate = Math.max(150e3, Math.min(60e6, Math.round((goal * 8) / plan.duration / 0.55)));
    let best: { blob: Blob; rate: number } | null = null;
    // Bit rates already known to be too big / too small: the next try always stays strictly between them.
    let tooBig = Infinity, tooSmall = 0;
    let passes = 0;
    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      abort();
      passes = pass;
      const blob = await encodePass(o, rs, codec, rate, bitmaps, plan, studio, { pass, passes: MAX_PASSES, report: true });
      const inside = blob.size >= lo && blob.size <= hi;
      // Keep the best candidate: inside the window wins; else the biggest file that is under the maximum; else the smallest one over it.
      const better = !best || (inside && !(best.blob.size >= lo && best.blob.size <= hi)) || (blob.size <= hi && (best.blob.size > hi || blob.size > best.blob.size)) || (blob.size > hi && best.blob.size > hi && blob.size < best.blob.size);
      if (better) best = { blob, rate };
      if (inside) break;
      if (blob.size > hi) tooBig = Math.min(tooBig, rate); else tooSmall = Math.max(tooSmall, rate);
      // The encoder spends bits roughly in proportion to the rate until the picture is as good as it gets (then the file stops growing: give up).
      let next = rate * Math.min(4, Math.max(0.35, goal / Math.max(1, blob.size)));
      if (tooBig < Infinity && tooSmall > 0) next = Math.sqrt(tooBig * tooSmall);
      else if (next >= tooBig) next = tooBig * 0.8; else if (next <= tooSmall) next = tooSmall * 1.25;
      if (blob.size < lo && rate >= 60e6) break;
      if (Math.abs(next - rate) / rate < 0.02) break;
      rate = Math.round(Math.max(150e3, Math.min(60e6, next)));
    }
    o.onProgress?.(plan.frames, plan.frames, passes, MAX_PASSES);
    const final = best!;
    o.onInfo?.({ passes, bytes: final.blob.size, bitrate: final.rate, codec, inWindow: final.blob.size >= lo && final.blob.size <= hi });
    return final.blob;
  } finally { bitmaps.forEach((b) => b.close()); }
}

/**
 * The frame in the middle of the first transition, drawn at the chosen output size and really COMPRESSED: a short clip that ends on that frame is
 * encoded with the same bit rate per second as the full video, then the frame is decoded back. What you see is what the video will look like
 * (resolution, blockiness, banding). Falls back to the uncompressed canvas when the clip cannot be decoded.
 */
export async function previewFrame(o: RenderOptions): Promise<FramePreview> {
  const rs = settingsOf(o);
  const plan = planTimeline(o.images.length, o.effects, o.hold, o.speed, rs.fps);
  const studio = o.studio && (studioMoves(o.studio) || studioHasExtras(o.studio)) ? o.studio : null;
  if (!plan.segments.length) throw new Error('VIDEO_NOTHING_TO_RENDER');
  const support = await canRenderVideo({ width: rs.width, height: rs.height }, rs.codec);
  if (!support.ok || !support.codec) throw new Error('VIDEO_RENDER_UNSUPPORTED');
  const codec = support.codec as Codec;
  const firstMove = plan.segments.find((x) => x.kind === 'transition')!;
  const midT = firstMove.t0 + (firstMove.t1 - firstMove.t0) / 2;
  const bitmaps: ImageBitmap[] = [];
  try {
    for (const url of o.images.slice(0, 2)) bitmaps.push(await loadBitmap(url));
    // The clip: the first transition up to its middle frame (+ one frame so the middle frame is not the last), at the video's bit rate.
    const clipPlan = { ...plan, segments: [firstMove], frames: firstMove.frames, duration: firstMove.t1 - firstMove.t0 };
    const tail = Math.round(firstMove.frames / 2) + 1;
    let rate: Rate = rs.bitrate;
    if (!rs.fit && !rate) rate = presetBitrate(rs.bitrateStep, rs.width, rs.height, codec);
    if (rs.fit) {
      // The same bits-per-pixel the fitted full render gets: (middle of the window x 8) over the duration of the whole loop, spent on moving frames.
      const full = estimateRate(rs, plan.duration, plan.frames, firstMove.frames, o.images.length);
      rate = full;
    }
    const pass = { ...clipPlan, frames: tail };
    const blob = await encodePass({ ...o, onProgress: undefined }, rs, codec, rate, bitmaps.length > 1 ? bitmaps : [bitmaps[0], bitmaps[0]], pass, studio, { pass: 1, passes: 1, report: false, keep: (t) => t - firstMove.t0 <= midT - firstMove.t0 + 1e-6 });
    const frame = await decodeLast(blob, midT - firstMove.t0).catch(() => null);
    if (frame) return { url: frame, width: rs.width, height: rs.height, clipBytes: blob.size, compressed: true };
    // Fallback: the raw canvas.
    const canvas = document.createElement('canvas'); canvas.width = rs.width; canvas.height = rs.height;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const { def, cfg } = cfgFor(firstMove.effect, o.rtl, studio, 0);
    drawTransition(ctx, bitmaps[0], bitmaps[1] ?? bitmaps[0], cfg, rs.width, rs.height, 0.5);
    if (o.extras) drawExtras(ctx, def, cfg, rs.width, rs.height, 0.5, o.accent ?? '#1D9E75', studio);
    return { url: canvas.toDataURL('image/png'), width: rs.width, height: rs.height, clipBytes: 0, compressed: false };
  } finally { bitmaps.forEach((b) => b.close()); }
}

/** Bit rate (bit/s) a fitted render of this loop is expected to run at: the middle of the window, spent mostly on the moving frames. */
function estimateRate(rs: RenderSettings, duration: number, frames: number, moveFramesOfOne: number, pictures: number): number {
  const moveFrames = moveFramesOfOne * pictures;
  const moveSec = moveFrames / rs.fps, holdSec = Math.max(0, duration - moveSec);
  const util = (moveSec * 0.9 + holdSec * 0.06) / Math.max(0.001, duration);
  void frames;
  return Math.round((((rs.minMB + rs.maxMB) / 2) * MB * 8) / (duration * Math.max(0.05, util)));
}

/** Decodes the frame at `t` seconds of an MP4 into a PNG data URL. */
async function decodeLast(blob: Blob, t: number): Promise<string> {
  const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no track');
    const sink = new CanvasSink(track);
    const wrapped = await sink.getCanvas(t);
    if (!wrapped) throw new Error('no frame');
    const c = wrapped.canvas as HTMLCanvasElement;
    return c.toDataURL('image/png');
  } finally { input.dispose(); }
}
