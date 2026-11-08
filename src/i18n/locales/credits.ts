/** Texts of the admin Credits page (namespace `cr`). One row per key: [fr, ar, dar]. */
type Row = [fr: string, ar: string, dar: string];
const T: Record<string, Row> = {
  statUsers: ['Utilisateurs', 'المستخدمون', 'المستخدمين'],
  statMonth: ['Accordés ce mois', 'الممنوح هذا الشهر', 'اللي تعطى هاد الشهر'],
  statDefault: ['Gratuits par défaut', 'المجاني الافتراضي', 'المجاني بالأصل'],
  defaultTitle: ['Crédits gratuits par défaut', 'الرصيد المجاني الافتراضي', 'الكريدي المجاني بالأصل'],
  defaultNote: ['Pour les nouveaux utilisateurs.', 'للمستخدمين الجدد.', 'للمستخدمين الجداد.'],
  apply: ['Appliquer', 'تطبيق', 'طبّق'],
  grantTitle: ['Accorder des crédits', 'منح رصيد', 'عطي كريدي'],
  searchPh: ['Rechercher un nom ou un numéro', 'ابحث بالاسم أو الرقم', 'قلّب بالسمية ولا النمرة'],
  noMatch: ['Aucun utilisateur trouvé', 'لا يوجد مستخدم مطابق', 'ما لقينا حتى مستخدم'],
  noUsers: ['Aucun utilisateur pour le moment', 'لا يوجد مستخدمون بعد', 'ما كاين حتى مستخدم باقي'],
  change: ['Changer d’utilisateur', 'تغيير المستخدم', 'بدّل المستخدم'],
  balance: ['Solde', 'الرصيد', 'الرصيد'],
  amount: ['Montant', 'الكمية', 'الكمية'],
  custom: ['Autre montant', 'كمية أخرى', 'كمية أخرى'],
  preview: ['Solde {{from}} → {{to}}', 'الرصيد {{from}} ← {{to}}', 'الرصيد {{from}} ← {{to}}'],
  pickFirst: ['Choisissez un utilisateur', 'اختر مستخدمًا', 'اختار مستخدم'],
  granted: ['+{{n}} crédits pour {{name}}', '+{{n}} رصيد لـ {{name}}', '+{{n}} كريدي ل {{name}}'],
  undo: ['Annuler', 'تراجع', 'رجّع'],
  undone: ['Octroi annulé', 'تم التراجع عن المنح', 'تراجع المنح'],
  activity: ['Activité récente', 'النشاط الأخير', 'آخر النشاط'],
  activityEmpty: ['Aucun octroi pour le moment', 'لا توجد عمليات منح بعد', 'ما كاين حتى منح باقي'],
  undoneTag: ['annulé', 'ملغى', 'تراجع'],
  now: ['à l’instant', 'الآن', 'دابا'],
  min: ['il y a {{n}} min', 'منذ {{n}} د', 'من {{n}} د'],
  hour: ['il y a {{n}} h', 'منذ {{n}} س', 'من {{n}} س'],
  day: ['il y a {{n}} j', 'منذ {{n}} يوم', 'من {{n}} يوم'],
  minus: ['Moins', 'أقل', 'نقص'],
  plus: ['Plus', 'أكثر', 'زيد'],
};
const pick = (i: 0 | 1 | 2) => Object.fromEntries(Object.entries(T).map(([k, r]) => [k, r[i]]));
export const creditTexts = { fr: pick(0), ar: pick(1), dar: pick(2) };
