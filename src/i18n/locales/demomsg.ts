/** Texts of the assistant demo messages seen by customers (namespace `dm`). One row per key: [fr, ar, dar]. */
type Row = [fr: string, ar: string, dar: string];
const T: Record<string, Row> = {
  next: ['Et ensuite ?', 'وبعد ذلك؟', 'وموراها؟'],
  ctaTools: ['Choisir un outil', 'اختر أداة', 'ختار أداة'],
  ctaExplore: ['Explorer les inspirations', 'تصفّح الإلهامات', 'شوف الإلهامات'],
  ctaPro: ['Voir les packs PRO', 'عرض باقات PRO', 'شوف باقات PRO'],
  writeHint: ['Complétez votre message', 'أكمل رسالتك', 'كمّل الرسالة ديالك'],
  list: ['Suggestions', 'اقتراحات', 'اقتراحات'],
};
const pick = (i: 0 | 1 | 2) => Object.fromEntries(Object.entries(T).map(([k, r]) => [k, r[i]]));
export const demoMsgTexts = { fr: pick(0), ar: pick(1), dar: pick(2) };
