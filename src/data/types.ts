import type { StudioStyle } from '@/lib/fxStudio';

/** Domain model. Every admin-editable text is an `LText` with one value per language. */
export type Lang = 'dar' | 'ar' | 'fr';
export type LText = Record<Lang, string>;
export type Id = string;

/**
 * A tool's media. `slideshow` = several images revealed one over the other with the before/after transitions (see ToolCardFx):
 * `images` holds the pictures in order, `uri` mirrors the first one (so every screen that only knows image / video still shows a picture),
 * `fx` holds this card's animation settings.
 */
export type Media = {
  type: 'image' | 'video' | 'slideshow'; uri: string; poster?: string; images?: string[]; fx?: ToolCardFx;
  /** Slideshow only: a pre-rendered looping MP4 of the card's animation (Admin > Performance). Low-end phones play it instead of the live animation. */
  video?: string;
  /** Signature of what the video was rendered from (images, effects, timing, size): the Performance page flags a video whose signature no longer matches as outdated. */
  videoSig?: string;
};
/** Optional wizard steps. The AI model is NEVER a user step: it is resolved from the admin config. */
export type StepKey = 'room' | 'style' | 'mode';
export type Group = 'interior' | 'exterior';
export type RenderMode = 'restyle' | 'renovation';

type Ordered = { order: number; visible: boolean };

export interface HomeTab extends Ordered { id: Id; title: LText }


/** GLOBAL tools-card layout: stored once (settings.toolCards) and read by every card, never per card. */
export interface ToolCardsGlobal {
  /** Total card height in px (140-420, step 2). */
  height?: number;
  /** Where the text zone sits on every card. */
  textZone?: 'top' | 'bottom';
  /** Text over the picture (gradient) or under / beside it; the same for every card. */
  textPlacement?: 'inside' | 'outside';
  /** Transition availability (ids 1-60). Enabled = can be chosen and played anywhere; missing = Safe + Medium. */
  fxEnabled?: number[];
  /** Subset of the enabled ids that low-end devices may play (the others play the cross-fade); missing = Safe only. */
  fxLowEnd?: number[];
  /** Pre-rendered card videos: 'lowEnd' (default) = only low-end phones play them, 'always' = every phone, 'off' = never (live animation only). */
  videoMode?: VideoMode;
  /** Pre-rendered videos also draw every animated element of the transitions (edge line, knob, doors, ring, decorative pieces ...). Default false. */
  videoExtras?: boolean;
  /** Render quality of the pre-rendered videos: picture size + frame rate + bitrate (see VIDEO_QUALITIES in lib/cardVideoPlan.ts). Default 'balanced'. */
  videoQuality?: VideoQuality;
  /** Advanced render settings of the pre-rendered videos (only the values the admin changed; see VideoAdvanced). */
  videoAdv?: VideoAdvanced;
  /** The first Home card starts its first transition at once (no hold, images and visibility assumed ready). Default true. Admin > Animation Studio. */
  instantFirst?: boolean;
  /** Animation Studio style shared by every card (main transition, bar, elements, colours, motion). Missing = no style (the effects look as designed). See lib/fxStudio.ts. */
  studio?: StudioStyle;
}
export type VideoMode = 'lowEnd' | 'always' | 'off';
export type VideoQuality = 'low' | 'balanced' | 'high' | 'ultra' | 'best';
/**
 * Advanced render settings (Admin > Performance > Advanced rendering). Every key is an OVERRIDE of the chosen quality preset: a missing key
 * follows the preset. See `resolveRender` in lib/cardVideoPlan.ts.
 */
export interface VideoAdvanced {
  /** Output width in px; 0 = the real card size (card width on screen x pixel ratio). */
  width?: number;
  /** Frames per second of the transitions (24 - 60). */
  fps?: number;
  /** Card width on screen in CSS px (used by the real card size). */
  cardW?: number;
  /** Pixel ratio of the screens the video is made for (used by the real card size). */
  dpr?: number;
  /** Fit the file between minMB and maxMB (the encoder is re-run until it does). */
  fit?: boolean;
  minMB?: number;
  maxMB?: number;
  /** Manual bitrate in kbit/s (used when `fit` is off). */
  kbps?: number;
  /** Seconds between two key frames. */
  keyInt?: number;
  /** Preferred encoder; auto = H.264 first (plays everywhere). */
  codec?: 'auto' | 'avc' | 'vp9' | 'av1';
}
export type ToolCardGradient = 'soft' | 'medium' | 'strong';
/** PER-CARD animation settings (Tool.media.fx, slideshow only). Every key is optional: missing keys use the defaults in lib/toolCards.ts. */
export interface ToolCardFx {
  mode?: 'single' | 'multiple';
  /** Multiple mode: kept effect ids (1-60), played one after another. Missing = every enabled effect. Empty = still image. */
  effects?: number[];
  /** Single mode: the chosen effect id. */
  effect?: number;
  /** Hold between two transitions, seconds (0 - 5, default 0.9; 0 = the next transition starts at once). */
  hold?: number;
  /** @deprecated Old name of `hold`; still read when `hold` is missing. */
  pause?: number;
  /** Animation speed multiplier (0.2 - 2, default 1). */
  speed?: number;
  gradient?: ToolCardGradient;
  /** This card's own Animation Studio style: replaces the global one for this card (a default-valued style = "plain", no style at all). */
  studio?: StudioStyle;
}

