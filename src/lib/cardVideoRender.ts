/** Native stub: pre-rendering a card video needs WebCodecs (a browser). The admin panel on a phone app shows a note instead of the button. */
export interface RenderOptions {
  images: string[]; effects: number[]; hold: number; speed: number; rtl: boolean; width: number; height: number;
  /** Draw every animated element of the transitions (edge line, knob, doors, ring, star badges ...) into the video. */ extras?: boolean; /** Accent colour used by the colour bar and the star badges. */ accent?: string;
  onProgress?: (done: number, total: number) => void; signal?: AbortSignal;
}
export interface RenderSupport { ok: boolean; codec?: string; reason?: 'no-webcodecs' | 'no-encoder' | 'native' }
export async function canRenderVideo(_size?: { width: number; height: number }): Promise<RenderSupport> { return { ok: false, reason: 'native' }; }
export async function renderCardVideo(_options: RenderOptions): Promise<Blob> { throw new Error('VIDEO_RENDER_UNSUPPORTED'); }
