import { create } from 'zustand';
import { storage } from '@/data/mock/storage';

/** Per-device choice of the Media page: do videos in the grid play by themselves (muted, looping) or show their first frame. */
interface MediaPrefs {
  autoplay: boolean;
  loaded: boolean;
  load(): Promise<void>;
  setAutoplay(next: boolean): void;
}
export const useMediaPrefs = create<MediaPrefs>((set, get) => ({
  autoplay: false,
  loaded: false,
  async load() {
    if (get().loaded) return;
    const v = await storage.read<{ autoplay?: boolean }>('mediaPrefs');
    set({ autoplay: !!v?.autoplay, loaded: true });
  },
  setAutoplay(autoplay) {
    set({ autoplay, loaded: true });
    void storage.write('mediaPrefs', { autoplay });
  },
}));
