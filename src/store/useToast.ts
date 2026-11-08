import { create } from 'zustand';

export interface ToastAction { label: string; run: () => void }
interface ToastState { msg: string; id: number; action?: ToastAction; show(m: string, action?: ToastAction): void; dismiss(): void }
export const useToast = create<ToastState>((set) => ({
  msg: '', id: 0, action: undefined,
  show: (msg, action) => set((s) => ({ msg, id: s.id + 1, action })),
  dismiss: () => set((s) => ({ msg: '', id: s.id + 1, action: undefined })),
}));
export const toast = (m: string) => useToast.getState().show(m);
/** A toast with ONE button (e.g. "Undo"). It stays a little longer so there is time to press it. */
export const toastAction = (m: string, action: ToastAction) => useToast.getState().show(m, action);
