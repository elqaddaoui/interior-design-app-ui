import { FX, FX_FADE, ease, layerFrame, layerGeometry, makeCfg } from './toolCardFx';
import { frames, planTimeline } from './cardVideoPlan';
import { drawExtras } from './cardVideoExtras';
import type { RenderOptions, RenderSupport } from './cardVideoRender';

export type { RenderOptions, RenderSupport } from './cardVideoRender';

/** Encoders tried in order: H.264 plays everywhere (every phone has a hardware decoder), then VP9 / AV1 in MP4 for browsers that cannot encode H.264. */
const CODECS = ['avc', 'vp9', 'av1'] as const;

/** Whether this browser can render and encode (WebCodecs) and which codec it will use. */
export async function canRenderVideo(size = { width: 720, height: 450 }): Promise<RenderSupport> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return { ok: false, reason: 'no-webcodecs' };
  const { getFirstEncodableVideoCodec } = await import('mediabunny');
  const codec = await getFirstEncodableVideoCodec([...CODECS], { width: size.width, height: size.height }).catch(() => null);
  return codec ? { ok: true, codec } : { ok: false, reason: 'no-encoder' };
}

/** One picture as a bitmap. `cors` mode on purpose: a picture served without CORS headers would taint the canvas and the frames could not be encoded. */
async function loadBitmap(url: string): Promise<ImageBitmap> {
  let res: Response;
  try { res = await fetch(url, { mode: 'cors', credentials: 'omit' }); } catch { throw new Error('IMAGE_CORS'); }
  if (!res.ok) throw new Error('IMAGE_LOAD');
  try { return await createImageBitmap(await res.blob()); } catch { throw new Error('IMAGE_DECODE'); }
}

/** Draws one picture covering the whole W x H canvas (object-fit: cover). Pictures keep their own ratio, so they are centre-filled exactly like the live card does. */
function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap, W: number, H: number) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

/**
 * Draws one frame of a transition: `front` fully, then `back` revealed through the effect's window.
 * Same maths as the live engine (lib/toolCardFx.ts): the window is the clipping container (rect or circle) moved by the container transform;
 * the photo inside has the exact inverse transform, so it never moves: drawing it untransformed inside the clip is the same picture.
 */
function drawTransition(ctx: CanvasRenderingContext2D, front: ImageBitmap, back: ImageBitmap, effect: number, rtl: boolean, W: number, H: number, u: number) {
  const cfg = makeCfg(FX[effect] ?? FX[FX_FADE], rtl);
  drawCover(ctx, front, W, H);
  const f = layerFrame(cfg, W, H, 1, ease(cfg.e, u));
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
  drawCover(ctx, back, W, H);
  ctx.restore();
}

/** Lets the page paint (progress bar, other cards) between frames: the render is long but never freezes the admin. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Renders the looping card animation to an MP4 (no audio, fast-start so it streams, modest bitrate for a small file) entirely in the browser.
 * Resolves the MP4 as a Blob. Rejects with: VIDEO_RENDER_UNSUPPORTED, IMAGE_CORS / IMAGE_LOAD / IMAGE_DECODE, VIDEO_TOO_LONG, ABORTED.
 */
export async function renderCardVideo(o: RenderOptions): Promise<Blob> {
  const plan = planTimeline(o.images.length, o.effects, o.hold, o.speed);
  if (!plan.segments.length) throw new Error('VIDEO_NOTHING_TO_RENDER');
  if (plan.duration > 60) throw new Error('VIDEO_TOO_LONG');
  const support = await canRenderVideo({ width: o.width, height: o.height });
  if (!support.ok || !support.codec) throw new Error('VIDEO_RENDER_UNSUPPORTED');
  const abort = () => { if (o.signal?.aborted) throw new Error('ABORTED'); };

  const bitmaps: ImageBitmap[] = [];
  try {
    for (const url of o.images) { abort(); bitmaps.push(await loadBitmap(url)); }
    const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality } = await import('mediabunny');
    const canvas = document.createElement('canvas');
    canvas.width = o.width; canvas.height = o.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('VIDEO_RENDER_UNSUPPORTED');
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    // Slideshow content compresses very well: "medium" is sharp on a phone screen and keeps the file small (a few hundred KB).
    const source = new CanvasSource(canvas, { codec: support.codec as 'avc', quality: new Quality('medium'), keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: 30 });
    await output.start();
    let done = 0;
    for (const f of frames(plan)) {
      abort();
      if (f.seg.kind === 'hold') drawCover(ctx, bitmaps[f.seg.from], o.width, o.height);
      else {
        drawTransition(ctx, bitmaps[f.seg.from], bitmaps[f.seg.to], f.seg.effect, o.rtl, o.width, o.height, f.u);
        // Optional: every animated element of the transition (edge line, knob, doors, ring, star badges ...), exactly like the live card.
        if (o.extras) drawExtras(ctx, f.seg.effect, o.rtl, o.width, o.height, f.u, o.accent ?? '#1D9E75');
      }
      await source.add(f.t, f.dur);
      done++;
      if (done % 4 === 0) { o.onProgress?.(done, plan.frames); await breathe(); }
    }
    source.close();
    await output.finalize();
    o.onProgress?.(plan.frames, plan.frames);
    if (!target.buffer) throw new Error('VIDEO_RENDER_UNSUPPORTED');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally { bitmaps.forEach((b) => b.close()); }
}
