import type * as T from '../types';
import { pool, unsplash } from './images';

const L = (dar: string, ar: string, fr: string): T.LText => ({ dar, ar, fr });
type PoolKey = keyof typeof pool;
export const img = (k: PoolKey, i: number, w = 600) => {
  const list = pool[k] as readonly string[];
  return unsplash(list[((i % list.length) + list.length) % list.length], w);
};
export const VIDEO_A = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
export const VIDEO_B = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';

const ord = <X extends object>(arr: X[]) => arr.map((x, i) => ({ ...x, order: i, visible: true }));

export const seedTabs = (): T.HomeTab[] =>
  ord([
    { id: 'tab_interior', title: L('داخلي', 'داخلي', 'Intérieur') },
    { id: 'tab_exterior', title: L('خارجي', 'خارجي', 'Extérieur') },
    { id: 'tab_featured', title: L('مميز', 'مميز', 'À la une') },
    { id: 'tab_decor', title: L('ديكور الدار', 'ديكور المنزل', 'Déco maison') },
  ]);

export const seedTools = (): T.Tool[] =>
  ord<Omit<T.Tool, 'order' | 'visible'>>([
    { id: 'tool_interior', tabId: 'tab_interior', roomGroup: 'interior', steps: ['room', 'style', 'mode'], modelIds: ['mdl_gemini', 'mdl_gpt', 'mdl_flux'],
      title: L('تصميم داخلي', 'التصميم الداخلي', "Design d'intérieur"), subtitle: L('بدّل ستايل الدار ديالك', 'أعد تصميم مساحتك الداخلية', 'Redécorez votre espace'),
      media: { type: 'image', uri: img('living', 0, 900) } },
    { id: 'tool_furnish', tabId: 'tab_interior', roomGroup: 'interior', steps: ['room', 'style'], modelIds: ['mdl_gemini'],
      title: L('تأثيث بيت خاوي', 'تأثيث غرفة فارغة', 'Meubler une pièce vide'), subtitle: L('عمّر البيوت الخاوية بالأثاث والديكور', 'املأ الغرف الفارغة بالأثاث والديكور', 'Remplissez les pièces vides de meubles et déco'),
      media: { type: 'image', uri: img('living', 7, 900) } },
    { id: 'tool_floorplan', tabId: 'tab_interior', roomGroup: 'interior', steps: ['style'], modelIds: ['mdl_gpt'],
      title: L('مخطط الطابق', 'مخطط الطابق', 'Plan d’étage'), subtitle: L('حوّل المخطط لتصميم واقعي', 'حوّل المخطط إلى تصميم واقعي', 'Transformez un plan en rendu réaliste'),
      media: { type: 'image', uri: img('dining', 1, 900) } },
    { id: 'tool_exterior', tabId: 'tab_exterior', roomGroup: 'exterior', steps: ['room', 'style'], modelIds: ['mdl_gemini', 'mdl_flux'],
      title: L('تصميم الواجهة', 'التصميم الخارجي', "Design d'extérieur"), subtitle: L('جدّد الواجهة ديال الدار', 'جدّد واجهة منزلك', 'Rénovez la façade de votre maison'),
      media: { type: 'image', uri: img('exterior', 0, 900) } },
    { id: 'tool_garden', tabId: 'tab_exterior', roomGroup: 'exterior', steps: ['style'], modelIds: ['mdl_flux'],
      title: L('تصميم الجنان', 'تصميم الحديقة', 'Design de jardin'), subtitle: L('جنان وتيراس بحال الحلم', 'حديقة وتراس كما تحلم', 'Jardin et terrasse de rêve'),
      media: { type: 'image', uri: img('exterior', 3, 900) } },
    { id: 'tool_staging', tabId: 'tab_featured', roomGroup: 'interior', steps: ['room', 'style', 'mode'], modelIds: ['mdl_gemini', 'mdl_gpt'],
      title: L('تجهيز افتراضي', 'تجهيز افتراضي للبيع', 'Home staging virtuel'), subtitle: L('وجّد الدار للبيع ولا الكراء', 'جهّز العقار للبيع أو الإيجار', 'Préparez un bien à vendre ou louer'),
      media: { type: 'video', uri: VIDEO_A, poster: img('living', 4, 900) } },
    { id: 'tool_decor', tabId: 'tab_decor', roomGroup: 'interior', steps: ['room', 'style'], modelIds: ['mdl_gemini'],
      title: L('أفكار الديكور', 'أفكار الديكور', 'Idées déco'), subtitle: L('زليج، زرابي وإكسسوارات', 'زليج وسجاد وإكسسوارات', 'Zellige, tapis et accessoires'),
      media: { type: 'image', uri: img('living', 11, 900) } },
    { id: 'tool_paint', tabId: 'tab_decor', roomGroup: 'interior', steps: ['mode'], modelIds: ['mdl_gpt', 'mdl_gemini'],
      title: L('تبديل الصباغة', 'تغيير ألوان الجدران', 'Peinture & couleurs'), subtitle: L('جرّب ألوان جدد فالجدران', 'جرّب ألوانًا جديدة للجدران', 'Testez de nouvelles couleurs de murs'),
      media: { type: 'video', uri: VIDEO_B, poster: img('bedroom', 1, 900) } },
  ]);

