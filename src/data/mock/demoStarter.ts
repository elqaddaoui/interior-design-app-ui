import type { DemoConfig, DemoMessage, LText } from '../types';

const L = (dar: string, ar: string, fr: string): LText => ({ dar, ar, fr });

/**
 * The built-in demo messages (the most common first questions of a new customer). Used while the owner has not edited
 * Admin > Assistant > Demo messages; the first edit copies this set into the assistant document, from then on it is theirs.
 */
const item = (m: Omit<DemoMessage, 'enabled' | 'prompt'> & { prompt?: LText }): DemoMessage => ({ enabled: true, prompt: L('', '', ''), ...m });

export const STARTER_ITEMS: DemoMessage[] = [
  item({
    id: 'price', icon: 'cash-multiple', mode: 'click',
    label: L('شحال كتكلف الخدمة؟', 'كم تكلفة الخدمة؟', 'Combien ça coûte ?'),
    reply: { type: 'text', text: L(
      'أول تصميم ببلاش 🎁. من بعد كتستعمل الكريدي: كل تصميم كيخصم كريدي واحد، وإلا سالاو عندك تقدر تاخد باقة PRO وتزيد الكريدي ديالك.',
      'التصميم الأول مجاني 🎁. بعد ذلك تستخدم الرصيد: كل تصميم يخصم رصيدًا واحدًا، وإذا انتهى يمكنك اختيار باقة PRO لزيادة رصيدك.',
      'Le premier design est offert 🎁. Ensuite, chaque design utilise 1 crédit ; quand il n’y en a plus, choisissez un pack PRO pour en recharger.') },
    followUps: ['start', 'team'], cta: 'pro',
  }),
  item({
    id: 'start', icon: 'rocket-launch-outline', mode: 'click',
    label: L('كيفاش نبدا؟', 'كيف أبدأ؟', 'Comment commencer ?'),
    reply: { type: 'text', text: L(
      'بسيطة: 1) اختار الأداة اللي بغيتي من الصفحة الرئيسية. 2) صوّر الغرفة. 3) اختار الستايل والألوان. 4) التصميم كيوصلك فالواتساب.',
      'الأمر بسيط: 1) اختر الأداة من الصفحة الرئيسية. 2) صوّر الغرفة. 3) اختر الأسلوب والألوان. 4) يصلك التصميم على واتساب.',
      'C’est simple : 1) choisissez un outil sur l’accueil. 2) Photographiez la pièce. 3) Choisissez style et couleurs. 4) Recevez le design sur WhatsApp.') },
    followUps: ['photo', 'nophoto'], cta: 'tools',
  }),
  item({
    id: 'photo', icon: 'camera-outline', mode: 'click',
    label: L('شنو أحسن تصويرة للغرفة؟', 'ما أفضل صورة للغرفة؟', 'Quelle photo prendre ?'),
    reply: { type: 'text', text: L(
      'صوّر الغرفة من الركن باش تبان كاملة، فالضوء الطبيعي، والأرضية والحيطان باينين. حيّد الأشياء الصغيرة اللي كتغطي، والتصويرة تكون أفقية.',
      'صوّر الغرفة من الزاوية لتظهر كاملة، في ضوء طبيعي، مع ظهور الأرضية والجدران. أزل الأشياء الصغيرة التي تغطي المكان وفضّل الصورة الأفقية.',
      'Prenez la pièce depuis un angle pour qu’elle apparaisse en entier, en lumière naturelle, sol et murs bien visibles. Dégagez les petits objets et privilégiez le format horizontal.') },
    followUps: ['styles', 'nophoto'], cta: 'none',
  }),
  item({
    id: 'styles', icon: 'palette-outline', mode: 'write',
    label: L('نصيحة فالستايل والألوان', 'نصيحة في الأسلوب والألوان', 'Conseils de style et couleurs'),
    prompt: L('بغيت نصائح ديال الستايل والألوان لـ ', 'أريد نصائح حول الأسلوب والألوان لـ ', 'Je voudrais des conseils de style et de couleurs pour mon '),
    reply: { type: 'ai', text: L('', '', '') }, followUps: [], cta: 'explore',
  }),
  item({
    id: 'nophoto', icon: 'image-off-outline', mode: 'click',
    label: L('ما عنديش تصويرة', 'ليست لدي صورة', 'Je n’ai pas de photo'),
    reply: { type: 'text', text: L(
      'ماشي مشكل! وصف ليا الغرفة (المساحة، الستايل اللي كيعجبك، الألوان) ولا شوف الإلهامات فصفحة الاستكشاف وختار اللي عجبك.',
      'لا مشكلة! صف لي الغرفة (المساحة، الأسلوب الذي تحبه، الألوان) أو تصفّح الإلهامات في صفحة الاستكشاف واختر ما يعجبك.',
      'Pas de souci ! Décrivez-moi la pièce (surface, style aimé, couleurs) ou parcourez les inspirations dans Explorer et choisissez ce qui vous plaît.') },
    followUps: ['styles', 'team'], cta: 'explore',
  }),
  item({
    id: 'team', icon: 'face-agent', mode: 'click',
    label: L('بغيت نهضر مع الفريق', 'أريد التحدث مع الفريق', 'Parler à l’équipe'),
    reply: { type: 'text', text: L(
      'كتب ليا هنا رسالتك وواحد من الفريق غادي يجاوبك فأقرب وقت، وغادي توصلك الإشعار.',
      'اكتب رسالتك هنا وسيرد عليك أحد أعضاء الفريق في أقرب وقت، وسيصلك إشعار.',
      'Écrivez votre message ici : un membre de l’équipe vous répondra dès que possible et vous serez notifié.') },
    followUps: [], cta: 'none',
  }),
];

export const STARTER_DEMO: DemoConfig = {
  enabled: true, layout: 'cards',
  title: L('اختار سؤال أو كتب ديالك', 'اختر سؤالًا أو اكتب سؤالك', 'Choisissez une question ou écrivez la vôtre'),
  subtitle: L('', '', ''),
  items: STARTER_ITEMS,
};
