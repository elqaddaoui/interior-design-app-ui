# Multi-tenant SaaS plan

Status: approved by the owner to implement. Phases 1-6 are implemented (data layer, identity, routing/domains, super admin, demos/ownership, hardening with leak tests) and covered by `npm run test:server` plus `npm run check:saas:browser`. Remaining: a tenant-side screen for change requests (API exists), see Q-list.
Scope: turn the single-admin Dwira app into a multi-tenant SaaS **without a rewrite**. The app as it runs today keeps working
unchanged as the **default tenant** (`id = 'default'`), at the root of the current domain, with all existing data.

## 0. Findings that shaped the plan

| Finding | Consequence |
| --- | --- |
| ~180 SQL statements over 18 tables in `server/*.js`; `createBackend()` builds one module set (`clients`, `content`, `sync`, `admins`, `notifier`, `campaigns`, `imagegen`, `chat`, `assistant`, `media`) around one `db`. | Build **one module set per tenant**, each around a *tenant-bound* `db`. Route code in `server/index.js` stays almost untouched (it only gets its module names from the tenant bundle). |
| Several primary keys are global but their values are client-chosen or derived (`space.id`, `claims.id`, `guest_chats.id`, `content_items(coll,id)`, `settings.key`, `sync_state.key`, `admin_accounts.admin_id = 'admin'`, `subscriptions.id`, `media.id` = content hash). | These become composite `(tenant_id, …)` keys; otherwise tenant B could collide with, overwrite or read tenant A's rows. |
| Admin `admin / admin` and `ADMIN_EMAIL` credentials are built in. | They must only ever open the **default** tenant. A new tenant has no built-in credentials. |
| Web client keeps `dwira:v1:*` in localStorage (incl. the public **content cache**, the device token, the admin-session flag). | Same origin (`app.com`) is shared by all slugs, so keys are namespaced per tenant (the default tenant keeps the old keys, so nothing is lost). |
| Cookies are `Path=/api`. | Tenant cookies are scoped to `Path=/{slug}/api`; the server also checks the session row's `tenant_id`, so a stolen token is useless on another tenant. |
| Expo Router reads `process.env.EXPO_BASE_URL` at call time, but Babel inlines it at build time. | A tiny Babel plugin replaces that one expression with a runtime value (`window.__DWIRA_BASE__`), set by the HTML shell from the URL. Expo Router then adds/strips `/{slug}` itself for links, `router.push`, back/forward and reloads. No route is duplicated. |
| Web push uses one service worker per origin and `PushManager.subscribe` needs one VAPID key per origin. | One **platform** VAPID key pair (the one default-tenant subscribers already use). Subscription **rows** are tenant-scoped. |
| `origin/genspark_ai_developer` (unmerged, not on `main`) contains a different Super Admin (`/superadmin`, `sa_tenants` = organisations that group admins, default `superadmin/superadmin` password). The commit message also says generic table names (`tenants`, `audit_log`, `admin_roles`) **already exist with another shape in the shared Neon database**. | New tables are all prefixed `saas_` and never reuse a generic name. This work does not merge that branch (see open questions Q1). |
| Dev box has 1 GB RAM: `tsc` needs `NODE_OPTIONS=--max-old-space-size=3072`; a full Metro web export works here (about 2 minutes, run it detached) but needs the memory to itself. | Client routing/domain code is kept small, pure and unit-tested (Babel plugin test, path helpers); the web export and `scripts/check-saas-browser.js` run here and in CI/Vercel. |

## 1. Schema

All tenant-owned tables get `tenant_id TEXT NOT NULL`:

`clients, user_sessions, claims, space, admin_sessions, requests, subscriptions, outbox, settings, content_items, content_docs,
admin_prefs, sync_state, media, guest_chats, campaigns, campaign_deliveries, admin_accounts`.

Primary / unique keys that change (everything else keeps its key; ids that are server-generated UUIDs stay globally unique):

| Table | New key |
| --- | --- |
| `clients` | `UNIQUE (tenant_id, phone)` (was `UNIQUE (phone)`) |
| `claims`, `space`, `guest_chats` | `PRIMARY KEY (tenant_id, id)` |
| `content_items` | `(tenant_id, coll, id)` |
| `content_docs` | `(tenant_id, name)` |
| `settings`, `sync_state` | `(tenant_id, key)` |
| `admin_accounts`, `admin_prefs` | `(tenant_id, admin_id)` |
| `subscriptions`, `media`, `outbox` | `(tenant_id, id / request_id)` |

