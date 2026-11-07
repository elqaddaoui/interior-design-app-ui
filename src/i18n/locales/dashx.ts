/** Texts of the redesigned admin dashboard + shell. Namespace `dx`. One row per key: [fr, ar, dar]. */
type Row = [fr: string, ar: string, dar: string];
const T: Record<string, Row> = {
  'greet.morning': ['Bonjour', 'صباح الخير', 'صباح الخير'], 'greet.afternoon': ['Bon après-midi', 'مساء الخير', 'نهارك مبروك'], 'greet.evening': ['Bonsoir', 'مساء النور', 'مسا الخير'],
  welcomeSub: ['Voici l’activité de {{app}} sur les {{days}} derniers jours.', 'هذه حصيلة نشاط {{app}} خلال آخر {{days}} يومًا.', 'هادي حصيلة {{app}} فآخر {{days}} يوم.'],
  pendingHero: ['{{count}} demande(s) attendent votre design', '{{count}} طلب(ات) تنتظر تصميمك', '{{count}} طلب(ات) كيتسناو التصميم ديالك'],
  pendingCta: ['Ouvrir les demandes', 'فتح الطلبات', 'حل الطلبات'],
  clearHero: ['Tout est à jour', 'كل شيء محدّث', 'كلشي مرتب'], clearSub: ['Aucune demande en attente. Belle régularité !', 'لا توجد طلبات معلّقة. عمل رائع!', 'ما كاين حتى طلب معلق. خدمة مزيانة!'],
  vsPrev: ['Comparé aux {{days}} jours précédents', 'مقارنة بالأيام الـ{{days}} السابقة', 'مقارنة مع {{days}} يوم اللي فاتو'],
  refresh: ['Actualiser', 'تحديث', 'جدّد'], refreshed: ['Données actualisées', 'تم تحديث البيانات', 'تجدّدات المعطيات'],
  report: ['Exporter CSV', 'تصدير CSV', 'صدّر CSV'], reportDone: ['Rapport téléchargé', 'تم تنزيل التقرير', 'تحمّل التقرير'], reportWebOnly: ['Disponible sur la version web', 'متاح في نسخة الويب', 'كاين غير فنسخة الويب'],
  'insight.title': ['À retenir', 'أهم الملاحظات', 'اللي خاصك تعرف'],
  'insight.backlog': ['La plus ancienne demande attend depuis {{n}} h', 'أقدم طلب ينتظر منذ {{n}} ساعة', 'أقدم طلب كيتسنى من {{n}} ساعة'],
  'insight.aiFail': ['{{pct}} % des générations IA échouent', '{{pct}}٪ من عمليات الذكاء الاصطناعي تفشل', '{{pct}}٪ ديال التوليدات د الذكاء الاصطناعي كتفشل'],
  'insight.drop': ['Les designs baissent de {{pct}} % sur la période', 'انخفضت التصاميم بنسبة {{pct}}٪ في هذه الفترة', 'التصاميم نقصو ب{{pct}}٪ فهاد المدة'],
  'insight.zeroCredits': ['{{n}} clients n’ont plus de crédits', '{{n}} عملاء نفدت أرصدتهم', '{{n}} د الكليان سالات ليهم الكريديات'],
  'insight.growth': ['Les designs progressent de {{pct}} %', 'ارتفعت التصاميم بنسبة {{pct}}٪', 'التصاميم زادو ب{{pct}}٪'],
  'insight.topTool': ['« {{tool}} » représente {{pct}} % des designs', '«{{tool}}» يمثل {{pct}}٪ من التصاميم', '«{{tool}}» هو {{pct}}٪ د التصاميم'],
  'insight.peakDay': ['Vos clients sont les plus actifs le {{day}}', 'عملاؤك الأكثر نشاطًا يوم {{day}}', 'الكليان ديالك كتر نشاطهم نهار {{day}}'],
  'insight.steady': ['Tout est stable : aucun point d’attention.', 'كل شيء مستقر: لا توجد نقاط تستدعي الانتباه.', 'كلشي مستقر: ما كاين والو خاصو انتباه.'],
  kRate: ['Taux de livraison', 'نسبة التسليم', 'نسبة التسليم'], kWait: ['Attente moyenne', 'متوسط الانتظار', 'متوسط الانتظار'], kPendingSub: ['Plus ancienne : {{wait}}', 'الأقدم: {{wait}}', 'الأقدم: {{wait}}'], kPendingNone: ['Rien en attente', 'لا شيء معلّق', 'ما كاين والو معلق'],
  chartSub: ['Survolez ou touchez le graphique pour le détail', 'مرّر المؤشر أو المس الرسم للتفاصيل', 'دوز الفأرة ولا لمس الرسم للتفاصيل'], comparePrev: ['Période précédente', 'الفترة السابقة', 'المدة اللي فاتت'],
  'pipe.title': ['Pipeline des demandes', 'مسار الطلبات', 'مسار الطلبات'], 'pipe.pending': ['En attente', 'معلّقة', 'معلقة'], 'pipe.processing': ['En cours', 'قيد المعالجة', 'كتتعالج'], 'pipe.delivered': ['Livrées', 'مسلّمة', 'تسلّمات'], 'pipe.rate': ['livrées', 'مسلّمة', 'تسلّمات'], 'pipe.empty': ['Aucune demande sur cette période', 'لا توجد طلبات في هذه الفترة', 'ما كاين حتى طلب فهاد المدة'],
  waitH: ['{{n}} h', '{{n}} س', '{{n}} س'], waitD: ['{{n}} j', '{{n}} ي', '{{n}} ي'], waitNone: ['—', '—', '—'],
  'heat.title': ['Quand vos clients sont actifs', 'متى يكون عملاؤك نشيطين', 'فوقاش الكليان كيكونو نشيطين'], 'heat.sub': ['Demandes et designs par jour et tranche de 4 h', 'الطلبات والتصاميم حسب اليوم وكل 4 ساعات', 'الطلبات والتصاميم حسب النهار وكل 4 ساعات'],
  'heat.peak': ['Pic : {{day}}, {{from}} h – {{to}} h', 'الذروة: {{day}}، {{from}} – {{to}} س', 'الذروة: {{day}}، {{from}} – {{to}} س'], 'heat.cell': ['{{day}} {{from}} h – {{to}} h : {{n}}', '{{day}} {{from}} – {{to}} س: {{n}}', '{{day}} {{from}} – {{to}} س: {{n}}'], 'heat.empty': ['Pas encore assez d’activité', 'لا يوجد نشاط كافٍ بعد', 'ما كاينش نشاط بزاف بعد'],
  'mix.title': ['Photo ou texte seul', 'صورة أو نص فقط', 'تصويرة ولا غير نص'], 'mix.photo': ['Avec photo', 'مع صورة', 'بتصويرة'], 'mix.text': ['Texte seul', 'نص فقط', 'غير نص'], 'mix.designs': ['designs', 'تصميم', 'تصميم'],
  'ai.title': ['Santé de l’IA', 'صحة الذكاء الاصطناعي', 'صحة الذكاء الاصطناعي'], 'ai.success': ['Réussite', 'النجاح', 'النجاح'], 'ai.failed': ['{{n}} échec(s)', '{{n}} فشل', '{{n}} فشل'], 'ai.avg': ['Temps moyen', 'متوسط الوقت', 'متوسط الوقت'], 'ai.seconds': ['{{n}} s', '{{n}} ث', '{{n}} ث'], 'ai.runs': ['{{n}} génération(s)', '{{n}} عملية توليد', '{{n}} توليد'], 'ai.none': ['Aucune génération enregistrée sur la période', 'لا توجد عمليات توليد مسجّلة', 'ما كاين حتى توليد مسجل'], 'ai.models': ['Modèles utilisés', 'النماذج المستخدمة', 'النماذج اللي تستعملات'],
  'aud.title': ['Clients', 'العملاء', 'الكليان'], 'aud.active': ['Actifs', 'نشطون', 'نشيطين'], 'aud.returning': ['Fidèles (2 designs et +)', 'أوفياء (تصميمان فأكثر)', 'أوفياء (تصميمين وكتر)'], 'aud.leads': ['Prospects WhatsApp', 'عملاء محتملون عبر واتساب', 'ناس جاو من واتساب'], 'aud.credits': ['Crédits en circulation', 'الأرصدة المتداولة', 'الكريديات اللي كاينين'], 'aud.zero': ['Sans crédits', 'بدون رصيد', 'بلا كريديات'], 'aud.blocked': ['Bloqués', 'محظورون', 'مبلوكيين'], 'aud.top': ['Les plus actifs', 'الأكثر نشاطًا', 'الأكثر نشاطا'], 'aud.designsN': ['{{n}} design(s)', '{{n}} تصميم', '{{n}} تصميم'],
  d0: ['Lun', 'الاثنين', 'التنين'], d1: ['Mar', 'الثلاثاء', 'التلات'], d2: ['Mer', 'الأربعاء', 'الأربع'], d3: ['Jeu', 'الخميس', 'الخميس'], d4: ['Ven', 'الجمعة', 'الجمعة'], d5: ['Sam', 'السبت', 'السبت'], d6: ['Dim', 'الأحد', 'الأحد'],
  f0: ['lundi', 'الاثنين', 'التنين'], f1: ['mardi', 'الثلاثاء', 'التلات'], f2: ['mercredi', 'الأربعاء', 'الأربع'], f3: ['jeudi', 'الخميس', 'الخميس'], f4: ['vendredi', 'الجمعة', 'الجمعة'], f5: ['samedi', 'السبت', 'السبت'], f6: ['dimanche', 'الأحد', 'الأحد'],
  rank: ['Classement', 'الترتيب', 'الترتيب'], seeAll: ['Tout voir', 'عرض الكل', 'شوف الكل'],
  'shell.search': ['Rechercher…', 'بحث…', 'قلّب…'], 'shell.pending': ['Demandes à traiter', 'طلبات بانتظار المعالجة', 'طلبات خاصها تتعالج'], 'shell.admin': ['Administrateur', 'المسؤول', 'المدير'], 'shell.noPending': ['Aucune demande en attente', 'لا توجد طلبات معلّقة', 'ما كاين حتى طلب معلق'],
  'qv.client': ['Client', 'العميل', 'الكليان'], 'qv.design': ['Design', 'التصميم', 'التصميم'], 'qv.openPage': ['Ouvrir la page', 'فتح الصفحة', 'حل الصفحة'], 'qv.openFull': ['Ouvrir la fiche complète', 'فتح التفاصيل الكاملة', 'حل التفاصيل كاملة'], 'qv.allClients': ['Tous les clients', 'كل العملاء', 'كاع الكليان'],
  'qv.count': ['{{count}} client(s)', '{{count}} عميل', '{{count}} كليان'], 'qv.noClients': ['Aucun client dans cette liste', 'لا يوجد عملاء في هذه القائمة', 'ما كاين حتى كليان فهاد اللائحة'], 'qv.noRequests': ['Aucune demande', 'لا توجد طلبات', 'ما كاين حتى طلب'], 'qv.gone': ['Cet élément n’existe plus', 'لم يعد هذا العنصر موجودًا', 'هاد العنصر ما بقاش كاين'],
  'qv.more': ['+ {{n}} autres : ouvrez la page pour tout voir', '+ {{n}} أخرى: افتح الصفحة لعرض الكل', '+ {{n}} أخرين: حل الصفحة باش تشوف الكل'], 'qv.waiting': ['Attend depuis {{wait}}', 'ينتظر منذ {{wait}}', 'كيتسنا من {{wait}}'], 'qv.creditsAdded': ['+{{n}} crédit(s) ajouté(s)', 'تمت إضافة {{n}} رصيد', 'تزادو {{n}} كريدي'],
  'qv.designs': ['Designs', 'التصاميم', 'التصاميم'], 'qv.requests': ['Demandes', 'الطلبات', 'الطلبات'], 'qv.lastSeen': ['Dernière activité', 'آخر نشاط', 'آخر نشاط'], 'qv.addCredits': ['Ajouter des crédits', 'إضافة رصيد', 'زيد كريديات'], 'qv.recentRequests': ['Dernières demandes', 'آخر الطلبات', 'آخر الطلبات'],
  'qv.thisPeriod': ['Cette période', 'هذه الفترة', 'هاد الفترة'], 'qv.prevPeriod': ['Période précédente', 'الفترة السابقة', 'الفترة اللي فاتت'],
  'qa.sub': ['Ce qui demande votre attention et vos raccourcis de gestion', 'ما يحتاج انتباهك واختصارات الإدارة', 'اللي خاصو انتباهك وطرق مختصرة للتسيير'],
  'qa.handle': ['À traiter', 'للمعالجة', 'اللي خاصو يتعالج'], 'qa.create': ['Créer', 'إنشاء', 'زيد'], 'qa.manage': ['Gérer l’app', 'إدارة التطبيق', 'سيّر التطبيق'],
  'qa.requests': ['Demandes', 'الطلبات', 'الطلبات'], 'qa.chats': ['Conversations', 'المحادثات', 'المحادثات'], 'qa.clients': ['Clients', 'العملاء', 'الكليان'], 'qa.noCredits': ['Sans crédits', 'بدون رصيد', 'بلا كريديات'],
  'qa.addTool': ['Nouvel outil', 'أداة جديدة', 'أداة جديدة'], 'qa.addInspiration': ['Nouvelle inspiration', 'صورة إلهام جديدة', 'إلهام جديد'], 'qa.addStyle': ['Nouveau style', 'أسلوب جديد', 'ستيل جديد'], 'qa.addPalette': ['Nouvelle palette', 'لوحة ألوان جديدة', 'باليت جديدة'],
  'qa.models': ['Modèles IA', 'نماذج الذكاء الاصطناعي', 'موديلات الذكاء الاصطناعي'], 'qa.credits': ['Crédits', 'الرصيد', 'الكريديات'], 'qa.theme': ['Thème', 'السمة', 'الثيم'], 'qa.app': ['Voir l’app', 'عرض التطبيق', 'شوف التطبيق'],
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
export const dashTexts = { fr: pick(0), ar: pick(1), dar: pick(2) };
