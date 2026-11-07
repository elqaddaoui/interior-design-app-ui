/** Texts of the admin menu designs, the exit-message editor, the undo / redo bar and the Studio layout. Namespace `mx`. One row per key: [fr, ar, dar]. */
type Row = [fr: string, ar: string, dar: string];
const T: Record<string, Row> = {
  'design.title': ['Design du menu latéral', 'تصميم القائمة الجانبية', 'تصميم المينيو الجانبي'],
  'design.desc': ['Choisissez le style animé du menu de l’admin. Réduire ou agrandir le menu se fait avec l’icône en haut de la page.', 'اختر الشكل المتحرك لقائمة الإدارة. الطيّ والتوسيع يتمّان من أيقونة «طيّ القائمة» أعلى الصفحة.', 'اختار الشكل المتحرك د المينيو. التصغير والتكبير كيتديرو من الأيقونة اللي فوق فالصفحة.'],
  'design.glide': ['Glisse', 'انسياب', 'انسياب'],
  'design.glideDesc': ['Une pastille douce glisse vers la page ouverte.', 'كبسولة ناعمة تنزلق إلى الصفحة المفتوحة.', 'كبسولة ناعمة كتزلق للصفحة المفتوحة.'],
  'design.beam': ['Faisceau', 'شعاع', 'شعاع'],
  'design.beamDesc': ['Un faisceau lumineux sur le bord suit votre navigation.', 'شعاع مضيء على الحافة يتبع تنقّلك.', 'شعاع مضوي فالحافة كيتبع التنقل ديالك.'],
  'design.spotlight': ['Projecteur', 'بقعة ضوء', 'بقعة ضوء'],
  'design.spotlightDesc': ['Un halo suit la souris, un cadre marque la page active.', 'هالة تتبع المؤشر وإطار يحدّد الصفحة النشطة.', 'هالة كتتبع الفأرة وإطار على الصفحة النشطة.'],
  'anim.title': ['Animation du menu', 'حركة القائمة', 'حركة المينيو'],
  'anim.hint': ['Désactivez pour un menu instantané, sans mouvement (aussi désactivée quand l’appareil réduit les animations).', 'أوقفها لقائمة فورية بلا حركة (تتوقف تلقائيًا إذا كان الجهاز يقلّل الحركة).', 'وقّفها باش يكون المينيو فوري بلا حركة (كتوقف وحدها إلا الجهاز مقلل الحركة).'],
  'anim.on': ['Animation activée', 'الحركة مفعّلة', 'الحركة خدامة'],
  'anim.off': ['Animation désactivée', 'الحركة متوقفة', 'الحركة موقوفة'],
  'exit.edit': ['Personnaliser le message', 'تخصيص رسالة التأكيد', 'خصّص الرسالة'],
  'exit.close': ['Masquer le message', 'إخفاء الرسالة', 'خبّي الرسالة'],
  'hist.undo': ['Annuler (Ctrl+Z)', 'تراجع (Ctrl+Z)', 'رجوع (Ctrl+Z)'],
  'hist.redo': ['Rétablir (Ctrl+Y)', 'إعادة (Ctrl+Y)', 'عاود (Ctrl+Y)'],
  'hist.undone': ['Modification annulée', 'تم التراجع عن التعديل', 'تراجع التعديل'],
  'hist.redone': ['Modification rétablie', 'تمت إعادة التعديل', 'تعاود التعديل'],
  'sx.device': ['Appareil et premier chargement', 'الجهاز والتحميل الأول', 'الجهاز والتحميل الأول'],
  'sx.deviceHint': ['Détails et réglages', 'التفاصيل والإعدادات', 'التفاصيل والإعدادات'],
  'sx.tierNow': ['en cours', 'الحالية', 'الحالية'],
  'sx.count': ['{{n}} transitions', '{{n}} انتقالًا', '{{n}} انتقال'],
  'sx.panel': ['Réglages', 'الإعدادات', 'الإعدادات'],
  'sx.stage': ['Aperçu en direct', 'المعاينة المباشرة', 'المعاينة المباشرة'],
  'sx.scope': ['Appliquer à', 'تطبيق على', 'تطبيق على'],
};
const pick = (i: 0 | 1 | 2) => {
  const out: Record<string, any> = {};
  for (const [k, row] of Object.entries(T)) {
    const parts = k.split('.');
    let o = out;
    for (let n = 0; n < parts.length - 1; n++) o = o[parts[n]] = typeof o[parts[n]] === 'object' ? o[parts[n]] : {};
    o[parts[parts.length - 1]] = row[i];
  }
  return out;
};
export const menuTexts = { fr: pick(0), ar: pick(1), dar: pick(2) };
