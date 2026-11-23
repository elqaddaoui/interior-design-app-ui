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
export type Stats = { tenants: number; active: number; suspended: number; demos: number; assignments: number; themes: number; clients: number; apis: number; creditsUsed: number; platformManaged: number; alerts: number; calls24h: number; demosAiOn: number; limits?: LimitsSummary | null };
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
  resolvedAt: number | null; store: string; slug: string; storeKind: string;
  detail: { store: string; slug: string; storeKind: string; mode: 'own' | 'platform'; kind: ApiKind; value: number; limit: number; windowMin: number };
};
export type AbuseSettings = {
  enabled: boolean; autoPause: boolean; cooldownMin: number; burst: Record<ApiKind, number>; demoBurst: number; daily: Record<ApiKind, number>;
  spikeFactor: number; minSpike: number; failureRate: number; probe: number;
};
export type AlertConfig = { settings: AbuseSettings; defaults: AbuseSettings };

/** The notification centre: the server stores a code and numbers, the console writes the sentence in the owner's language. */
export type NoticeKind = 'limits' | 'backup' | 'api' | 'system';
export type NoticeSeverity = 'info' | 'ok' | 'warn' | 'danger';
export type Notice = { id: string; at: number; kind: NoticeKind; severity: NoticeSeverity; code: string; params: Record<string, string | number | boolean>; href: string; read: boolean };
export type NoticeList = { notices: Notice[]; unread: number };

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

/** What is hosted, grouped as the Files manager shows it. */
export type MediaType = 'image' | 'video' | 'audio' | 'other';
export type MediaTypeFilter = MediaType | 'all';
/** One hosted file, read from the storage (any path) or from the rows of one owner. `inMedia` = sits in `media/`; `stray` = in an old `t/<store>/media/` folder. */
export type MediaItem = {
  key: string; name: string; id: string; type: MediaType; folder: string; inMedia: boolean; size: number; modified: number; mime: string; stray: boolean;
  inDatabase: boolean; title: string; stores: string[]; storeCount: number; storage: string; url: string;
};
export type MediaFiles = { view: 'type' | 'owner'; storage: 'r2' | 'app' | 'database'; items: MediaItem[]; more: boolean; cursor: string };
export type MediaSummary = { storage: 'r2' | 'app' | 'database'; at: number; complete: boolean; scanned: number; types: Record<MediaType, { files: number; bytes: number; inMedia: number; outside: number }> };
export type MediaOwner = { id: string; name: string; slug: string; files: number; bytes: number; main?: boolean };
export type MediaOwners = { groups: { store: MediaOwner[]; demo: MediaOwner[]; theme: MediaOwner[]; other: MediaOwner[] }; types: Record<MediaType, number> };
/** One restore point: what the hosting looked like before an operation. */
export type MediaHistoryEntry = {
  id: string; at: number; op: 'consolidate' | 'move' | 'restore' | 'cleanup'; label: string; actor: string; files: number; bytes: number; restoredAt: number | null;
  stats: Record<string, any>; restorable: boolean; changed: number;
};
export type MediaRestoreResult = { restored: number; conflicts: number; failed: number; bytes: number; left: number; partial: boolean; cursor: [string, string]; backup: string; done: boolean };
export type ConsolidationAction = 'move' | 'merge' | 'conflict';
export type Consolidation = {
  at: number; clean: boolean;
  storages: Record<'r2' | 'fs', { available: boolean; checked: boolean; error: string; media: MediaBucket; outside: number }>;
  database: { files: number; bytes: number; target: '' | 'r2' | 'app' };
  folders: { storage: 'r2' | 'fs'; path: string; store: string; files: number; bytes: number }[];
  files: { storage: 'r2' | 'fs' | 'db'; from: string; to: string; size: number; action: ConsolidationAction; store: string }[];
  totals: { files: number; bytes: number; move: number; merge: number; conflict: number };
  rows: { checked: number; missing: number; samples: { id: string; store: string; storage: string; key: string }[] };
};
export type ConsolidateResult = { moved: number; merged: number; waiting: number; bytes: number; conflicts: number; failed: number; rowsFixed: number; dbMoved: number; dbFailed: number; unreadable: string[]; remaining: number; partial: boolean; history: string };