`user_sessions`, `admin_sessions` keep `token_hash` as key (a hash of 32 random bytes) **and** carry `tenant_id`; every lookup checks both.
Indexes that start with a tenant-owned column gain `tenant_id` as the first column where it matters (`requests`, `space`, `campaigns`).

New global (platform) tables, all `saas_`-prefixed:

```
saas_tenants   (id PK, slug UNIQUE, name, kind 'default'|'instance'|'demo', status 'active'|'trial'|'suspended',
                plan, owner_email, source_demo_id, source_demo_version, notes, created_at, updated_at, suspended_at)
saas_domains   (domain PK, tenant_id, token, verified_at, created_at)          -- custom domains, one tenant each
saas_super     (id PK, email UNIQUE, name, pw_hash, disabled, created_at, last_login_at)
saas_super_sessions (token_hash PK, super_id, expires_at, created_at, ua)
saas_demos     (id PK, name, description, tenant_id UNIQUE -> its template tenant, status 'draft'|'published', created_at, updated_at)
saas_assignments (id PK, demo_id, tenant_id UNIQUE -> the new instance, owner_email, demo_version, created_at, created_by)
saas_requests  (id PK, tenant_id, admin_id, kind, title, body, status, response, created_at, updated_at)
saas_kv        (key PK, value)                                                -- platform settings
saas_audit     (id PK, at, actor, action, tenant_id, target, detail)
```

### Tenant-bound database (the isolation mechanism)

`scopeDb(db, tenantId)` returns `{ tenantId, query, tx }`. SQL in tenant modules is written with the token `:tenant`
(`WHERE tenant_id=:tenant AND id=$1`); the wrapper appends the tenant id as the last bind parameter and rewrites `:tenant` to its `$n`.
**Fail closed:** the wrapper counts references to tenant-owned tables (`FROM|JOIN|INTO|UPDATE <table>`) and throws `TENANT_SCOPE_MISSING`
unless the statement contains at least as many `:tenant` tokens. A forgotten filter therefore cannot reach production silently; it fails the
first test that runs it. The unscoped `db` is only used by the migration, the tenant resolver, the super admin, and the background sweep
that *discovers* which tenants have due work.

## 2. Tenant resolution

Order, first match wins (`server/tenants.js`, called at the top of `handle`, before any other work):

1. **Custom domain**: `Host` header exactly equals a verified row of `saas_domains` → that tenant, path unchanged
   (`brand.com/` = storefront, `brand.com/admin` = admin, `brand.com/api/*` = its API).
