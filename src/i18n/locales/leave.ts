/** Texts of the "leave?" dialog (namespace `lv`). One row per key: [fr, ar, dar]. */
type Row = [fr: string, ar: string, dar: string];
const T: Record<string, Row> = {
  sum1: ["1 modification non enregistrée", "تغيير واحد غير محفوظ", "تغيير واحد ما تحفظش"],
  sum2: ["2 modifications non enregistrées", "تغييران غير محفوظين", "جوج تغييرات ما تحفظوش"],
  sumFew: ["{{n}} modifications non enregistrées", "{{n}} تغييرات غير محفوظة", "{{n}} تغييرات ما تحفظوش"],
  sumMany: ["{{n}} modifications non enregistrées", "{{n}} تغييرًا غير محفوظ", "{{n}} تغيير ما تحفظش"],
  details: ["Voir les détails", "عرض التفاصيل", "شوف التفاصيل"], hide: ["Masquer les détails", "إخفاء التفاصيل", "خبّي التفاصيل"],
  more: ["+{{n}}", "+{{n}}", "+{{n}}"],
  discard: ["Ignorer", "تجاهل", "تجاهل"], leave: ["Quitter", "مغادرة", "خرج"], stay: ["Rester", "البقاء", "بقا"],
  setting: ["Réglage", "إعداد", "إعداد"], auto: ["Auto", "تلقائي", "أوتوماتيك"], on: ["Activé", "مفعّل", "خدام"], off: ["Désactivé", "متوقف", "مطفي"],
  file: ["Fichier", "ملف", "ملف"], items: ["{{n}} éléments", "{{n}} عناصر", "{{n}} عناصر"], edited: ["Modifié", "تم تعديله", "تبدّل"],
};
const pick = (i: 0 | 1 | 2) => Object.fromEntries(Object.entries(T).map(([k, r]) => [k, r[i]]));
export const leaveTexts = { fr: pick(0), ar: pick(1), dar: pick(2) };