export type LimitLevel = 'ok' | 'warn' | 'urgent' | 'critical';
export type LimitsSummary = { at: number; level: LimitLevel; worst: { id: string; pct: number; level: LimitLevel } | null };
export type LimitMetric = {
  id: string; service: 'neon' | 'cloudflare'; unit: 'bytes' | 'hours' | 'count'; effect: string; blocksBackup: boolean;
  used: number | null; limit: number; limitSource: 'plan' | 'api' | 'custom'; status: 'ok' | 'needs_setup' | 'error'; error: string; needs: string[];
  source: 'measured' | 'neon' | 'cloudflare' | 'estimate'; resetsAt: number | null; periodStart: number | null; backupCost: number | null;
  pct: number | null; level: LimitLevel; reasons: string[]; exceeded: boolean;
  projection: { at: number; days: number } | null; reserve: { need: number; left: number } | null;
};
export type LimitServiceState = { state: 'on' | 'off' | 'not_used'; error?: string; provider?: string; api?: boolean; r2?: boolean; dbBytes?: number | null };
export type BackupTarget = 'auto' | 'vault' | 'gdrive' | 'dropbox';
export type LimitSettings = {
  enabled: boolean; autoBackup: boolean; autoBackupAt: number; autoBackupTo: BackupTarget; warnAt: number; urgentAt: number; criticalAt: number; forecastDays: number; reminderHours: number;
  services: { neon: boolean; cloudflare: boolean }; limits: Record<string, number>;
};
export type LimitsStatus = {
  at: number; level: LimitLevel; metrics: LimitMetric[]; services: { neon?: LimitServiceState; cloudflare?: LimitServiceState };
  settings: LimitSettings; defaults: LimitSettings; planLimits: Record<string, number>;
  destinations: { gdrive: boolean; dropbox: boolean }; keys: { neonApi: boolean; cloudflareApi: boolean };
  lastBackupAt: number | null; backupHost: boolean;
  autoBackup?: { status: 'running' | 'done' | 'error'; at: number; finishedAt?: number; ids?: string[]; destination?: string; name?: string; error?: string; lastOkAt?: number; retryAt?: number } | null;
};
export type BackupLogLine = { n: number; at: number; level: 'info' | 'warn' | 'error'; code: string; step?: string; [key: string]: unknown };
export type BackupStep = { key: string; status: 'pending' | 'running' | 'done' | 'error' | 'skipped'; detail?: Record<string, unknown> };
export type BackupJob = {
  id: string; kind: string; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'; progress: number; errors: { code?: string; message?: string }[]; warnings: ({ code: string } & Record<string, unknown>)[];
  canDownload: boolean; result: { name?: string; size?: number; uploadId?: string; plan?: RestorePlan; restartRequired?: boolean } | null; options: { destination: string; upload?: string; kind?: string; version?: string; name?: string };
  steps: BackupStep[]; log: BackupLogLine[]; startedAt: number | null; finishedAt: number | null; cancelling: boolean;
};
export type VaultKind = 'all' | 'db' | 'code' | 'media';
export type VaultItem = {
  id: string; kind: VaultKind; version: string; name: string; createdAt: number; createdBy: 'manual' | 'schedule' | 'pre-restore' | 'limit'; size: number; plainSize?: number;
  sha256: string; encrypted: boolean; includes: { app?: boolean; db?: boolean; media?: boolean }; rows: number | null; tables: number | null; mediaFiles: number; appFiles: number;
  schemaVersion: string; preview: { type: string; source: string } | null;
};
export type BackupSettings = { enabled: boolean; kinds: VaultKind[]; hour: 'auto' | number; retentionDays: number };
export type BackupSchedule = {
  settings: BackupSettings; hour: number; auto: boolean; learned: number; profile: (number | null)[]; next: number; last: { at: number; ok?: boolean; kinds?: string[]; error?: string } | null; busy: boolean; available: boolean;
};
export type VaultInfo = { kind: 'r2' | 'disk'; encrypted: boolean; version: string; items: VaultItem[]; schedule: BackupSchedule };
export type RestorePlan = {
  manifest: { createdAt: number; appVersion?: string; kind?: string; includes: { app?: boolean; db?: boolean; media?: boolean } };
  restorable: { app: boolean; db: boolean; media: boolean }; mediaTargets: { r2?: boolean; app?: boolean }; defaultMediaTarget: 'r2' | 'app';
  willReplace: Record<string, number>; warnings: ({ code: string } & Record<string, unknown>)[];
};
export type BackupCaps = { available: boolean; reason: string; destinations: Record<string, boolean | { serverConfigured: boolean }>; running: string | null };