const rt = (id: string, group: T.Group, icon: string, image: string, t: T.LText, isNew = false) => ({
  id, group, icon, image, title: t, isNew, displayMode: (group === 'interior' ? 'icon' : 'image') as 'icon' | 'image',
});
export const seedRoomTypes = (): T.RoomType[] =>
  ord([
    rt('rt_living', 'interior', 'sofa-outline', img('living', 2, 300), L('الصالون', 'غرفة المعيشة', 'Salon')),
    rt('rt_bedroom', 'interior', 'bed-king-outline', img('bedroom', 0, 300), L('بيت النعاس', 'غرفة النوم', 'Chambre')),
    rt('rt_kitchen', 'interior', 'stove', img('kitchen', 0, 300), L('الكوزينة', 'المطبخ', 'Cuisine')),
    rt('rt_bathroom', 'interior', 'shower', img('bathroom', 0, 300), L('الحمام', 'الحمّام', 'Salle de bain')),
    rt('rt_dining', 'interior', 'silverware-fork-knife', img('dining', 0, 300), L('بيت الماكلة', 'غرفة الطعام', 'Salle à manger')),
    rt('rt_stairs', 'interior', 'stairs', img('living', 9, 300), L('الدّرج', 'الدرج', 'Escalier')),
    rt('rt_balcony', 'interior', 'balcony', img('balcony', 0, 300), L('البالكون', 'الشرفة', 'Balcon'), true),
    rt('rt_nursery', 'interior', 'baby-carriage', img('bedroom', 3, 300), L('بيت الدراري الصغار', 'غرفة الأطفال', 'Chambre bébé'), true),
    rt('rt_garage', 'interior', 'garage', img('living', 14, 300), L('الكراج', 'المرآب', 'Garage')),
    rt('rt_entry', 'interior', 'door-open', img('living', 16, 300), L('المدخل', 'المدخل', 'Entrée')),
    rt('rt_laundry', 'interior', 'washing-machine', img('bathroom', 2, 300), L('بيت الغسيل', 'غرفة الغسيل', 'Buanderie')),
    rt('rt_office', 'interior', 'desk', img('living', 18, 300), L('المكتب', 'المكتب', 'Bureau')),
    rt('rt_homeoffice', 'interior', 'laptop', img('living', 20, 300), L('مكتب فالدار', 'مكتب منزلي', 'Bureau à domicile')),
    rt('rt_study', 'interior', 'book-open-variant', img('living', 22, 300), L('بيت القراية', 'غرفة الدراسة', 'Salle d’étude')),
    rt('rt_house', 'exterior', 'home-roof', img('exterior', 0, 300), L('دار', 'منزل', 'Maison')),
    rt('rt_villa', 'exterior', 'home-variant-outline', img('exterior', 2, 300), L('فيلا', 'فيلا', 'Villa')),
    rt('rt_garden', 'exterior', 'flower-outline', img('exterior', 4, 300), L('جنان', 'حديقة', 'Jardin')),
    rt('rt_terrace', 'exterior', 'balcony', img('balcony', 0, 300), L('تيراس', 'تراس', 'Terrasse'), true),
    rt('rt_pool', 'exterior', 'pool', img('exterior', 6, 300), L('مسبح', 'مسبح', 'Piscine')),
    rt('rt_building', 'exterior', 'office-building-outline', img('exterior', 8, 300), L('عمارة', 'عمارة', 'Immeuble')),
  ]);

