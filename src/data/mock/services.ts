import type { Services } from '../repositories/types';
import { wait } from '@/lib/uid';
import { img } from './seed';
import { Platform } from 'react-native';

/** Pick a demo "result" photo that depends on the chosen room/style so results vary. */
function demoResult(draft: { roomTypeId?: string; styleId?: string; toolId: string }) {
  const key = (draft.roomTypeId ?? '').includes('bed') ? 'bedroom'
    : (draft.roomTypeId ?? '').includes('kitchen') ? 'kitchen'
    : (draft.roomTypeId ?? '').includes('bath') ? 'bathroom'
    : (draft.roomTypeId ?? '').includes('dining') ? 'dining'
    : draft.toolId.includes('exterior') || draft.toolId.includes('garden') ? 'exterior' : 'living';
  const seed = (draft.styleId ?? 'x').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return img(key as 'living', seed, 1200);
}

/** Offline canned reply (demo mode, or when the server cannot answer). */
async function localReply(messages: { role: string; text?: string; image?: string }[]): Promise<string> {
  await wait(900);
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const t = last?.text ?? '';
  const hasImage = !!last?.image;
  const isAr = /[\u0600-\u06FF]/.test(t);
  const isDarija = /(كيفاش|بغيت|ديال|فين|شنو|واش|دار|مزيان|بزاف|عفاك|لاش)/.test(t);
  const isFr = /(bonjour|salut|comment|couleur|salon|chambre|je |pour |quel|déco|cuisine)/i.test(t);
  if (isAr && isDarija) {
    return hasImage
      ? 'التصويرة زوينة! نقترح عليك تدير حيطان بيج دافئ مع زرابي مغربية وإضاءة ناعمة. بغيتي نوجدو ليك تصميم كامل؟'
      : 'مرحبا! باش نعاونك، قولي شنو كاين فالبيت (الصالون، الكوزينة...) وشنو الستايل لي كيعجبك: عصري، مغربي ولا بسيط؟';
  }
  if (isAr) {
    return hasImage
      ? 'صورة رائعة! أقترح جدرانًا بلون بيج دافئ مع سجاد وإضاءة ناعمة. هل تريد أن أجهز لك تصميمًا كاملًا؟'
      : 'أهلًا! أخبرني عن الغرفة وأسلوبك المفضل (عصري، مغربي، بسيط) وسأقدم لك أفكارًا عملية.';
  }
  if (isFr) {
    return hasImage
      ? "Belle photo ! Je suggère des murs beige chaud, un tapis texturé et un éclairage doux. Voulez-vous un rendu complet ?"
      : "Bonjour ! Dites-moi quelle pièce vous souhaitez transformer et votre style préféré (moderne, marocain, minimaliste) et je vous proposerai des idées.";
  }
  return hasImage
    ? 'Nice photo! I suggest warm beige walls, a textured rug and soft lighting. Want a full render?'
    : 'Hi! Tell me which room you want to transform and your preferred style (modern, Moroccan, minimalist).';
}

export const mockServices: Services = {
  render: {
    async render({ draft }, onProgress, signal) {
      const total = 7000;
      const step = 140;
      for (let t = 0; t <= total; t += step) {
        if (signal?.cancelled) throw new Error('cancelled');
        const progress = Math.min(1, t / total);
        onProgress?.({ progress, stage: Math.min(3, Math.floor(progress * 4)) });
        await wait(step);
      }
      return { imageUri: demoResult(draft) };
    },
  },
  chat: {
    async buttons() { return []; },
    async reply({ messages }) {
      const text = await localReply(messages);
      return { text, meta: { status: 'local', provider: 'local', label: 'Offline', model: '' } };
    },
  },
  auth: {
    async loginAdmin(email, password) {
      await wait(500);
      if ((email.trim().toLowerCase() === 'admin' && password === 'admin') || (email.trim().toLowerCase() === 'admin@dwira.app' && password === 'admin123')) return { ok: true, user: { id: 'usr_admin', name: 'Admin' } };
      return { ok: false, reason: 'invalid' };
    },
  },
  upload: {
    /** Native: copy the picked file into the app's document dir so it survives cache cleaning. Web: keep data URL. */
    async upload(uri, folder) {
      if (Platform.OS === 'web') {
        if (!uri.startsWith('blob:')) return uri;
        const response = await fetch(uri);
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Unable to save uploaded image'));
          reader.readAsDataURL(blob);
        });
      }
      if (uri.startsWith('http') || uri.startsWith('data:')) return uri;
      try {
        const { File, Directory, Paths } = await import('expo-file-system');
        const dir = new Directory(Paths.document, folder);
        if (!dir.exists) dir.create();
        const dest = new File(dir, `${Date.now()}.${uri.toLowerCase().includes('.png') ? 'png' : 'jpg'}`);
        new File(uri).copy(dest);
        return dest.uri;
      } catch {
        return uri;
      }
    },
  },
  whatsapp: {
    async sendDesign() {
      await wait(600);
      return { status: 'delivered' };
    },
  },
};
