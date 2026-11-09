/**
 * Human labels for the "unsaved changes" dialog: turns a raw change (`fill.color`, `case`: 'none' -> 'upper') into
 * "اللون" and "بدون → أحرف كبيرة". Pure (no React): the language index and the fallbacks are injected, so it runs in Node checks.
 * Rows are [fr, ar, dar] like the other locale tables.
 */
import type { Change } from '@/lib/changes';

type Row = [fr: string, ar: string, dar: string];
export const LANG_INDEX: Record<string, 0 | 1 | 2> = { fr: 0, ar: 1, dar: 2 };
const pickLang = (row: Row, lang: string) => row[LANG_INDEX[lang] ?? 2];

/** Whole paths first (they win), then single segments. */
const PATHS: Record<string, Row> = {
  'fill.color': ['Couleur', 'اللون', 'اللون'], 'fill.color2': ['Couleur 2', 'اللون الثاني', 'اللون التاني'], 'fill.mode': ['Remplissage', 'نوع التعبئة', 'نوع التعبئة'], 'fill.angle': ['Angle du dégradé', 'زاوية التدرج', 'زاوية التدرج'],
  'icon.name': ['Icône', 'الأيقونة', 'الأيقونة'], 'icon.pos': ['Place de l’icône', 'موضع الأيقونة', 'بلاصة الأيقونة'], 'icon.scale': ['Taille de l’icône', 'حجم الأيقونة', 'حجم الأيقونة'], 'icon.color': ['Couleur de l’icône', 'لون الأيقونة', 'لون الأيقونة'], 'icon.gap': ['Espace icône', 'مسافة الأيقونة', 'مسافة الأيقونة'],
  'mono.text': ['Lettres', 'الأحرف', 'الحروف'], 'mono.shape': ['Forme', 'الشكل', 'الشكل'], 'mono.bg': ['Fond du monogramme', 'خلفية الأحرف', 'خلفية الحروف'], 'mono.fg': ['Lettres du monogramme', 'لون الأحرف', 'لون الحروف'], 'mono.scale': ['Taille du monogramme', 'حجم الأحرف المدمجة', 'حجم الحروف'], 'mono.withName': ['Avec le nom', 'مع الاسم', 'مع السمية'],
  'shadow.on': ['Ombre', 'الظل', 'الظل'], 'shadow.color': ['Couleur de l’ombre', 'لون الظل', 'لون الظل'], 'shadow.blur': ['Flou de l’ombre', 'تمويه الظل', 'تمويه الظل'], 'shadow.opacity': ['Opacité de l’ombre', 'شفافية الظل', 'شفافية الظل'], 'shadow.x': ['Ombre X', 'إزاحة الظل أفقيًا', 'إزاحة الظل أفقيًا'], 'shadow.y': ['Ombre Y', 'إزاحة الظل عموديًا', 'إزاحة الظل عموديًا'],
  'outline.on': ['Contour', 'الحدود', 'الحدود'], 'outline.color': ['Couleur du contour', 'لون الحدود', 'لون الحدود'], 'outline.width': ['Épaisseur du contour', 'سماكة الحدود', 'سماكة الحدود'],
  'palette.base': ['Couleur de base', 'اللون الأساسي', 'اللون الأساسي'], 'palette.harmony': ['Harmonie', 'تناغم الألوان', 'تناغم الألوان'],
  'app.bg': ['Fond de l’icône d’app', 'خلفية أيقونة التطبيق', 'خلفية أيقونة التطبيق'], 'app.fg': ['Symbole de l’icône d’app', 'رمز أيقونة التطبيق', 'رمز أيقونة التطبيق'], 'app.shape': ['Forme de l’icône d’app', 'شكل أيقونة التطبيق', 'شكل أيقونة التطبيق'], 'app.source': ['Contenu de l’icône d’app', 'محتوى أيقونة التطبيق', 'محتوى أيقونة التطبيق'],
  'image.light': ['Image (clair)', 'الصورة (فاتح)', 'التصويرة (فاتح)'], 'image.dark': ['Image (sombre)', 'الصورة (داكن)', 'التصويرة (غامق)'], 'image.height': ['Hauteur de l’image', 'ارتفاع الصورة', 'علو التصويرة'],
  'top.text': ['Ligne du haut', 'السطر العلوي', 'السطر الفوقاني'], 'bottom.text': ['Ligne du bas', 'السطر السفلي', 'السطر التحتاني'], 'top.on': ['Ligne du haut', 'السطر العلوي', 'السطر الفوقاني'], 'bottom.on': ['Ligne du bas', 'السطر السفلي', 'السطر التحتاني'],
  'top.size': ['Taille ligne haut', 'حجم السطر العلوي', 'حجم السطر الفوقاني'], 'bottom.size': ['Taille ligne bas', 'حجم السطر السفلي', 'حجم السطر التحتاني'],
};
const SEGS: Record<string, Row> = {
  font: ['Police', 'الخط', 'الخط'], weight: ['Graisse', 'السماكة', 'السماكة'], tracking: ['Espacement', 'تباعد الحروف', 'تباعد الحروف'], case: ['Casse', 'حالة الأحرف', 'حالة الحروف'],
  size: ['Taille', 'الحجم', 'الحجم'], italic: ['Italique', 'مائل', 'مايل'], name: ['Nom', 'الاسم', 'السمية'], type: ['Type', 'النوع', 'النوع'], decor: ['Décor', 'الزخرفة', 'الزخرفة'],
  align: ['Alignement', 'المحاذاة', 'المحاذاة'], dir: ['Direction', 'الاتجاه', 'الاتجاه'], autoContrast: ['Contraste auto', 'التباين التلقائي', 'التباين الأوتوماتيكي'],
  fill: ['Remplissage', 'التعبئة', 'التعبئة'], color: ['Couleur', 'اللون', 'اللون'], color2: ['Couleur 2', 'اللون الثاني', 'اللون التاني'], icon: ['Icône', 'الأيقونة', 'الأيقونة'], mono: ['Monogramme', 'الأحرف المدمجة', 'الحروف'],
  shadow: ['Ombre', 'الظل', 'الظل'], outline: ['Contour', 'الحدود', 'الحدود'], palette: ['Palette', 'لوحة الألوان', 'لوحة الألوان'], top: ['Ligne du haut', 'السطر العلوي', 'السطر الفوقاني'], bottom: ['Ligne du bas', 'السطر السفلي', 'السطر التحتاني'],
  app: ['Icône d’app', 'أيقونة التطبيق', 'أيقونة التطبيق'], image: ['Image', 'الصورة', 'التصويرة'], logo: ['Logo', 'الشعار', 'اللوغو'],
  text: ['Texte', 'النص', 'النص'], side: ['Côté', 'الجهة', 'الجهة'], gap: ['Espace', 'المسافة', 'المسافة'], on: ['Activé', 'التفعيل', 'التفعيل'], width: ['Largeur', 'العرض', 'العرض'], height: ['Hauteur', 'الارتفاع', 'العلو'],
  opacity: ['Opacité', 'الشفافية', 'الشفافية'], blur: ['Flou', 'التمويه', 'التمويه'], angle: ['Angle', 'الزاوية', 'الزاوية'], scale: ['Échelle', 'المقياس', 'المقياس'], x: ['Décalage X', 'الإزاحة س', 'الإزاحة س'], y: ['Décalage Y', 'الإزاحة ص', 'الإزاحة ص'],
  title: ['Titre', 'العنوان', 'العنوان'], subtitle: ['Sous-titre', 'العنوان الفرعي', 'العنوان الفرعي'], description: ['Description', 'الوصف', 'الوصف'], credits: ['Crédits', 'الرصيد', 'الكريدي'], blocked: ['Bloqué', 'محظور', 'محظور'],
  visible: ['Visible', 'ظاهر', 'ظاهر'], order: ['Ordre', 'الترتيب', 'الترتيب'], price: ['Prix', 'السعر', 'الثمن'], media: ['Média', 'الوسائط', 'الميديا'], images: ['Images', 'الصور', 'التصاور'], speed: ['Vitesse', 'السرعة', 'السرعة'], pause: ['Pause', 'التوقف', 'الوقفة'],
  toolCards: ['Cartes d’outils', 'بطاقات الأدوات', 'كارطات الأدوات'], studio: ['Studio', 'الاستوديو', 'الاستوديو'], motion: ['Mouvement', 'الحركة', 'الحركة'], bar: ['Barre', 'الشريط', 'الشريط'], els: ['Éléments', 'العناصر', 'العناصر'], tint: ['Teinte', 'اللون العام', 'اللون العام'],
  ease: ['Accélération', 'التسارع', 'التسارع'], seed: ['Graine', 'البذرة', 'البذرة'], force: ['Transition imposée', 'الانتقال المفروض', 'الانتقال المفروض'], accent: ['Couleur d’accent', 'اللون المميز', 'اللون المميز'],
  count: ['Nombre', 'العدد', 'العدد'], spin: ['Rotation', 'الدوران', 'الدوران'], glow: ['Lueur', 'التوهج', 'التوهج'], trail: ['Traînée', 'الذيل', 'الذيل'], shape: ['Forme', 'الشكل', 'الشكل'], paint: ['Peinture', 'التلوين', 'التلوين'],
  look: ['Aspect', 'المظهر', 'المظهر'], mode: ['Mode', 'الوضع', 'الوضع'], kind: ['Genre', 'النوع', 'النوع'], palettes: ['Palettes', 'الألوان', 'الألوان'], enabled: ['Activé', 'مفعّل', 'مفعّل'], instantFirst: ['Première carte immédiate', 'الانتقال الفوري للبطاقة الأولى', 'الانتقال الفوري للكارطة الأولى'],
  harmony: ['Harmonie', 'تناغم الألوان', 'تناغم الألوان'], base: ['Couleur de base', 'اللون الأساسي', 'اللون الأساسي'], pos: ['Place', 'الموضع', 'البلاصة'], bg: ['Fond', 'الخلفية', 'الخلفية'], fg: ['Texte', 'لون النص', 'لون النص'],
  light: ['Clair', 'فاتح', 'فاتح'], dark: ['Sombre', 'داكن', 'غامق'], primary: ['Couleur principale', 'اللون الرئيسي', 'اللون الرئيسي'], surface: ['Surface', 'السطح', 'السطح'], ink: ['Encre', 'الحبر', 'الحبر'],
  active: ['Actif', 'النشط', 'النشط'], custom: ['Personnalisé', 'مخصص', 'مخصص'], role: ['Rôle', 'الدور', 'الدور'], whatsapp: ['WhatsApp', 'واتساب', 'واتساب'],
};
/** Language keys of a multilingual field (`title.dar`). */
const LANG_NAMES: Record<string, Row> = { dar: ['Darija', 'الدارجة', 'الدارجة'], ar: ['Arabe', 'العربية', 'العربية'], fr: ['Français', 'الفرنسية', 'الفرنسية'] };

