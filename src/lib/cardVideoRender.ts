import type { VideoQuality } from '@/data/types';
import type { StudioStyle } from './fxStudio';
import type { RenderSettings } from './cardVideoPlan';
/** Native stub: pre-rendering a card video needs WebCodecs (a browser). The admin panel on a phone app shows a note instead of the button. */
export interface RenderOptions {
  images: string[]; effects: number[]; hold: number; speed: number; rtl: boolean; width: number; height: number;
  /** Render quality preset (frame rate + encoder bitrate; the size is given by width / height). Default 'balanced'. */ quality?: VideoQuality;
  /** Draw every animated element of the transitions (edge line, knob, doors, ring, decorative pieces ...) into the video. */ extras?: boolean; /** Accent colour used by the colour bar and the decorative pieces. */ accent?: string;
  /** The Animation Studio style of the card (motion overrides, bar, pieces, colour wash); null / absent = the effects as they are. */ studio?: StudioStyle | null;
  /** Full render settings (size, fps, size window, bitrate, key frames, codec). Overrides `quality` / `width` / `height` when given. */ render?: RenderSettings;
  /** Progress: `done` / `total` frames of the current pass, `pass` (1-based) and `passes` (the most it may need). */
  onProgress?: (done: number, total: number, pass?: number, passes?: number) => void; signal?: AbortSignal;
  /** Called once with how the render went (passes, size, bitrate, codec, whether the file is inside the size window). */ onInfo?: (info: RenderInfo) => void;
}
export interface RenderInfo { passes: number; bytes: number; bitrate: number; codec: string; inWindow: boolean }
export interface FramePreview { url: string; width: number; height: number; /** bytes of the short clip the frame was decoded from (0 = uncompressed canvas) */ clipBytes: number; compressed: boolean }
export interface RenderSupport { ok: boolean; codec?: string; reason?: 'no-webcodecs' | 'no-encoder' | 'native' }
export async function canRenderVideo(_size?: { width: number; height: number }, _codec?: 'auto' | 'avc' | 'vp9' | 'av1'): Promise<RenderSupport> { return { ok: false, reason: 'native' }; }
export async function renderCardVideo(_options: RenderOptions): Promise<Blob> { throw new Error('VIDEO_RENDER_UNSUPPORTED'); }

/** Native stub: the mid-frame preview is drawn in a browser. */
export async function previewFrame(_options: RenderOptions): Promise<FramePreview> { throw new Error('VIDEO_RENDER_UNSUPPORTED'); }