export interface Tool extends Ordered {
  id: Id;
  tabId: Id;
  title: LText;
  subtitle: LText;
  media: Media;
  /** Enabled optional wizard steps (the photo step is always first). */
  steps: StepKey[];
  /** AI models the admin allows for this tool. */
  modelIds: Id[];
  roomGroup: Group;
}

export interface RoomType extends Ordered {
  id: Id;
  title: LText;
  group: Group;
  displayMode: 'icon' | 'image';
  icon: string;
  image: string;
  isNew: boolean;
}

export interface StyleItem extends Ordered { id: Id; title: LText; image: string }
export interface Palette extends Ordered { id: Id; title: LText; colors: string[]; isSurprise: boolean }

export interface InspirationSection extends Ordered {
  id: Id;
  title: LText;
  icon: string;
  /** Tool opened by "Use this style". */
  toolId: Id;
}
export interface InspirationCategory extends Ordered {
  id: Id;
  sectionId: Id;
  title: LText;
  cover: string;
  roomTypeId?: Id;
  galleryLayout?: GalleryLayout;
}
export interface InspirationItem extends Ordered {
  id: Id;
  categoryId: Id;
  image: string;
  styleId?: Id;
}

/** Pro offer shown on the paywall. Fully admin-editable and stored in the database. */
export interface Plan extends Ordered { id: Id; title: LText; price: string; period: LText; popular: boolean }

export interface AiModel {
  id: Id;
  name: string;
  provider: string;
  modelName: string;
  apiKey: string;
  enabled: boolean;
  isDefault: boolean;
  order: number;
  visible: boolean;
  /** Image engine this model runs on: 'pollinations' (free default) or 'openai' (any OpenAI-compatible images API). Empty = automatic. */
  engine?: 'pollinations' | 'openai' | '';
  /** Optional endpoint for the 'openai' engine. */
  baseUrl?: string;
}

export interface AppUser {
  freeUsed?: number;
  id: Id;
  name: string;
  whatsapp: string;
  credits: number;
  /** Set by an admin: a blocked client cannot sign in or generate. */
  blocked?: boolean;
  /** true once the user went through the first-free-render WhatsApp flow. */
  leadDone: boolean;
  role: 'user' | 'admin';
  createdAt: number;
}

export interface Draft {
  toolId: Id;
  roomTypeId?: Id;
  styleId?: Id;
  mode?: RenderMode;
  paletteId?: Id;
  modelId?: Id;
  /** Free-text instructions written by the client (max 500 characters). */
  prompt?: string;
  /** Custom palette (hex colours). Overrides `paletteId` when present. */
  colors?: string[];
  /** Explore picture used as a style reference. */
  inspirationId?: Id;
  /** `text` = no photo: the room is generated from the description alone. */
  source?: 'photo' | 'text';
}
export interface WizardDraft extends Draft { photoUri: string }

export interface HistoryItem {
  claimId?: string;
  requestId?: Id;
  id: Id;
  userId: Id;
  before: string;
  after?: string;
  status: 'done' | 'pending';
  draft: Draft;
  createdAt: number;
}

export type RequestStatus = 'pending' | 'processing' | 'delivered';
export interface RenderRequest {
  id: Id;
  userId: Id;
  name: string;
  whatsapp: string;
  photoUri: string;
  draft: Draft;
  aiResult?: string;
  finalResult?: string;
  status: RequestStatus;
  autoSent?: boolean;
  historyId?: Id;
  /** Which model made `aiResult` (set by the server on a generation). */
  aiModel?: { engine?: string; model?: string; label?: string };
  /** Admin only (the server strips it for clients): everything the generation really used. */
  aiRun?: AiRun;
  createdAt: number;
}