export const seedStyles = (): T.StyleItem[] =>
  ord([
    { id: 'st_modern', title: L('عصري', 'عصري', 'Moderne'), image: img('living', 0, 240) },
    { id: 'st_cozy', title: L('دافئ', 'مريح', 'Cosy'), image: img('living', 3, 240) },
    { id: 'st_christmas', title: L('عيد الميلاد', 'أعياد الميلاد', 'Noël'), image: img('living', 5, 240) },
    { id: 'st_luxury', title: L('فاخر', 'فاخر', 'Luxe'), image: img('living', 8, 240) },
    { id: 'st_minimal', title: L('بسيط', 'بسيط', 'Minimaliste'), image: img('living', 12, 240) },
    { id: 'st_scandi', title: L('سكاندينافي', 'إسكندنافي', 'Scandinave'), image: img('bedroom', 1, 240) },
    { id: 'st_farm', title: L('ريفي', 'ريفي', 'Campagne'), image: img('kitchen', 1, 240) },
    { id: 'st_midcentury', title: L('منتصف القرن', 'منتصف القرن', 'Mid-century'), image: img('living', 15, 240) },
    { id: 'st_airbnb', title: L('إيربنب', 'إيربنب', 'Airbnb'), image: img('bedroom', 2, 240) },
    { id: 'st_moroccan', title: L('مغربي', 'مغربي', 'Marocain'), image: img('living', 17, 240) },
    { id: 'st_boho', title: L('بوهيمي', 'بوهيمي', 'Bohème'), image: img('living', 19, 240) },
    { id: 'st_industrial', title: L('صناعي', 'صناعي', 'Industriel'), image: img('dining', 2, 240) },
  ]);

export const seedPalettes = (): T.Palette[] =>
  ord([
    { id: 'pal_surprise', isSurprise: true, colors: [], title: L('فاجئني', 'فاجئني', 'Surprenez-moi') },
    { id: 'pal_neutral', isSurprise: false, colors: ['#F2EFEA', '#CFC6B8', '#9A8F82', '#222222'], title: L('حيادي متباين', 'ألوان محايدة متباينة', 'Neutres contrastés') },
    { id: 'pal_earth', isSurprise: false, colors: ['#B5651D', '#D98E4A', '#8C4A2F', '#5B6B3A'], title: L('ألوان الأرض الدافئة', 'ألوان ترابية دافئة', 'Tons terre chauds') },
    { id: 'pal_blue', isSurprise: false, colors: ['#9DB7D5', '#5F86B0', '#2F4A6D', '#E8EEF5'], title: L('أزرق هادئ', 'أزرق هادئ', 'Bleus apaisants') },
    { id: 'pal_pastel', isSurprise: false, colors: ['#F7D6E0', '#F2B5D4', '#B8E0D2', '#EAD7F7'], title: L('باستيل ناعم', 'ألوان باستيل', 'Pastels doux') },
    { id: 'pal_linen', isSurprise: false, colors: ['#F7F3EB', '#DED1BD', '#B9A48A', '#66594B'], title: L('كتان طبيعي', 'كتان طبيعي', 'Lin naturel') },
    { id: 'pal_sage', isSurprise: false, colors: ['#EFF1E7', '#C4CEB5', '#8B9E7D', '#414E3C'], title: L('مريمية وزيتون', 'المريمية والزيتون', 'Sauge & olive') },
    { id: 'pal_terracotta', isSurprise: false, colors: ['#F4E6D8', '#D8A48F', '#B85F44', '#6D3B2E'], title: L('طين وزليج', 'الطين الدافئ', 'Terre cuite') },
    { id: 'pal_coastal', isSurprise: false, colors: ['#F6F4EE', '#D3E3E6', '#7DA6B2', '#304F61'], title: L('نسيم البحر', 'نسيم البحر', 'Brise marine') },
    { id: 'pal_mocha', isSurprise: false, colors: ['#F1E8DC', '#CCB59F', '#99755F', '#4D342A'], title: L('موكا وكريمة', 'الموكا والكريمة', 'Moka & crème') },
    { id: 'pal_burgundy', isSurprise: false, colors: ['#F1E6DD', '#CEB4A2', '#8C4053', '#442333'], title: L('عنابي فاخر', 'عنابي فاخر', 'Bordeaux raffiné') },
    { id: 'pal_indigo', isSurprise: false, colors: ['#F0EBDD', '#C3B69A', '#626F9A', '#263455'], title: L('نيلي ونحاس', 'النيلي والنحاس', 'Indigo & laiton') },
    { id: 'pal_desert', isSurprise: false, colors: ['#F5E9D5', '#D5B58C', '#BC8261', '#726F52'], title: L('رمل الصحراء', 'رمال الصحراء', 'Sable du désert') },
    { id: 'pal_japandi', isSurprise: false, colors: ['#F2EEE6', '#C7C4B6', '#8A8D81', '#383C37'], title: L('جاباندي هادئ', 'جاباندي هادئ', 'Japandi serein') },
    { id: 'pal_rose', isSurprise: false, colors: ['#F5ECE9', '#D8B7B3', '#A6787B', '#5B464D'], title: L('وردي غباري', 'وردي ناعم', 'Rose poudré') },
    { id: 'pal_green', isSurprise: false, colors: ['#2E4A3A', '#5B7F5C', '#A8C3A0', '#F1EFE3'], title: L('أخضر الغابة', 'أخضر الغابة', 'Vert forêt') },
  ]);