2. **Platform host** (`PLATFORM_HOSTS`, comma list; default: any host that is not a custom domain, which covers localhost and Vercel previews):
   - first path segment is `super-admin`, `api`, or any reserved/route name → the **default tenant** (today's behaviour, unchanged);
   - otherwise the first segment is a **slug**: `/{slug}/…` → that tenant, and the prefix is stripped before routing
     (`/acme/admin` → `/admin`, `/acme/api/content` → `/api/content`). Unknown slug → 404 `TENANT_NOT_FOUND`.
3. **Native apps** (header `X-Dwira-Native: 1`) may send `X-Dwira-Tenant: <slug>` on the platform host.
4. A tenant that is `suspended` answers `403 TENANT_SUSPENDED` on every API route and a plain 503 page for HTML. Nothing leaks about its data.

Resolution results are cached 15 s in memory and dropped immediately on any tenant/domain write made by this process.
`/api/super-admin/*` is only served on a platform host, never under a slug and never on a custom domain.

**Reserved slugs** (`src/lib/reservedSlugs.js`, shared by server and client): every top-level route in `src/app`
(`admin, assistant, chat, explore, history, lead, lead-success, login, pro, render, result, settings, tool, …`), infrastructure paths
(`api, _expo, assets, icons, push-sw.js, manifest.webmanifest, favicon.ico, index, _sitemap, health`), the super admin (`super-admin`, `superadmin`),
and common words (`www, app, demo, demos, docs, help, status, support, …`). A test fails if a new top-level route is added to `src/app` and not reserved.
Format: `^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$` (3-40 chars), unique, immutable-by-default (renaming is a super-admin action and keeps the old slug reserved for 30 days: see Q6).

**Custom domains.** A tenant admin (or the super admin) sets `brand.com`; the row is created *unverified* with a token. The domain becomes active
only after the TXT record `_dwira-verify.brand.com = <token>` is found (`POST /api/admin/domain/verify`, or the super admin marks it verified).
Platform hosts, IPs, `localhost`, other tenants' domains and domains ending in a platform host are rejected. Attaching the domain to Vercel / Hostinger is manual (see `docs/HOSTINGER.md` additions).

### Client side

- `window.__DWIRA_BASE__` (`'acme'` or `''`) is set by the HTML shell before any JS from `location.pathname` and the reserved list.
- Babel plugin (`scripts/babel-tenant-base.js`, registered in `babel.config.js`) rewrites `process.env.EXPO_BASE_URL` to that value.
- `src/lib/tenant.ts`: `tenantBase()`, `withBase(path)`, `stripBase(path)`, `storageKey()`; `backend.ts` uses `${base}/api`; `route.ts` strips the base; `storage.ts` namespaces keys; the shell's early `fetch` and `localStorage` reads use the same prefix.
- `vercel.json` gets one extra rewrite so `/{slug}/api/*` reaches the function; the Node server resolves everything itself.

## 3. Migration (existing data becomes the default tenant)

`SCHEMA_MT` runs after the existing `SCHEMA`, under its own version marker (`schema_mt_version`), in one pass, idempotent, and **fatal on failure**
(unlike an add-on, a half-applied tenancy must stop the server rather than serve mixed data):

1. create the `saas_*` tables; insert the `default` tenant (`slug = 'default'`, kind `default`);
2. for each owned table: `ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default'`: every existing row is now the default tenant's;
3. in a `DO` block, drop the old PK/unique constraint **if it still has its old shape** and create the composite one (re-running is a no-op);
4. composite indexes.

Expand/contract: the `DEFAULT 'default'` is **kept for one release** so an old instance still running during a Vercel rollout keeps inserting (into the default tenant, which is exactly what the old app means).
New code never relies on it (the wrapper requires `:tenant`). Dropping the default is a follow-up one-liner (Q5). The platform VAPID pair is read from the default tenant's existing `settings.vapid` row, so
existing push subscribers keep working. R2 objects of the default tenant keep their keys (`media/<hash>.<ext>`); other tenants use `t/<tenantId>/media/<hash>.<ext>`.
A rollback is safe: the old code ignores the extra column and the extra tables (it would only fail on `clients.phone` conflicts if it relied on the dropped unique constraint: it does not rely on it for correctness, only for its `ON CONFLICT (phone)`; hence the rollback note in risks).

## 4. Identity and sessions

- **Tenant admins**: `admin_accounts (tenant_id, admin_id)`; login is `POST {base}/api/admin/login` resolved to a tenant first, then verified inside it. Built-in `admin/admin` and `ADMIN_EMAIL` only match when `tenant.id === 'default'`. Accounts created by the super admin store a scrypt hash, never a default password.
- **Sessions** (admin, client, device/guest, super admin) carry `tenant_id`; auth queries include it. Cookies are `HttpOnly; SameSite=Strict; Path=/{slug}/api` (`Path=/api` for the default tenant and custom domains). The same token presented to another tenant is rejected.
- **Super admin**: separate table, separate cookie `dwira_super` (`Path=/api`), separate header `X-Super-Token`, 12 h sessions, 5 failed logins / 15 min lock per address. **No built-in password**: it is configured with `SUPERADMIN_EMAIL` + `SUPERADMIN_PASSWORD_HASH` (same scrypt tool as `ADMIN_PASSWORD_HASH`); without them `/api/super-admin/login` answers `503 SUPERADMIN_NOT_CONFIGURED`. A tenant session never opens the super-admin API and vice versa.
- **Isolation of everything else**: content/ETag/CDN (`content:<tenant>:p:<version>`, URL differs per slug/host), media (rows tenant-scoped, in-memory caches per tenant module set, R2 key prefix), sync versions (`sync_state` per tenant; per-tenant `createSync` cache), push (tenant-scoped rows, tenant base in notification URLs, service worker accepts the `/{slug}` prefix), campaigns/outbox/background timers (iterate tenants that have due work, one tenant at a time with its own scoped modules), settings/AI keys/prompt rules/automations (per tenant), rate limits (bucket key includes the tenant).

## 5. Super admin and style isolation

Routes: UI `/super-admin` (login) and `/super-admin/{tenants,demos,requests,audit}`; API `/api/super-admin/*`.
Capabilities: create / edit / suspend / unsuspend / delete tenants (delete needs the slug typed back), create / edit / disable / reset-password / delete tenant admins, manage domains, manage demos and assignments, answer change requests, read the audit log and platform stats.

**Style isolation is structural, not a convention:**

1. All Super Admin UI lives under `src/superadmin/` and `src/app/super-admin/`. Its colours, spacing, radii and type scale are **constants in `src/superadmin/tokens.ts`**, applied with plain `StyleSheet` styles. It does not use NativeWind classes (those resolve against tenant theme CSS variables), `ThemeProvider`/`useTheme`, `useStore`, tenant branding, tenant fonts or tenant translations (English strings, hard-coded).
2. `scripts/check-superadmin-isolation.js` (part of `npm run test:server`) fails when a file under those folders imports `@/theme`, `@/store/useStore`, `@/data/mock/seed`, `@/i18n`, `@/components/ui/*` (which are themed), uses `className`, or reads `doc.theme` / `doc.branding`.
3. The tenant theme provider is skipped on `/super-admin` (it must not paint the page background), and tenant content is not fetched there.
4. Server side the Super Admin never stores any style in tenant tables, and no tenant API can write to a `saas_*` table (the scoped wrapper only knows owned tables; the super-admin module is the only code that touches `saas_*`).

## 6. Demos and ownership model

```
 saas_demos ──(template tenant, kind 'demo')           Super Admin edits it freely; tenants never see it unless published
      │
      │  assign(demoId, owner)            ← one deep copy, in one transaction
      ▼
 tenant instance (kind 'instance', own slug, own tenant_id)  ◄── saas_assignments (demo_id, tenant_id, owner_email, demo_version)
```

- **Demo** = a template tenant (kind `demo`, slug like `demo-boutique`) with a storefront (`/{slug}`), an admin dashboard (`/{slug}/admin`, opened with the generated demo admin credentials shown once) and **sample data**: the starter content, settings documents and media, plus a few sample clients and requests so the dashboard is not empty. Status `draft | published`; only the super admin sees demos in this version.
- **Assignment** picks a demo and an owner (an existing tenant admin by `tenantId + adminId`, or a new one by e-mail) and creates a **new tenant** whose data is a **by-value copy** of the template taken inside one transaction: `content_items`, `content_docs`, `media` (rows; R2 objects are immutable and content-addressed, so sharing the object is not sharing state), allow-listed `settings` keys (never AI/provider keys, VAPID, counters, rotation cursor), and sample `clients`/`requests` re-keyed with new ids. Excluded: sessions, subscriptions, outbox, campaigns, chats, admin accounts (the owner gets their own account, copying name/e-mail/password hash if they already had one elsewhere), admin prefs.
- **Independence guarantees**: no foreign key, reference or shared row between template and instance; the instance has its own `tenant_id`, sync counters, content version, ETags and caches; all writes go through tenant-bound modules, so an instance edit can only touch its own `tenant_id`. Editing the template afterwards does not change existing instances (recorded `demo_version` is informational). Two assignments of the same demo are two unrelated tenants. Deleting an instance does not touch the demo, and deleting a demo does not delete its instances (the assignment row just keeps `demo_id` for history).
- **Change requests**: the instance's admin submits `POST {base}/api/admin/change-requests { kind: 'customize'|'manage'|'support', title, body }`. The row's `tenant_id` comes from the session, never from the body. They see only their tenant's requests and the super admin's responses.
  The super admin lists requests across tenants, sets status (`open → in_progress → done|rejected`), replies, and can **apply** a change to the request's tenant: `POST /api/super-admin/requests/:id/apply { docs?, items? }` is executed with the tenant modules of `request.tenant_id` (loaded from the row, not from the payload), refused for a tenant of kind `demo`, and audited. There is deliberately no endpoint that applies a request to a demo or to another tenant.

## 7. Phases (each ends with lint, typecheck, `test:server`, and a commit)

1. **Data layer**: `SCHEMA_MT`, migration, `scopeDb`, every module moved to `:tenant` SQL, per-tenant module sets, default tenant behaves exactly as before.
2. **Identity**: tenant-aware auth, built-ins only for default, super-admin accounts/sessions, per-tenant VAPID/R2 prefix.
3. **Routing & domains**: resolver, reserved slugs, slug/host/native resolution, domain verification, client base-path plumbing (Babel plugin, shell, storage, SW), Vercel rewrite, static server.
4. **Super admin**: API + hard-coded design system UI, audit log.
5. **Demos & ownership**: demos, assignment clone, change requests, apply.
6. **Hardening**: cross-tenant leak test matrix (every route family × tenant A/B), static scope lint, isolation lint, docs.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| A query forgets its tenant filter. | Fail-closed wrapper (`TENANT_SCOPE_MISSING`), cross-tenant test matrix, and the raw `db` is never handed to a tenant module. |
| Migration on a large live database locks tables. | `ADD COLUMN … DEFAULT <constant>` is metadata-only on Postgres 11+; PK swaps run once and are idempotent; use `DATABASE_URL_UNPOOLED` for DDL as today. |
| Rollout window: old instance + new schema. | `DEFAULT 'default'` kept for one release (expand/contract). |
| Rollback after tenants exist. | Old code would see every tenant's rows as one app. Take a backup before the first non-default tenant is created; documented in the runbook. |
| A tenant's slug shadows a future route. | Shared reserved list + test over `src/app`. |
| Cookie / localStorage bleed on one origin. | Path-scoped cookies + `tenant_id` on sessions; namespaced storage keys; per-URL cache keys. |
| Custom-domain squatting. | TXT verification, reserved platform hosts, one tenant per domain. |
| Manifest / PWA install is per origin. | `manifest.webmanifest` stays generic in this version (Q7). |
| In-memory caches grow with tenant count. | Tenant bundles live in a bounded LRU (default 100) and are rebuilt on demand. |
| Background work for many tenants. | One sweep discovers tenants with due outbox/campaign rows with a single query; each is processed with its own scoped modules and a time budget. |
| Shared R2 object between tenants with identical bytes. | Non-default tenants use a tenant key prefix; the default keeps old keys. Deleting a tenant removes its prefix objects in a later job (Q8). |
| Not verified here: full web export and a real browser run (1 GB sandbox). | The routing glue is small and unit-tested; run `npm run build:web` + the browser checks in CI/Vercel before releasing. |

## 9. Open questions (recommended default is what is implemented)

| # | Question | Recommended default |
| --- | --- | --- |
| Q1 | The unmerged branch `genspark_ai_developer` has a different Super Admin (`/superadmin`, roles, `sa_tenants` organisations). | Do **not** merge it onto this work. Keep `saas_*` tables; reserve `superadmin` and redirect it to `/super-admin`. Port its role/permission ideas later on top of `saas_super`. |
| Q2 | Can one person own several tenants? | Yes, as separate accounts (same e-mail, independent password/sessions) linked by `owner_email`. No cross-tenant login. |
| Q3 | Super-admin login bootstrap. | No built-in password; `SUPERADMIN_EMAIL` + `SUPERADMIN_PASSWORD_HASH` required. |
| Q4 | Can the super admin "log in as" a tenant admin? | No impersonation. Support work uses the audited `apply` endpoint. |
| Q5 | When to drop `DEFAULT 'default'` on `tenant_id`? | One release after rollout (`MT_DROP_TENANT_DEFAULT=true` runs it). |
| Q6 | Slug rename. | Allowed for the super admin only, old slug stays reserved 30 days. (Implemented as: rename allowed, old slug kept in `saas_kv` reserved list.) |
| Q7 | Per-tenant PWA manifest / icons. | Later; generic manifest now. |
| Q8 | Tenant deletion and R2 objects. | Rows deleted immediately; R2 prefix purge is a manual script for now. |
| Q9 | Billing / plans. | `plan` is a label only; no enforcement or payments in this version. |
| Q10 | Are demos visible to tenants (a catalogue)? | No: super-admin only; tenants receive instances. Status `published` is reserved for a future catalogue. |
| Q11 | Per-tenant AI keys. | Yes: each tenant pastes its own; environment keys (`POLLINATIONS_API_KEY` …) are shared platform fallbacks. |
| Q12 | Tenant limits (rows, storage, requests/min). | Per-tenant rate-limit buckets only; quotas later. |

## Console v2: stores, demos, credits and API manager

- **Flow**: Demo (template) -> Store (one sheet: name, address, optional demo, first administrator, credit limit, API mode) -> more administrators later. Creating a store from a demo is ONE request (`POST /demos/:id/assign` with `owner`, `creditLimit`, `apiMode`).
- **Administrators**: several per store; sign in with a user name or an e-mail (both optional, a store may have neither e-mail). `admin_id` = username || email || 'admin'.
- **Credits**: `saas_tenants.credit_limit` (NULL = unlimited) and `credits_used`; one atomic UPDATE per AI generation; refunded when the generation fails; 402 `STORE_CREDITS_EXHAUSTED` when spent.
- **API manager** (`saas_apis`, super admin only): image / text / other connections; keys are write-only (only `keyHint` is returned). A store with `api_mode='platform'` ignores its own keys and uses the shared default or its linked connection; key routes answer 403 `API_MANAGED_BY_PLATFORM`.
- **Support page** (`/admin/support`): the store administrator sees credits left, who manages the AI keys, and sends requests (support, credits, api, customize) to the super admin, with replies.
- **Speed**: demo/seed creation uses bulk multi-row INSERTs (under 40 statements, covered by `scripts/check-platform-server.js`).