/** Record of one generation, written by the server (server/imagegen/index.js). */
export interface AiRun {
  at?: number;
  size?: string;
  durationMs?: number;
  failed?: boolean;
  english?: string;
  photo?: { width?: number; height?: number; bytes?: number } | null;
  inputs?: {
    tool?: { id?: string; title?: LText };
    room?: { id?: string; title?: LText } | null;
    style?: { id?: string; title?: LText } | null;
    palette?: { id?: string; title?: LText; colors?: string[]; isSurprise?: boolean } | null;
    inspiration?: { id?: string; image?: string } | null;
    requestedModel?: { id?: string; name?: string; engine?: string; modelName?: string } | null;
  };
  tried?: { engine?: string; model?: string; label?: string; requested?: boolean; referenceSent?: boolean; imagesSent?: number; ok?: boolean; ms?: number; status?: number }[];
  used?: { engine?: string; model?: string; label?: string; referenceSent?: boolean; imagesSent?: number } | null;
  /** Pictures that were candidates for the model besides the client's photo, and whether each one really travelled. */
  images?: PromptImage[];
  rules?: { explore?: boolean; appliesTo?: 'all' | 'explore'; applied?: boolean; scope?: Partial<Record<PromptSection, 'tool' | 'global'>> };
  prompt?: string;
  applied?: {
    task?: string; intent?: string; mode?: string; style?: string; room?: string;
    colors?: { hex: string; name?: string; role?: string }[];
    colorSource?: 'custom' | 'preset' | 'surprise' | 'none';
    reference?: boolean;
    brief?: { original?: string; english?: string } | null;
    images?: string[]; styleMode?: string; roomMode?: string; rules?: boolean; blocksOff?: string[];
  };
}

/* ---- Prompt cards (admin): what the admin decides about the prompt and pictures sent to the image model ---- */
export type PromptSection = 'rules' | 'images' | 'blocks' | 'output';
export type PromptPicture = 'text' | 'image' | 'both';
export type PromptImageRole = 'inspiration' | 'style' | 'room';
export interface PromptImage { role: PromptImageRole; uri?: string; mode?: string; sent: boolean; why?: string }
export interface PromptBlockItem { on?: boolean; texts?: Record<string, string> }
export interface PromptSet {
  rules: { text: string; exploreText: string };
  images: { room: PromptPicture; style: PromptPicture };
  blocks: { order: string[]; items: Record<string, PromptBlockItem> };
  output: { brief: 'both' | 'english' | 'original'; maxSide: number };
}
export interface PromptRules {
  v: 1;
  appliesTo: 'all' | 'explore';
  global: PromptSet;
  tools: Record<Id, Partial<PromptSet>>;
  vocab: { styles: Record<Id, string>; rooms: Record<Id, string> };
}
export interface PromptRulesInfo { rules: PromptRules; catalog: { order: string[]; blocks: Record<string, Record<string, string>>; off: string[]; placeholders: string[]; /** The English wording the app uses today for each style / room type (what an empty Vocabulary field means). */ vocab?: { styles: Record<string, string>; rooms: Record<string, string> } } }
export interface PromptPreview {
  prompt: string;
  blocks: { id: string; variant: string; text: string; custom?: boolean }[];
  images: PromptImage[];
  model: { label?: string; model?: string; engine?: string; refs?: number; live?: boolean };
  size: string; chars: number; source: 'photo' | 'text'; explore: boolean; appliesTo: 'all' | 'explore'; ruled: boolean;
  scope: Partial<Record<PromptSection, 'tool' | 'global'>>;
  warnings: { code: string; items?: string[] }[];
  applied?: { colors?: { hex: string; name?: string; role?: string }[]; colorSource?: 'custom' | 'preset' | 'surprise' | 'none' };
  draft: { toolId?: Id; styleId?: Id; roomTypeId?: Id; inspirationId?: Id; mode?: string };
}

/** A voice note: `uri` is an /api/media URL (or a local file while sending), `durationMs` is optional. */
export interface ChatAudio { uri: string; durationMs?: number }
export interface ChatMessage { id: Id; role: 'user' | 'assistant' | 'admin'; text: string; image?: string; audio?: ChatAudio; createdAt: number }
export interface Conversation { id: Id; userId: Id; title: string; messages: ChatMessage[]; updatedAt: number }