export const seedSections = (): T.InspirationSection[] =>
  ord([
    { id: 'sec_interior', icon: 'sofa-outline', toolId: 'tool_interior', title: L('إلهامات داخلية', 'إلهامات داخلية', 'Inspirations intérieur') },
    { id: 'sec_exterior', icon: 'home-roof', toolId: 'tool_exterior', title: L('إلهامات خارجية', 'إلهامات خارجية', 'Inspirations extérieur') },
  ]);

const CATS: { id: string; sec: string; key: PoolKey; off: number; n: number; rt: string; t: T.LText }[] = [
  { id: 'cat_living', sec: 'sec_interior', key: 'living', off: 0, n: 24, rt: 'rt_living', t: L('الصالون', 'غرفة المعيشة', 'Salon') },
  { id: 'cat_nursery', sec: 'sec_interior', key: 'bedroom', off: 2, n: 4, rt: 'rt_nursery', t: L('بيت الدراري', 'غرفة الأطفال', 'Chambre bébé') },
  { id: 'cat_bedroom', sec: 'sec_interior', key: 'bedroom', off: 0, n: 4, rt: 'rt_bedroom', t: L('بيت النعاس', 'غرفة النوم', 'Chambre') },
  { id: 'cat_kitchen', sec: 'sec_interior', key: 'kitchen', off: 0, n: 3, rt: 'rt_kitchen', t: L('الكوزينة', 'المطبخ', 'Cuisine') },
  { id: 'cat_dining', sec: 'sec_interior', key: 'dining', off: 0, n: 3, rt: 'rt_dining', t: L('بيت الماكلة', 'غرفة الطعام', 'Salle à manger') },
  { id: 'cat_bath', sec: 'sec_interior', key: 'bathroom', off: 0, n: 3, rt: 'rt_bathroom', t: L('الحمام', 'الحمّام', 'Salle de bain') },
  { id: 'cat_house', sec: 'sec_exterior', key: 'exterior', off: 0, n: 6, rt: 'rt_house', t: L('دور', 'منازل', 'Maisons') },
  { id: 'cat_villa', sec: 'sec_exterior', key: 'exterior', off: 5, n: 6, rt: 'rt_villa', t: L('فيلات', 'فيلات', 'Villas') },
  { id: 'cat_building', sec: 'sec_exterior', key: 'exterior', off: 7, n: 4, rt: 'rt_building', t: L('عمارات ومكاتب', 'عمارات ومكاتب', 'Immeubles & bureaux') },
];
export const seedCategories = (): T.InspirationCategory[] =>
  ord(CATS.map((c) => ({ id: c.id, sectionId: c.sec, title: c.t, cover: img(c.key, c.off, 500), roomTypeId: c.rt })));

