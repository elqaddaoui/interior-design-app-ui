/** Texts of the store credit meter (admin menu) and the notes shown when the platform manages the AI keys (namespace `sp`). [fr, ar, dar] */
type Row = [fr: string, ar: string, dar: string];
const T: Record<string, Row> = {
  creditsTitle: ['Crédits IA', 'رصيد الذكاء الاصطناعي', 'كريدي الذكاء الاصطناعي'],
  creditsLine: ['{{used}} utilisés sur {{limit}}', 'استُخدم {{used}} من {{limit}}', 'تستعملو {{used}} من {{limit}}'],
  creditsUnlimited: ['{{used}} utilisés · illimité', 'استُخدم {{used}} · غير محدود', 'تستعملو {{used}} · بلا حدود'],
  creditsLeft: ['{{left}} restants', 'المتبقي {{left}}', 'بقاو {{left}}'],
  creditsLow: ['Il reste peu de crédits.', 'الرصيد على وشك النفاد.', 'الكريدي قرب يسالي.'],
  creditsOut: ['Crédits épuisés : les rendus IA sont en pause.', 'نفد الرصيد: توليد الذكاء الاصطناعي متوقف.', 'سالا الكريدي: الذكاء الاصطناعي واقف.'],
  apiPlatform: ['Les clés IA sont gérées par la plateforme. Vous n’avez rien à configurer.', 'مفاتيح الذكاء الاصطناعي تديرها المنصة. لا حاجة لأي إعداد.', 'مفاتيح الذكاء الاصطناعي كتسيرها المنصة. ما خاصك تدير والو.'],
  managedNote: ['Gérées par la plateforme', 'تديرها المنصة', 'كتسيرها المنصة'],
  creditsExhausted: ['Les crédits de la boutique sont épuisés. Contactez la plateforme pour en obtenir plus.', 'نفد رصيد المتجر. تواصل مع المنصة للحصول على المزيد.', 'سالا كريدي المحل. تاصل بالمنصة باش يزيدوك.'],
  poolOverTitle: ['Limite de crédits dépassée', 'تم تجاوز حد الرصيد', 'فتتي حد الكريدي'],
  poolOver: ['Vos clients détiennent {{allocated}} crédits et {{used}} ont déjà été utilisés, soit {{over}} de plus que la limite de la boutique ({{limit}}). Contactez la plateforme pour augmenter la limite.', 'يملك عملاؤك {{allocated}} رصيدًا وقد استُخدم {{used}}، أي أكثر من حد المتجر ({{limit}}) بمقدار {{over}}. تواصل مع المنصة لرفع الحد.', 'الكليان ديالك عندهم {{allocated}} كريدي وتستعملو {{used}}، يعني {{over}} زيادة على حد المحل ({{limit}}). تاصل بالمنصة باش يزيدو الحد.'],
  poolNearTitle: ['Limite de crédits bientôt atteinte', 'حد الرصيد على وشك النفاد', 'حد الكريدي قرب يسالي'],
  poolNear: ['Il ne reste que {{available}} crédits à distribuer sur la limite de {{limit}} partagée par tous vos clients.', 'لم يتبق سوى {{available}} رصيدًا للتوزيع من الحد {{limit}} المشترك بين كل عملائك.', 'بقاو غير {{available}} كريدي باش توزعهم من الحد {{limit}} المشترك بين الكليان ديالك.'],
  poolShared: ['La limite de {{limit}} crédits est partagée par tous vos clients : {{allocated}} détenus, {{used}} utilisés, {{available}} à distribuer.', 'حد {{limit}} رصيد مشترك بين كل عملائك: {{allocated}} بحوزتهم، {{used}} مستخدمة، {{available}} متاحة للتوزيع.', 'حد {{limit}} كريدي مشترك بين الكليان ديالك: {{allocated}} عندهم، {{used}} تستعملو، {{available}} تقدر توزعهم.'],
  poolExceeded: ['Impossible : il ne reste que {{available}} crédits à distribuer dans la limite de la boutique.', 'غير ممكن: لم يتبق سوى {{available}} رصيدًا للتوزيع ضمن حد المتجر.', 'ماشي ممكن: بقاو غير {{available}} كريدي فحد المحل.'],
  poolCta: ['Voir les crédits', 'عرض الأرصدة', 'شوف الكريدي'],
  aiPaused: ['L’IA de la boutique est en pause. Contactez la plateforme.', 'الذكاء الاصطناعي للمتجر متوقف مؤقتًا. تواصل مع المنصة.', 'الذكاء الاصطناعي ديال المحل موقوف. تاصل بالمنصة.'],
  aiDemoOff: ['L’IA est désactivée pour cette démo. Activez « Utiliser l’API » dans la console.', 'الذكاء الاصطناعي متوقف لهذا العرض التجريبي. فعّل «استخدام الواجهة» من لوحة التحكم.', 'الذكاء الاصطناعي موقوف فهاد الديمو. شعل «استعمل الواجهة» من لوحة التحكم.'],
};
const pick = (i: 0 | 1 | 2) => Object.fromEntries(Object.entries(T).map(([k, r]) => [k, r[i]]));
export const supportTexts = { fr: pick(0), ar: pick(1), dar: pick(2) };