/* ---- single documents ---- */
export interface Branding {
  appName: string; logoUri: string;
  logoMode?: 'text' | 'image';
  logoPosition?: 'left' | 'center' | 'right';
  logoFont?: string; logoColor?: string; logoSize?: number;
  logoStyle?: 'minimal' | 'signature' | 'badge';
  logoItalic?: boolean; logoSpacing?: number;
}
export type GalleryLayout = 'grid' | 'masonry' | 'editorial' | 'carousel';
/** 'custom' or any preset id (see theme/presets.ts). */
export type ThemeId = string;
export interface ThemeConfig { active: ThemeId; custom: Record<string, string> }
export interface AssistantConfig {
  type: 'ai' | 'whatsapp';
  modelId: Id;
  systemPrompt: string;
  whatsappNumber: string;
  welcome: LText;
  /** Human-like pacing of AI replies: `off` answers as soon as the text arrives, `auto` scales with reply length, `custom` uses the bounds below. */
  replyDelayMode?: 'off' | 'auto' | 'custom';
  /** Custom mode bounds (ms): the reply never shows sooner than `min` nor is held longer than `max`. */
  replyDelayMinMs?: number;
  replyDelayMaxMs?: number;
  /** Reveal the answer progressively, like someone typing it. */
  typewriter?: boolean;
}
export type UserNavStyle = 'classic' | 'floating' | 'minimal';
/** Startup loading screen: four built-in animations or the admin's own image (GIF / SVG / PNG / WebP). */
export type LoaderStyle = 'ring' | 'dots' | 'pulse' | 'bars' | 'zellige' | 'arch' | 'lantern' | 'mosaic' | 'custom';
export type LoaderAnim = 'none' | 'spin' | 'pulse';
export type AdminNavMode = 'rail' | 'drawer' | 'top';
export interface AppSettings {
  /** Master switches for push notifications, independent of each other (on unless false). */
  notifyAdmins?: boolean;
  notifyUsers?: boolean;
  /** Minimum hours between two automated (trigger) notifications to the same person. 0 = no limit. Default 24. */
  campaignCapHours?: number;
  appSearchEnabled?: boolean;
  adminSearchEnabled?: boolean;
  exitConfirmationEnabled?: boolean;
  exitTitle?: LText;
  exitMessage?: LText;
  defaultFreeCredits: number;
  autoSendWhatsApp: boolean;
  /** Legacy preference, retained for persisted settings compatibility. */
  homeShowAll: boolean;
  /** Global layout shared by every home tools card (height + text zone). */
  toolCards?: ToolCardsGlobal;
  /** Show the home tab filters; hiding them never hides tool cards. */
  homeTabsVisible?: boolean;
  userNavStyle: UserNavStyle;
  adminNavMode: AdminNavMode;
  arabicFont?: string;
  frenchFont?: string;
  galleryLayout?: GalleryLayout;
  /** Startup loading screen. Off = the app paints directly (no overlay). */
  loaderEnabled?: boolean;
  loaderStyle?: LoaderStyle;
  /** Hex colour; empty = the theme's ink colour. */
  loaderColor?: string;
  /** Image for the 'custom' style. */
  loaderCustomUri?: string;
  loaderCustomAnim?: LoaderAnim;
  /** 0 = automatic: removed as soon as the first two Home cards are on screen. Otherwise the loader stays this many ms. */
  loaderDelayMs?: number;
  /** Fill the other two languages automatically (free translation) when one is typed in an admin form. On unless false. */
  autoTranslate?: boolean;
  /** Show the Relooking / Renovation choice on the last step of the wizard (on unless false). Off = every generation is a Relooking. */
  modeChoice?: boolean;
  /** Let clients switch between the AI models a tool allows (default off: the admin's model is used). */
  aiModelPicker?: boolean;
  /** New WhatsApp-style chat page for clients (voice notes, fast image preview). On unless false. */
  waChat?: boolean;
  /** Bulk/reorder operations must be explicitly enabled per content panel. */
  bulkPanels?: string[];
}

export interface CollMap {
  tabs: HomeTab;
  tools: Tool;
  roomTypes: RoomType;
  styles: StyleItem;
  palettes: Palette;
  sections: InspirationSection;
  categories: InspirationCategory;
  inspirations: InspirationItem;
  models: AiModel;
  plans: Plan;
  users: AppUser;
  requests: RenderRequest;
  history: HistoryItem;
  conversations: Conversation;
}
export interface DocMap {
  branding: Branding;
  theme: ThemeConfig;
  assistant: AssistantConfig;
  settings: AppSettings;
}
/** Per-identity preferences stored in the database (one set per client, one per admin). */
export interface UserPrefs { notifications?: boolean; bannerDismissed?: boolean; lang?: Lang; /** Animation Studio presets the admin saved (per admin, every device). */ studioPresets?: SavedPreset[] }
/** An Animation Studio style saved by the admin to be reused later (`style` is sanitised by `cleanSavedPresets` in lib/fxStudio.ts). */
export interface SavedPreset { id: string; name: string; /** transition the preset was made with (0 = cross-fade) */ fx: number; style: StudioStyle; at: number }
export type CollName = keyof CollMap;
export type DocName = keyof DocMap;