const STYLE_IDS = seedStyles().map((s) => s.id);
export const seedInspirations = (): T.InspirationItem[] =>
  ord(
    CATS.flatMap((c) =>
      Array.from({ length: c.n }, (_, i) => ({
        id: `ins_${c.id}_${i}`, categoryId: c.id, image: img(c.key, c.off + i, 800), styleId: STYLE_IDS[(i + c.off) % STYLE_IDS.length],
      })),
    ),
  );

export const seedModels = (): T.AiModel[] =>
  ord<Omit<T.AiModel, 'order' | 'visible'>>([
    { id: 'mdl_gemini', name: 'Gemini Image', provider: 'Google', modelName: 'gemini-2.5-flash-image', apiKey: '', enabled: true, isDefault: true },
    { id: 'mdl_gpt', name: 'GPT Image', provider: 'OpenAI', modelName: 'gpt-image-1', apiKey: '', enabled: true, isDefault: false },
    { id: 'mdl_flux', name: 'FLUX Kontext', provider: 'Black Forest Labs', modelName: 'flux-kontext-pro', apiKey: '', enabled: true, isDefault: false },
    { id: 'mdl_sdxl', name: 'Stable Diffusion XL', provider: 'Stability AI', modelName: 'sdxl-1.0', apiKey: '', enabled: false, isDefault: false },
  ]);

export const seedPlans = (): T.Plan[] =>
  ord([
    { id: 'plan_weekly', title: L('فالسيمانة', 'أسبوعي', 'Hebdomadaire'), price: '49 MAD', period: L('/سيمانة', '/أسبوع', '/sem.'), popular: false },
    { id: 'plan_monthly', title: L('فالشهر', 'شهري', 'Mensuel'), price: '149 MAD', period: L('/شهر', '/شهر', '/mois'), popular: true },
    { id: 'plan_yearly', title: L('فالعام', 'سنوي', 'Annuel'), price: '999 MAD', period: L('/عام', '/سنة', '/an'), popular: false },
  ]);

export const ME = 'usr_me';
export const seedUsers = (defaultCredits: number): T.AppUser[] => {
  const now = Date.now();
  return [
    { id: ME, name: '', whatsapp: '', credits: defaultCredits, leadDone: false, role: 'user', createdAt: now },
    { id: 'usr_admin', name: 'Admin', whatsapp: '', credits: 99, leadDone: true, role: 'admin', createdAt: now - 86400000 * 30 },
    { id: 'usr_1', name: 'Salma El Idrissi', whatsapp: '+212661234567', credits: 0, leadDone: true, role: 'user', createdAt: now - 86400000 * 6 },
    { id: 'usr_2', name: 'Youssef Benali', whatsapp: '+212670987654', credits: 3, leadDone: true, role: 'user', createdAt: now - 86400000 * 3 },
    ...['Amina Tazi', 'Omar Alaoui', 'Khadija Berrada', 'Hamza Chraibi', 'Imane Fassi', 'Rachid Lahlou', 'Nadia Saidi', 'Karim Bennani'].map((name, i): T.AppUser => ({
      id: `usr_d${i}`, name, whatsapp: `+2126${String(20000000 + i * 911).slice(0, 8)}`, credits: i % 4, leadDone: true, role: 'user', createdAt: now - 86400000 * (1 + i * 3.5),
    })),
  ];
};

