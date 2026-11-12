export type Tenant = {
  id: string; slug: string; name: string; kind: 'default' | 'instance' | 'demo'; status: 'active' | 'trial' | 'suspended'; plan: string; ownerEmail: string;
  sourceDemoId: string | null; notes: string; createdAt: number; path: string; adminPath: string;
  /** Credits the store may spend (null = unlimited), credits spent so far, and who holds the AI keys: 'own' (the store) or 'platform' (API manager). */
  creditLimit: number | null; creditsUsed: number; apiMode: 'own' | 'platform'; apiLinks: Partial<Record<ApiKind, string>>;
  counts?: { clients: number; requests: number; admins: number; domains: number };
};
export type TenantAdmin = { id: string; username: string; name: string; email: string; disabled: boolean; hasPassword: boolean; lastLoginAt: number | null; createdAt: number };
export type NewAdmin = { id: string; username: string; email: string; password: string | null };
export type Demo = { id: string; name: string; description: string; status: 'draft' | 'published'; tenantId: string; slug: string; version: number; assignments: number; path: string; adminPath: string; createdAt: number; creditLimit: number | null; creditsUsed: number };
export type Assignment = { id: string; tenantId: string; slug: string | null; name: string | null; status: string | null; ownerEmail: string; demoVersion: number; createdAt: number; path: string; adminPath: string };
export type Domain = { domain: string; verified: boolean; txtName: string; txtValue: string };
export type AuditRow = { id: string; at: number; actor: string; action: string; tenantId: string | null; target: string; detail: string };
export type Stats = { tenants: number; active: number; suspended: number; demos: number; assignments: number; themes: number; clients: number; apis: number; creditsUsed: number; platformManaged: number };
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
