/** Domain model. Every admin-editable text is an `LText` with one value per language. */
export type Lang = 'dar' | 'ar' | 'fr';
export type LText = Record<Lang, string>;
export type Id = string;

/**
 * A tool's media. `slideshow` = several images played with the 20 before/after effects (see ToolCardFx):
 * `images` holds the pictures in order, `uri` mirrors the first one (so every screen that only knows image / video still shows a picture),
 * `fx` holds this card's animation settings.
 */
export type Media = { type: 'image' | 'video' | 'slideshow'; uri: string; poster?: string; images?: string[]; fx?: ToolCardFx };
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
}
export type ToolCardGradient = 'soft' | 'medium' | 'strong';
/** PER-CARD animation settings (Tool.media.fx, slideshow only). Every key is optional: missing keys use the defaults in lib/toolCards.ts. */
export interface ToolCardFx {
  mode?: 'single' | 'multiple';
  /** Multiple mode: kept effect ids (1-20), played one after another. Empty = static AFTER image. */
  effects?: number[];
  /** Single mode: the chosen effect id. */
  effect?: number;
  /** Pause between transitions, seconds. */
  pause?: number;
  /** Animation speed multiplier. */
  speed?: number;
  textPlacement?: 'inside' | 'outside';
  gradient?: ToolCardGradient;
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
  createdAt: number;
}

export interface ChatMessage { id: Id; role: 'user' | 'assistant' | 'admin'; text: string; image?: string; createdAt: number }
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
  /** Let clients switch between the AI models a tool allows (default off: the admin's model is used). */
  aiModelPicker?: boolean;
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
export interface UserPrefs { notifications?: boolean; bannerDismissed?: boolean; lang?: Lang }
export type CollName = keyof CollMap;
export type DocName = keyof DocMap;