export const seedRequests = (): T.RenderRequest[] => {
  const now = Date.now();
  const H = 3600000;
  const D = 24 * H;
  const first: T.RenderRequest[] = [
    { id: 'req_1', userId: 'usr_1', name: 'Salma El Idrissi', whatsapp: '+212661234567', photoUri: img('living', 6, 600), aiResult: img('living', 8, 900),
      draft: { toolId: 'tool_interior', roomTypeId: 'rt_living', styleId: 'st_moroccan', mode: 'restyle', modelId: 'mdl_gemini' }, status: 'pending', createdAt: now - H * 5 },
    { id: 'req_2', userId: 'usr_2', name: 'Youssef Benali', whatsapp: '+212670987654', photoUri: img('bedroom', 1, 600), aiResult: img('bedroom', 2, 900),
      draft: { toolId: 'tool_interior', roomTypeId: 'rt_bedroom', styleId: 'st_scandi', mode: 'renovation', modelId: 'mdl_gpt' }, status: 'delivered', finalResult: img('bedroom', 3, 900), createdAt: now - D * 2 },
  ];
  // Demo activity so the admin dashboard has something to show out of the box.
  const names = ['Amina Tazi', 'Omar Alaoui', 'Khadija Berrada', 'Hamza Chraibi', 'Imane Fassi', 'Rachid Lahlou', 'Nadia Saidi', 'Karim Bennani'];
  const tools = ['tool_interior', 'tool_interior', 'tool_interior', 'tool_furnish', 'tool_exterior', 'tool_staging', 'tool_decor', 'tool_garden'];
  const rooms = ['rt_living', 'rt_living', 'rt_bedroom', 'rt_kitchen', 'rt_bathroom', 'rt_dining', 'rt_house'];
  const styles = ['st_moroccan', 'st_modern', 'st_moroccan', 'st_scandi', 'st_boho', 'st_luxury', 'st_minimal', 'st_cozy'];
  const models = ['mdl_gemini', 'mdl_gemini', 'mdl_gpt', 'mdl_flux'];
  const rows = Array.from({ length: 22 }, (_, i): T.RenderRequest => {
    const age = Math.round((i * i * 0.07 + i * 1.1 + 0.5) * D) + (i % 5) * H;
    return {
      id: `req_demo_${i + 1}`, userId: `usr_d${i % names.length}`, name: names[i % names.length], whatsapp: `+2126${String(10000000 + i * 137).slice(0, 8)}`,
      photoUri: img('living', i % 20, 600), aiResult: img('living', (i + 3) % 20, 900),
      draft: { toolId: tools[i % tools.length], roomTypeId: rooms[(i * 3) % rooms.length], styleId: styles[(i * 5) % styles.length], mode: i % 3 ? 'restyle' : 'renovation', modelId: models[i % models.length] },
      status: i < 2 ? 'pending' : i === 2 ? 'processing' : 'delivered', finalResult: i > 2 ? img('living', (i + 6) % 20, 900) : undefined, createdAt: now - age,
    };
  });
  return [...first, ...rows];
};

export const defaultBranding = (): T.Branding => ({ appName: 'Dwira', logoUri: '', logoPosition: 'left', logoFont: 'Lora', logoStyle: 'signature', logoSize: 28 });
export const defaultTheme = (): T.ThemeConfig => ({ active: 'light', custom: {} });
export const defaultAssistant = (): T.AssistantConfig => ({
  type: 'ai', modelId: 'mdl_gemini',
  systemPrompt: 'You are Dwira, a friendly interior design assistant. Answer in the language of the user (Moroccan Darija, Arabic or French). Be concise and practical.',
  whatsappNumber: '+212600000000',
  replyDelayMode: 'auto', replyDelayMinMs: 900, replyDelayMaxMs: 3500, typewriter: true,
  welcome: L('مرحبا! أنا مساعد ديال التصميم الداخلي، كيفاش نقدر نعاونك؟', 'مرحبًا! كيف يمكنني مساعدتك في تصميم منزلك؟', 'Bonjour ! Comment puis-je vous aider pour votre déco ?'),
});
export const defaultSettings = (): T.AppSettings => ({ notifyAdmins: true, notifyUsers: true, appSearchEnabled: true, adminSearchEnabled: true, exitConfirmationEnabled: true, autoTranslate: true, defaultFreeCredits: 1, autoSendWhatsApp: false, homeShowAll: true, homeTabsVisible: true, toolCards: { height: 220, textZone: 'bottom' }, userNavStyle: 'floating', adminNavMode: 'drawer', loaderEnabled: true, loaderStyle: 'ring', loaderColor: '', loaderCustomUri: '', loaderCustomAnim: 'none', loaderDelayMs: 0, bulkPanels: ['tabs', 'tools', 'sections', 'categories', 'inspirations', 'styles', 'roomTypes', 'palettes', 'models', 'plans'] });
