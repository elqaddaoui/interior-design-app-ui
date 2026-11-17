export type Tenant = {
  id: string; slug: string; name: string; kind: 'default' | 'instance' | 'demo'; status: 'active' | 'trial' | 'suspended'; plan: string; ownerEmail: string;
  sourceDemoId: string | null; notes: string; createdAt: number; path: string; adminPath: string;
  /** Credits the store may spend (null = unlimited), credits spent so far, and who holds the AI keys: 'own' (the store) or 'platform' (API manager). */
  creditLimit: number | null; creditsUsed: number; apiMode: 'own' | 'platform'; apiLinks: Partial<Record<ApiKind, string>>;
  /** Credits the store has handed out to its clients (they all draw from the store's ONE limit). */
  creditsAllocated?: number;
  /** AI switches: a demo's "use API" switch (auto-closes), and the store-wide pause (owner or abuse detector). */
  aiOn: boolean; aiUntil: number | null; aiPaused: boolean; aiPauseReason: string; aiIdleMin: number;
  counts?: { clients: number; requests: number; admins: number; domains: number };
};
export type TenantAdmin = { id: string; username: string; name: string; email: string; disabled: boolean; hasPassword: boolean; lastLoginAt: number | null; createdAt: number };
export type NewAdmin = { id: string; username: string; email: string; password: string | null };
export type Demo = { id: string; name: string; description: string; status: 'draft' | 'published'; tenantId: string; slug: string; version: number; assignments: number; path: string; adminPath: string; createdAt: number; aiOn: boolean; aiUntil: number | null; aiPaused: boolean; aiPauseReason: string; aiIdleMin: number };
export type Assignment = { id: string; tenantId: string; slug: string | null; name: string | null; status: string | null; ownerEmail: string; demoVersion: number; createdAt: number; path: string; adminPath: string };
export type Domain = { domain: string; verified: boolean; txtName: string; txtValue: string };
export type AuditRow = { id: string; at: number; actor: string; action: string; tenantId: string | null; target: string; detail: string };
export type Stats = { tenants: number; active: number; suspended: number; demos: number; assignments: number; themes: number; clients: number; apis: number; creditsUsed: number; platformManaged: number; alerts: number; calls24h: number; demosAiOn: number };
export type ApiKind = 'image' | 'text' | 'other';
export type ApiConn = { id: string; kind: ApiKind; provider: string; label: string; baseUrl: string; model: string; enabled: boolean; isDefault: boolean; hasKey: boolean; keyHint: string; stores: number };
export type ApiCatalog = Record<ApiKind, { id: string; label: string; needsUrl: boolean; needsModel: boolean }[]>;
export type LText = { fr?: string; ar?: string; dar?: string };
/** UI-only snapshot of a store (colours, fonts, texts, tools, tabs...). Never holds client data. */
export type StoreTheme = {
  id: string; name: string; sourceTenantId: string | null; sourceName: string | null; sourceSlug: string | null; createdAt: number; updatedAt: number;
  counts: { tabs: number; tools: number; sections: number; inspirations: number; styles: number; plans: number };
  preview: { appName: string; logoUri: string; logoFont: string; themeId: string; colors: Record<string, string> | null; dark: boolean; fonts: { arabic: string; french: string }; tabs: LText[]; tools: { title: LText; image: string }[] };
};
export type Handoff = { code: string; expiresAt: number; admin: string; url: string };