/** Words stored as enum values (translated only for the keys listed in ENUM_KEYS, so a user's own text is never touched). */
const VALUES: Record<string, Row> = {
  upper: ['Majuscules', 'أحرف كبيرة', 'حروف كبيرة'], lower: ['Minuscules', 'أحرف صغيرة', 'حروف صغيرة'], title: ['Initiales', 'بداية الكلمات', 'بداية الكلمات'], none: ['Aucun', 'بدون', 'بلا'],
  underline: ['Soulignement', 'خط تحتي', 'خط تحتاني'], badge: ['Badge', 'شارة', 'بادج'], left: ['Gauche', 'يسار', 'يسار'], center: ['Centre', 'وسط', 'وسط'], right: ['Droite', 'يمين', 'يمين'],
  start: ['Début', 'البداية', 'البداية'], end: ['Fin', 'النهاية', 'النهاية'], top: ['Haut', 'أعلى', 'فوق'], bottom: ['Bas', 'أسفل', 'تحت'], auto: ['Auto', 'تلقائي', 'أوتوماتيك'],
  ltr: ['G → D', 'يسار ← يمين', 'يسار ← يمين'], rtl: ['D → G', 'يمين ← يسار', 'يمين ← يسار'], solid: ['Uni', 'لون واحد', 'لون واحد'], gradient: ['Dégradé', 'تدرج', 'تدرج'],
  text: ['Texte', 'نص', 'نص'], iconText: ['Icône + texte', 'أيقونة ونص', 'أيقونة ونص'], monogram: ['Monogramme', 'أحرف مدمجة', 'حروف'], image: ['Image', 'صورة', 'تصويرة'],
  circle: ['Cercle', 'دائرة', 'دائرة'], squircle: ['Arrondi', 'مربع مدوّر', 'مربع مدور'], square: ['Carré', 'مربع', 'مربع'], icon: ['Icône', 'أيقونة', 'أيقونة'], initial: ['Initiale', 'الحرف الأول', 'الحرف الأول'],
  mono: ['Monochrome', 'لون واحد', 'لون واحد'], analogous: ['Analogue', 'متجاور', 'متجاور'], complementary: ['Complémentaire', 'متكامل', 'متكامل'], triad: ['Triade', 'ثلاثي', 'ثلاثي'], split: ['Complément scindé', 'متكامل مجزّأ', 'متكامل مجزأ'],
  effect: ['Selon l’effet', 'حسب التأثير', 'حسب التأثير'], custom: ['Personnalisé', 'مخصص', 'مخصص'], off: ['Désactivé', 'متوقف', 'مطفي'], white: ['Blanc', 'أبيض', 'بيض'], accent: ['Accent', 'لون مميز', 'لون مميز'],
  fixed: ['Fixe', 'ثابت', 'ثابت'], alternate: ['Alterné', 'متبادل', 'متبادل'], random: ['Aléatoire', 'عشوائي', 'عشوائي'],
};
const ENUM_KEYS = new Set(['type', 'case', 'decor', 'align', 'dir', 'mode', 'pos', 'side', 'shape', 'harmony', 'source', 'kind', 'look', 'colors', 'paint']);

