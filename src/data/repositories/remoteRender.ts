import { api, BackendError } from '@/lib/backend';
import { wait } from '@/lib/uid';
import { mockServices } from '../mock/services';
import type { RenderService } from './types';

/** Longest a single generation may take on the server (its own budget is ~54 s). */
const TIMEOUT_MS = 70000;

/**
 * Real AI generation over `POST /api/ai/render`. The request (photo, prompt, colours, style, inspiration) already exists
 * in the database under the claim id; the server builds the interior-design prompt, calls the engine and stores the result.
 * The call is idempotent per claim id, so a retry never generates (or charges) twice.
 *
 * The server cannot stream progress, so the bar is an honest estimate: it eases towards 92% and only completes with the image.
 * With no engine configured (`AI_NOT_CONFIGURED`) the app keeps its sample result, so demos and fresh installs still work.
 */
export const remoteRender = (): RenderService => ({
  async render(input, onProgress, signal) {
    if (!input.claimId) return mockServices.render.render(input, onProgress, signal);
    const started = Date.now();
    const timer = setInterval(() => {
      const progress = 0.92 * (1 - Math.exp(-(Date.now() - started) / 14000));
      onProgress?.({ progress, stage: Math.min(3, Math.floor(progress * 4.2)) });
    }, 250);
    try {
      const out = await api<{ imageUri: string }>('/ai/render', { method: 'POST', client: true, body: { id: input.claimId }, timeoutMs: TIMEOUT_MS });
      if (signal?.cancelled) throw new Error('cancelled');
      if (!out?.imageUri) throw new BackendError(502, 'EMPTY_RESULT');
      onProgress?.({ progress: 1, stage: 3 });
      await wait(250);
      return { imageUri: out.imageUri };
    } catch (error) {
      if (error instanceof BackendError && error.status === 503 && error.code === 'AI_NOT_CONFIGURED') {
        clearInterval(timer);
        return mockServices.render.render(input, onProgress, signal);
      }
      throw error;
    } finally {
      clearInterval(timer);
    }
  },
});