export type UsageRange = '24h' | '7d' | '30d';
export type UsageCounts = { calls: number; errors: number; blocked: number; units: number };
export type UsageReport = {
  range: UsageRange; step: number; since: number; totals: UsageCounts;
  byKind: ({ kind: ApiKind } & UsageCounts)[];
  byProvider: ({ kind: ApiKind; provider: string; mode: 'own' | 'platform' } & UsageCounts)[];
  byMode: ({ mode: 'own' | 'platform' } & UsageCounts)[];
  byOp: ({ kind: ApiKind; op: string } & UsageCounts)[];
  series: { t: number; image: number; text: number; other: number; errors: number }[];
  stores: { tenantId: string; name: string; slug: string; storeKind: string; mode: 'own' | 'platform'; paused: boolean; image: number; text: number; other: number; calls: number; errors: number; blocked: number }[];
};
export type AbuseAlert = {
  id: string; at: number; tenantId: string; rule: string; severity: 'medium' | 'high' | 'critical'; title: string; action: string; status: 'open' | 'resolved';
  emailedAt: number | null; emailError: string; resolvedAt: number | null; store: string; slug: string; storeKind: string;
  detail: { store: string; slug: string; storeKind: string; mode: 'own' | 'platform'; kind: ApiKind; value: number; limit: number; windowMin: number };
};
export type AbuseSettings = {
  enabled: boolean; email: string; autoPause: boolean; cooldownMin: number; burst: Record<ApiKind, number>; demoBurst: number; daily: Record<ApiKind, number>;
  spikeFactor: number; minSpike: number; failureRate: number; probe: number;
};
export type AlertConfig = { settings: AbuseSettings; recipient: string; transport: boolean; defaults: AbuseSettings };

export type MediaStorageKind = 'r2' | 'app';
export type MediaBucket = { files: number; bytes: number };
export type MediaMove = { status: 'idle' | 'running' | 'done' | 'cancelled'; target?: MediaStorageKind; total?: number; done?: number; failed?: number; movedBytes?: number; bytes?: number; lastError?: string };
export type MediaOverview = {
  storage: {
    current: string; deployDefault: string; r2: { available: boolean }; database: { available: boolean };
    app: { available: boolean; writable?: boolean; root?: string; freeBytes?: number | null; persistent?: boolean | null; platform?: string; customDir?: boolean };
  };
  totals: { r2: MediaBucket; app: MediaBucket; database: MediaBucket };
  oldCopies: { files: number; bytes: number; oldestAt: number | null; cleanableAt: number | null; cleanable: boolean };
  move: MediaMove;
  stores: { id: string; slug: string; name: string; kind: 'default' | 'instance' | 'demo'; status: string; files: number; bytes: number }[];
};

/** Keys the backend holds outside the API manager (host variables, store administrators' own keys). Never carries a key, only its last four characters. */
export type FoundKeys = {
  env: { kind: ApiKind; provider: string; label: string; variable: string; hint: string; added: boolean }[];
  stores: { tenantId: string; store: string; slug: string; storeKind: string; kind: ApiKind; provider: string; label: string; hint: string; added: boolean }[];
};

export type MediaOwner = { id: string; name: string; slug?: string; kind: string };
/** One stored file of the whole platform (a hash), however many stores / demos / themes hold a row for it. */
export type MediaFile = {
  id: string; mime: string; kind: 'image' | 'video' | 'audio'; size: number; bytes: number; copies: number; storage: string; createdAt: number; title: string;
  inLibrary: boolean; used: boolean; inClientData: boolean; legacy: boolean; owners: MediaOwner[]; usedBy: MediaOwner[]; preview: string;
};
export type MediaFiles = {
  items: MediaFile[]; total: number; more: boolean;
  totals: { files: number; bytes: number; unused: MediaBucket; duplicates: MediaBucket; legacy: MediaBucket };
  owners: MediaOwner[];
};
export type MediaAudit = {
  at: number; rows: number; healthy: boolean;
  storages: Record<'r2' | 'fs', { available: boolean; checked: boolean; error: string; objects: number; bytes: number }>;
  missing: { files: number }; wrongStorage: { files: number }; strayPrefix: { files: number };
  legacy: { files: number; bytes: number; reclaimFiles: number; reclaimBytes: number };
  sizeMismatch: { files: number }; sizeUnknown: { files: number };
  orphans: { files: number; bytes: number; deletable: number; deletableBytes: number; recent: number };
  inDatabase: MediaBucket;
  samples: { missing: AuditLine[]; wrongStorage: AuditLine[]; strayPrefix: AuditLine[]; legacy: AuditLine[]; sizeMismatch: AuditLine[]; orphans: { key: string; storage: string; size: number; recent: boolean; store: string }[] };
};
export type AuditLine = { id: string; store: string; storage: string; key: string; size: number | null };
export type MediaRepair = { sizes: number; repointed: number; copied: number; migrated: number; orphansDeleted: number; orphanBytes: number; brokenRemoved: number; failed: number; skipped: number; remaining: number; partial: boolean };
