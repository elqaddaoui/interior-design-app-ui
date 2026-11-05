/** Picture viewer, admin request details and the WhatsApp-style chat (namespace `md`). */
export const mediaTexts = {
  fr: {
    viewer: { actual: 'Taille réelle', fit: 'Ajuster', save: 'Enregistrer', saved: 'Image enregistrée', saveFailed: 'Enregistrement impossible', next: 'Suivante', prev: 'Précédente', before: 'Photo du client', after: 'Résultat IA', final: 'Design final', image: 'Image', open: 'Ouvrir l’image', compare: 'Avant / après' },
    req: {
      images: 'Images', inputs: 'Choix du client', ai: 'Génération IA', tool: 'Outil', room: 'Pièce', style: 'Style', mode: 'Mode', modeRestyle: 'Restyle (même mobilier)', modeRenovation: 'Rénovation (tout change)',
      palette: 'Palette', colors: 'Couleurs choisies', colorSource: 'Origine des couleurs', csCustom: 'Couleurs personnalisées', csPreset: 'Palette prédéfinie', csSurprise: 'Surprise (choix libre de l’IA)', csNone: 'Aucune couleur imposée',
      source: 'Source', srcPhoto: 'Photo du client', srcText: 'Texte seulement', note: 'Description du client', noteEnglish: 'Traduction envoyée à l’IA', inspiration: 'Inspiration', inspirationSent: 'envoyée comme référence de style', inspirationSkipped: 'non envoyée (modèle à 1 image)', imagesSent: 'Images envoyées à l’IA', imgPhoto: 'Photo du client', imgSent: 'envoyée', imgNotSent: 'non envoyée', imgWhy: { noChoice: 'rien de choisi', noPicture: 'pas d’image', unreadable: 'image illisible', off: 'désactivée', textOnly: 'texte seul', model: 'limite du modèle' }, imgRole: { inspiration: 'Photo Explorer', style: 'Style', room: 'Type de pièce' }, rulesApplied: 'Règles Prompt cards', rulesOn: 'appliquées', rulesOff: 'non appliquées (Explorer seulement)',
      modelAsked: 'Modèle demandé', modelUsed: 'Modèle utilisé', modelTried: 'Modèles essayés', modelAuto: 'Automatique (chaîne gratuite)', modelNone: 'Aucun modèle n’a répondu',
      prompt: 'Prompt envoyé au modèle', copyPrompt: 'Copier le prompt', copied: 'Copié', showPrompt: 'Voir le prompt', hidePrompt: 'Masquer le prompt', size: 'Taille générée', photoSize: 'Photo envoyée', duration: 'Durée', date: 'Demande',
      noRun: 'Aucun détail de génération enregistré pour cette demande (créée avant cette fonction, ou pas encore générée).', failed: 'La génération a échoué', ok: 'OK', fail: 'Échec', seconds: '{{n}} s', noPhoto: 'Pas de photo', noResult: 'Pas encore de résultat', tapOpen: 'Touchez pour agrandir',
      role: { walls: 'murs', accent: 'accent', main: 'dominante', secondary: 'secondaire' },
    },
    chat: {
      title: 'Nouveau chat (style WhatsApp)', hint: 'Remplace le chat de l’assistant par une conversation simple : messages, notes vocales, photos rapides. Désactivé = ancien chat.', on: 'Chat WhatsApp activé', off: 'Ancien chat',
      voice: 'Message vocal', record: 'Maintenez pour enregistrer', recording: 'Enregistrement…', slide: '‹ Glissez pour annuler', cancel: 'Annuler', send: 'Envoyer', play: 'Lire', pause: 'Pause', micDenied: 'Autorisez le micro pour envoyer un message vocal.', micFailed: 'Enregistrement impossible.', tooShort: 'Message trop court',
      photos: 'Photos', camera: 'Appareil photo', gallery: 'Galerie', caption: 'Ajouter une légende…', sendN: 'Envoyer {{n}}', today: 'Aujourd’hui', yesterday: 'Hier', voiceMsg: 'Message vocal', photoMsg: 'Photo', tapToSee: 'Touchez pour ouvrir', empty: 'Écrivez, parlez ou envoyez une photo.', sending: 'Envoi…', failedSend: 'Non envoyé',
    },
  },
  ar: {
    viewer: { actual: 'الحجم الأصلي', fit: 'ملاءمة الشاشة', save: 'حفظ', saved: 'تم حفظ الصورة', saveFailed: 'تعذّر الحفظ', next: 'التالية', prev: 'السابقة', before: 'صورة العميل', after: 'نتيجة الذكاء الاصطناعي', final: 'التصميم النهائي', image: 'صورة', open: 'فتح الصورة', compare: 'قبل / بعد' },
    req: {
      images: 'الصور', inputs: 'اختيارات العميل', ai: 'توليد الذكاء الاصطناعي', tool: 'الأداة', room: 'الغرفة', style: 'النمط', mode: 'الوضع', modeRestyle: 'تغيير النمط (نفس الأثاث)', modeRenovation: 'تجديد (كل شيء يتغيّر)',
      palette: 'لوحة الألوان', colors: 'الألوان المختارة', colorSource: 'مصدر الألوان', csCustom: 'ألوان مخصّصة', csPreset: 'لوحة جاهزة', csSurprise: 'مفاجأة (يختار الذكاء الاصطناعي)', csNone: 'بدون ألوان محددة',
      source: 'المصدر', srcPhoto: 'صورة العميل', srcText: 'نص فقط', note: 'وصف العميل', noteEnglish: 'الترجمة المرسلة للذكاء الاصطناعي', inspiration: 'الإلهام', inspirationSent: 'أُرسلت كمرجع للنمط', inspirationSkipped: 'لم تُرسل (النموذج يقبل صورة واحدة)', imagesSent: 'الصور المرسلة للذكاء الاصطناعي', imgPhoto: 'صورة العميل', imgSent: 'مرسلة', imgNotSent: 'غير مرسلة', imgWhy: { noChoice: 'لم يُختر شيء', noPicture: 'لا توجد صورة', unreadable: 'صورة غير مقروءة', off: 'معطّلة', textOnly: 'نص فقط', model: 'حد النموذج' }, imgRole: { inspiration: 'صورة استكشاف', style: 'الستايل', room: 'نوع الغرفة' }, rulesApplied: 'قواعد بطاقات البرومبت', rulesOn: 'مطبّقة', rulesOff: 'غير مطبّقة (استكشاف فقط)',
      modelAsked: 'النموذج المطلوب', modelUsed: 'النموذج المستخدم', modelTried: 'النماذج المجرَّبة', modelAuto: 'تلقائي (سلسلة مجانية)', modelNone: 'لم يستجب أي نموذج',
      prompt: 'الأمر المرسل للنموذج', copyPrompt: 'نسخ الأمر', copied: 'تم النسخ', showPrompt: 'عرض الأمر', hidePrompt: 'إخفاء الأمر', size: 'حجم الصورة المولّدة', photoSize: 'الصورة المرسلة', duration: 'المدة', date: 'الطلب',
      noRun: 'لا توجد تفاصيل توليد محفوظة لهذا الطلب (أُنشئ قبل هذه الميزة أو لم يُولَّد بعد).', failed: 'فشل التوليد', ok: 'نجح', fail: 'فشل', seconds: '{{n}} ث', noPhoto: 'لا توجد صورة', noResult: 'لا توجد نتيجة بعد', tapOpen: 'المس للتكبير',
      role: { walls: 'الجدران', accent: 'لون مميّز', main: 'أساسي', secondary: 'ثانوي' },
    },
    chat: {
      title: 'محادثة جديدة (بأسلوب واتساب)', hint: 'تستبدل محادثة المساعد بمحادثة بسيطة: رسائل، ملاحظات صوتية وصور سريعة. عند الإيقاف تعود المحادثة القديمة.', on: 'محادثة واتساب مفعّلة', off: 'المحادثة القديمة',
      voice: 'رسالة صوتية', record: 'اضغط مطولًا للتسجيل', recording: 'جارٍ التسجيل…', slide: '‹ اسحب للإلغاء', cancel: 'إلغاء', send: 'إرسال', play: 'تشغيل', pause: 'إيقاف مؤقت', micDenied: 'اسمح بالميكروفون لإرسال رسالة صوتية.', micFailed: 'تعذّر التسجيل.', tooShort: 'الرسالة قصيرة جدًا',
      photos: 'الصور', camera: 'الكاميرا', gallery: 'المعرض', caption: 'أضف تعليقًا…', sendN: 'إرسال {{n}}', today: 'اليوم', yesterday: 'أمس', voiceMsg: 'رسالة صوتية', photoMsg: 'صورة', tapToSee: 'المس للفتح', empty: 'اكتب أو تحدّث أو أرسل صورة.', sending: 'جارٍ الإرسال…', failedSend: 'لم تُرسل',
    },
  },
  dar: {
    viewer: { actual: 'الحجم الأصلي', fit: 'ناسب الشاشة', save: 'سجّل', saved: 'تسجلات التصويرة', saveFailed: 'ما تسجلاتش', next: 'اللي من بعد', prev: 'اللي قبل', before: 'تصويرة العميل', after: 'نتيجة الذكاء الاصطناعي', final: 'التصميم النهائي', image: 'تصويرة', open: 'حل التصويرة', compare: 'قبل / من بعد' },
    req: {
      images: 'التصاور', inputs: 'اختيارات العميل', ai: 'التوليد بالذكاء الاصطناعي', tool: 'الأداة', room: 'البيت', style: 'الستايل', mode: 'الوضع', modeRestyle: 'بدّل الستايل (نفس الموبيليا)', modeRenovation: 'تجديد (كلشي كيتبدل)',
      palette: 'لوحة الألوان', colors: 'الألوان اللي تختارو', colorSource: 'منين جاو الألوان', csCustom: 'ألوان ديال العميل', csPreset: 'لوحة واجدة', csSurprise: 'مفاجأة (الذكاء الاصطناعي كيختار)', csNone: 'بلا ألوان محددة',
      source: 'المصدر', srcPhoto: 'تصويرة د العميل', srcText: 'غير النص', note: 'وصف العميل', noteEnglish: 'الترجمة اللي تصيفطات للذكاء الاصطناعي', inspiration: 'الإلهام', inspirationSent: 'تصيفطات كمرجع د الستايل', inspirationSkipped: 'ما تصيفطاتش (الموديل كياخد تصويرة وحدة)', imagesSent: 'التصاور لي تصيفطو للذكاء الاصطناعي', imgPhoto: 'تصويرة د العميل', imgSent: 'تصيفطات', imgNotSent: 'ما تصيفطاتش', imgWhy: { noChoice: 'ما تختار والو', noPicture: 'ما كايناش تصويرة', unreadable: 'التصويرة ما تقراتش', off: 'موقفة', textOnly: 'نص غير', model: 'حد الموديل' }, imgRole: { inspiration: 'تصويرة د اكتاشف', style: 'الستايل', room: 'نوع البيت' }, rulesApplied: 'قوانين كارطات البرومبت', rulesOn: 'مطبقة', rulesOff: 'ماشي مطبقة (اكتاشف غير)',
      modelAsked: 'الموديل المطلوب', modelUsed: 'الموديل اللي خدم', modelTried: 'الموديلات اللي تجرّبو', modelAuto: 'أوتوماتيكي (سلسلة مجانية)', modelNone: 'حتى موديل ما جاوب',
      prompt: 'البرومبت اللي تصيفط للموديل', copyPrompt: 'نسخ البرومبت', copied: 'تنسخ', showPrompt: 'شوف البرومبت', hidePrompt: 'خبّي البرومبت', size: 'قياس التصويرة المولّدة', photoSize: 'التصويرة اللي تصيفطات', duration: 'المدة', date: 'الطلب',
      noRun: 'ما كاين حتى تفصيل د التوليد محفوظ فهاد الطلب (تصاوب قبل هاد الميزة ولا مازال ما تولدش).', failed: 'التوليد فشل', ok: 'نجح', fail: 'فشل', seconds: '{{n}} ث', noPhoto: 'ما كاين تصويرة', noResult: 'مازال ما كاينش نتيجة', tapOpen: 'ضغط باش تكبّر',
      role: { walls: 'الحيوط', accent: 'لون مميز', main: 'أساسي', secondary: 'ثانوي' },
    },
    chat: {
      title: 'شات جديد (بحال الواتساب)', hint: 'كيعوّض شات المساعد بشات بسيط: ميساجات، فوكال وتصاور بسرعة. ملي كتطفيه كيرجع الشات القديم.', on: 'شات الواتساب خدام', off: 'الشات القديم',
      voice: 'ميساج صوتي', record: 'بقى ضاغط باش تسجّل', recording: 'كنسجل…', slide: '‹ جرّ باش تلغي', cancel: 'لغي', send: 'صيفط', play: 'شغل', pause: 'وقف', micDenied: 'عطي الإذن للميكرو باش تصيفط ميساج صوتي.', micFailed: 'ما قدرناش نسجلو.', tooShort: 'الميساج قصير بزاف',
      photos: 'التصاور', camera: 'الكاميرا', gallery: 'الكاليري', caption: 'زيد تعليق…', sendN: 'صيفط {{n}}', today: 'اليوم', yesterday: 'البارح', voiceMsg: 'ميساج صوتي', photoMsg: 'تصويرة', tapToSee: 'ضغط باش تحل', empty: 'كتب، هضر ولا صيفط تصويرة.', sending: 'كيتصيفط…', failedSend: 'ما تصيفطش',
    },
  },
};