const UNITS: Record<string, string> = { tracking: '%', scale: '%', 'top.size': '%', 'bottom.size': '%', size: 'px', gap: 'px', blur: 'px', width: 'px', height: 'px', angle: '°', glow: 'px', trail: 'px' };

export interface Val { text: string; color?: string }
export interface Described { label: string; before: Val; after: Val }
export interface Ctx {
  lang: string;
  /** Translate a key of the app dictionary. */
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** Does the app dictionary know this key? (used for the old per-field labels) */
  has: (key: string) => boolean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const isEnumPath = (path: string) => ENUM_KEYS.has(path.split('.').pop() ?? '');
const SETTING_KEYS: Record<string, string> = { frenchFont: 'improve.frenchFont', arabicFont: 'improve.arabicFont', galleryLayout: 'improve.galleryLayout', layouts: 'ly.title', appSearchEnabled: 'improve.appSearch', adminSearchEnabled: 'improve.adminSearch', exitConfirmationEnabled: 'improve.exitEnabled', autoTranslate: 'improve.autoTranslate', userNavStyle: 'admin.iface.userNav', adminMenuDesign: 'mx.design.title', adminMenuAnim: 'mx.anim.title', defaultFreeCredits: 'admin.credits.defaultCredits' };

/** "fill.color" -> "اللون"; unknown segments are dropped when a known one exists; an index (`0`) is never shown. */
export function labelOf(path: string, ctx: Ctx, given?: string): string {
  const segs = path.split('.');
  const tail = (list: string[]) => list.filter((s) => !/^\d+$/.test(s));
  const lastLang = segs.length > 1 && LANG_NAMES[segs[segs.length - 1]] ? pickLang(LANG_NAMES[segs[segs.length - 1]], ctx.lang) : '';
  if (given) return lastLang ? `${given} · ${lastLang}` : given;
  if (PATHS[path]) return pickLang(PATHS[path], ctx.lang);
  const two = segs.slice(-2).join('.');
  if (PATHS[two]) return pickLang(PATHS[two], ctx.lang);
  const out: string[] = [];
  for (const s of tail(segs)) {
    const known = SETTING_KEYS[s] && ctx.has(SETTING_KEYS[s]) ? ctx.t(SETTING_KEYS[s]) : SEGS[s] ? pickLang(SEGS[s], ctx.lang) : LANG_NAMES[s] && out.length ? pickLang(LANG_NAMES[s], ctx.lang) : ['admin.f.', 'improve.', 'admin.nav.'].map((p) => p + s).find((c) => ctx.has(c));
    if (known) out.push(known.startsWith('admin.') || known.startsWith('improve.') || known.startsWith('mx.') ? ctx.t(known) : known);
  }
  if (out.length) return [...new Set(out)].slice(-2).join(' · ');
  return ctx.t('lv.setting');
}

export function valueOf(path: string, v: unknown, ctx: Ctx, secret?: boolean): Val {
  if (secret) return { text: ctx.t('improve.protectedValue') };
  const last = path.split('.').pop() ?? '';
  if (v === undefined || v === null) return { text: ctx.t('improve.emptyValue') };
  if (v === '') return { text: /color|^bg$|^fg$|accent|tint|c1|c2|c3/i.test(last) ? ctx.t('lv.auto') : ctx.t('improve.emptyValue') };
  if (typeof v === 'boolean') return { text: ctx.t(v ? 'lv.on' : 'lv.off') };
  if (typeof v === 'number') { const u = UNITS[path] ?? UNITS[path.split('.').slice(-2).join('.')] ?? UNITS[last]; return { text: `${Math.round(v * 100) / 100}${u ?? ''}` }; }
  if (typeof v === 'string') {
    if (HEX.test(v)) return { text: v.toUpperCase(), color: v };
    if (isEnumPath(path) && VALUES[v]) return { text: pickLang(VALUES[v], ctx.lang) };
    if (v.startsWith('data:') || v.startsWith('/api/media/') || /^https?:\/\//.test(v)) return { text: ctx.t('lv.file') };
    return { text: v.replace(/[-_]/g, ' ') === v ? v : v };
  }
  if (Array.isArray(v)) return { text: ctx.t('lv.items', { n: v.length }) };
  return { text: ctx.t('lv.edited') };
}

export function describeChange(c: Change, ctx: Ctx): Described {
  return { label: labelOf(c.path, ctx, c.label), before: valueOf(c.path, c.before, ctx, c.secret), after: valueOf(c.path, c.after, ctx, c.secret) };
}

/** Identical entries (the same change reported by two guards) collapse to one. */
export function uniqueChanges(list: Change[]): Change[] {
  return [...new Map(list.map((c) => [JSON.stringify([c.path, c.before, c.after]), c])).values()];
}
/** Short form for a chip. */
export const clip = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Which summary sentence to use for n changes (Arabic has distinct forms for 1, 2, 3-10 and 11+). */
export const summaryKey = (n: number) => (n === 1 ? 'lv.sum1' : n === 2 ? 'lv.sum2' : n <= 10 ? 'lv.sumFew' : 'lv.sumMany');
