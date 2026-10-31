import { create } from 'zustand';
import { uid } from '@/lib/uid';
import type { Draft } from '@/data/types';

interface Wizard {
  claimId: string;
  requestId?: string;
  proSeen: boolean;
  dirty: boolean;
  clear(): void;
  toolId: string;
  photoUri: string;
  draft: Draft;
  lead?: { name: string; whatsapp: string };
  /** history item produced by the last render (used by result page / regenerate) */
  start(toolId: string, preset?: Partial<Draft>): void;
  setPhoto(uri: string): void;
  patch(p: Partial<Draft>): void;
  setLead(l: Wizard['lead']): void;
}
export const PROMPT_MIN = 8;
/** A generation needs a photo, or (text mode) a description of the room. */
export const wizardReady = (s: { photoUri: string; draft: Draft }) => !!s.photoUri || (s.draft.source === 'text' && (s.draft.prompt ?? '').trim().length >= PROMPT_MIN);
export const useWizard = create<Wizard>((set) => ({
  claimId: uid('claim'), proSeen: false, dirty: false,
  clear: () => set({ photoUri: '', draft: { toolId: '' }, toolId: '', dirty: false, lead: undefined, requestId: undefined, proSeen: false }),
  toolId: '',
  photoUri: '',
  draft: { toolId: '' },
  start: (toolId, preset) => set({ toolId, photoUri: '', lead: undefined, claimId: uid('claim'), requestId: undefined, proSeen: false, dirty: false, draft: { toolId, ...preset } }),
  setPhoto: (photoUri) => set((s) => ({ photoUri, dirty: !!photoUri || s.dirty, draft: photoUri && s.draft.source === 'text' ? { ...s.draft, source: 'photo' } : s.draft })),
  patch: (p) => set((s) => ({ draft: { ...s.draft, ...p }, dirty: true })),
  setLead: (lead) => set({ lead }),
}));
