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
};
const pick = (i: 0 | 1 | 2) => Object.fromEntries(Object.entries(T).map(([k, r]) => [k, r[i]]));
export const supportTexts = { fr: pick(0), ar: pick(1), dar: pick(2) };
