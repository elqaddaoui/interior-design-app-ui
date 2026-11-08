# Dwira performance audit (branch `perf/audit`)

Status: **Phase 0 (baseline) and most of Phase 1 (evidence gathering) are done. Phase 3 (Tier-1 fixes) and Phase 4 (after-measurements) are NOT done.**
No application code was changed on this branch. Every number below was measured here, in a 1 GB sandbox; anything not measured is marked **UNMEASURED**.

## 1. Baseline (commit 77a8def)

| Check | Result |
|---|---|
| `tsc --noEmit` | pass (20 s) |
| `expo lint` | 0 errors, 33 warnings (pre-existing) |
| `npm run test:server` | 126 tests: 124 pass, 1 skipped, **1 fail**: `check-node-hosting.js` "start.js: one process serves /api/health..." failed with `fetch failed` during the full run (CPU-starved sandbox). Re-run alone: **16/16 pass**. Treated as environmental, not a regression. |

### Web, cold load (Slow-4G 1.6 Mbit/150 ms + 4x CPU, 390x844, images blocked, 3 runs, `scripts/measure-lcp.js`)
Served by `server/static.js` (same headers and brotli as prod) with the real `/api/content` + `/api/sync` bodies replayed (no DB; the full Node+PGlite server plus Chromium froze this sandbox twice, so it was not used for the final run).

| Metric | Value |
|---|---|
| LCP (median, range) | **5696 ms** (5572 - 6256), LCP element = DIV (Home tool card), target <= 2500 |
| FCP | 744 ms |
| CLS | 0 |
| Transferred / JS / requests / API calls | 1,588,765 B / 679,692 B JS / 46 / 4 |
| INP, TBT, warm-cache LCP | **UNMEASURED** (needs a Lighthouse/Playwright trace; run `node scripts/measure-lcp.js <url> --runs=5 --cpu=4`) |

An earlier run against the real server returned 429s (API_RATE_LIMIT 300/15 min exhausted by repeated page loads from one IP) and is discarded.

### Bundle (`expo export -p web --dump-sourcemap`, byte attribution via `scripts/perf/modsize.js`)

| Chunk | raw | brotli | loaded |
|---|---|---|---|
| `__common` | 2,425,392 | 438,565 | blocking `<script>` |
| `entry` | 1,107,579 | 230,779 | blocking `<script>` |
| `index-2dd0...` (contains mediabunny) | 884,772 | 164,206 | idle **prefetch for every visitor** |
| `GestureKit` | 253,212 | 48,841 | idle prefetch |

Blocking JS on the critical path = **~669 KB brotli** (`__common` + `entry`) plus the preloaded root/tab/Home route chunks.

Heaviest modules (KB of generated code): mediabunny 838 (async chunk), react-native-reanimated 733, `src/i18n` locales 542, expo-router 411, react-native-web 283, `src/components` 223, react-native-gesture-handler 201, `src/lib` 201, react-dom 175, react-native-svg 46.

Server-only deps in the client bundle: `@aws-sdk`, `web-push`, `pg`, PGlite, `scryptSync`, `DATABASE_URL`, `ADMIN_PASSWORD_HASH`, `VAPID_PRIVATE`: **0 occurrences each** (good).

### API (local, PGlite in-process, n=150; **not representative of Neon/Vercel**)
| Endpoint | p50 | p95 |
|---|---|---|
| /api/health | 2.6 ms | 6.2 ms |
| /api/content | 3.4 ms | 9.3 ms |
| /api/content (304) | 1.2 ms | 3.4 ms |
| /api/sync | 1.0 ms | 3.0 ms |

`/api/content` body (seed data): 34,023 B raw, **6,911 B gzip**, 6,408 B br (target 50 KB gzip: met on seed data; production size UNMEASURED). Headers: `Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=300`, weak ETag `content:p:<version>`.
Production p50/p95, cold-start time and Vercel analytics: **no access from here**. Run: `vercel logs --since 24h` and Speed Insights, or `for i in $(seq 50); do curl -s -o /dev/null -w '%{time_total}\n' https://interior-design-app-ui-7rjz.vercel.app/api/sync; done | sort -n`.

### Function cold start (`scripts/perf/coldstart.js`)
`require('api/index.js')`: 51 - 71 ms, +15 MB RSS. `web-push` is required at the top of `server/notifications.js:2` and costs 22 - 35 ms of it. `@aws-sdk` is not loaded at startup (already lazy).

### Slowest DB queries
`scripts/perf/dbbench.js` (EXPLAIN ANALYZE on 10k clients / 50k requests, throw-away PGlite) was written but **did not complete**, so there are **no EXPLAIN numbers yet**. The index findings below come from reading the schema and queries only.

## 2. Findings (prioritised)

| ID | Area | Finding | Evidence | Expected gain | Risk | Effort | Tier |
|---|---|---|---|---|---|---|---|
| P1 | Bundle | `__common` + `entry` (669 KB br) block first render; LCP 5.7 s vs 2.5 s target. Reanimated (733 KB raw) and all i18n locales (542 KB raw) are in `__common`. | modsize output above; `src/i18n/index.ts:8-25` imports every namespace eagerly | Large, UNMEASURED until done | Med | M | 2 (touches startup and every screen) |
| P2 | Bundle | Idle prefetch list (`scripts/postexport.js`, `userChunks`) includes the mediabunny chunk (164 KB br) and GestureKit, fetched by every visitor although mediabunny is only used by the admin card-video renderer (`src/lib/cardVideoRender.web.ts:16,124,275`). Not on the critical path (prefetch, idle) but spends mobile data. | `user prefetch br KB 718`, chunk `index-2dd0` | -164 KB br of idle data per visitor; LCP unaffected | Low | S | **1** |
| P3 | i18n | Namespaces `camp, ax, st, ad, dx, menu, cr` have 0 non-admin users but ship in the main bundle. | grep of namespace use outside admin | up to ~300 KB raw off `__common` | Med | M | 2 |
| P4 | DB | No index on `claims(client_id)` or `subscriptions(owner_type, owner_id)`; `campaigns.js:171-174` runs 3 correlated subqueries per client over them (seq scans x clients) on every campaign tick/preview. | schema `server/db.js` (only PKs); query text | probably large at 10k clients; UNMEASURED | Low | S | **1** (`CREATE INDEX IF NOT EXISTS`) |
| P5 | DB | No index on `requests(user_id, created_at DESC)` (`index.js:354`, own history, unbounded), `user_sessions(client_id)` and `(expires_at)` (login purge `clients.js:34`, cascade deletes), `outbox(next_at)` (`index.js:327`, run on every Vercel poll). | schema | UNMEASURED | Low | S | **1** |
| P6 | DB | `adminConversations` parses `space.value::jsonb` for every conversation row to sort by `updatedAt` (`clients.js:82`); cost grows with total chat size. `space` rewrites the whole JSON document per message. | query text | UNMEASURED | Med | L | 2 (append-only `space` rows) |
| P7 | API | Unbounded `SELECT ... FROM clients ORDER BY created_at DESC` (`clients.js:147`) and own requests (`index.js:354`). | code | UNMEASURED | Low | S/M | 1 for LIMIT on requests only if the client UI already pages; otherwise 2 |
| P8 | Sync | On Vercel every poll runs the outbox query (`index.js:327`) and `campaigns.tick` -> `claimTick` does an INSERT .. ON CONFLICT plus an UPDATE on `settings` (`campaigns.js:373-376`), at most once per 10 s per instance. A write per 10 s keeps Neon awake: it will never autosuspend while any app is open. Cost per device-hour at 4 s polling = 900 function invocations (arithmetic, not measured). | code | Fewer invocations / compute | Med | M | 2 (changes sync protocol: push-driven invalidation, ETag/304 on /api/sync) |
| P9 | Sync (already done) | Web polling already slows to 15 s after 2 min idle and 30 s after 10 min, pauses when hidden or offline, polls immediately on focus/online (`src/lib/sync.ts`). Native keeps a fixed 4 s while foregrounded. | code + `check-node-hosting` test 8 | n/a | | | |
| P10 | State | 16 call sites use the whole store: `useStore()` (admin/requests x3, QuickView x2, FormModal x2, credits, interface, index, CrudScreen...). 95 narrow selector uses already exist. | grep | fewer admin re-renders; UNMEASURED | Low | S/M | 1 |
| P11 | Lists | Only chat views use FlatList. Home (`(tabs)/index.tsx:82`), history (`history.tsx:122`), admin requests (`requests.tsx:190`), CrudTable use `.map` (server pages requests via `LIMIT`, `index.js:692`). | grep | UNMEASURED | Med | M | 1 for memoised rows; virtualisation 2 |
| P12 | Cold start | Lazy-require `web-push` inside the notifier. | `notifications.js:2`, coldstart output | ~22-35 ms per cold start | Low | S | **1** |
| P13 | Media | `/api/media/<hash>` answers 302 to R2 with `max-age=86400` (`index.js:222`), i.e. one extra hop per image; bytes fallback has immutable 1-year cache. Returning the final R2/CDN URL changes the URL scheme. | code | one RTT per image | Med | M | 2 |
| P14 | Fonts | Only the icon font and one language font are preloaded (`postexport.js`); other woff2 files are fetched on demand. No FOIT finding. Icon font is already 19.7 KB. | dist listing | n/a | | | |
| P15 | DB pool | `pg.Pool` max 3 on Vercel, idle 10 s, connect timeout 8 s (`db.js`); **no `statement_timeout`**. Schema bootstrap already uses a hash marker (one SELECT per cold start). | `db.js` | safety | Low | S | 1 (set `statement_timeout` via pool option) |
| P16 | Retention | No cleanup of expired `admin_sessions`, old `campaign_deliveries`, orphaned `media`. Only `user_sessions` are purged (at login). | grep DELETE | storage growth | Low | M | 2 (deletes data: needs approval) |
| P17 | Safety (report only) | `server/index.js` accepts `admin` / `admin` unless `DISABLE_DEFAULT_ADMIN=true`. Production value **not verifiable from here**. Check: `vercel env ls production \| grep DISABLE_DEFAULT_ADMIN` (names only), and `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{"email":"admin","password":"admin"}' https://interior-design-app-ui-7rjz.vercel.app/api/admin/login` must print 401. Phone-only sign-in (no OTP) is by design in `clients.js:login`. | code | | | | report |

Third-party AI/translate/image timeouts and retry jitter (area C) and image `expo-image` caching / layout shift (area B) were **not audited**.

## 3. Tier-1 plan (not implemented)
Each is a separate, revertable commit, to be measured before/after:
1. P2: exclude the mediabunny chunk from the idle prefetch list in `scripts/postexport.js`.
2. P4/P5: add `CREATE INDEX IF NOT EXISTS` lines to the end of `SCHEMA` in `server/db.js` (the schema hash makes each instance re-apply once; additive; rollback = `DROP INDEX IF EXISTS <name>` for the same names, run manually):
   `claims_client(client_id)`, `subs_owner(owner_type, owner_id)`, `requests_user_created(user_id, created_at DESC)`, `sessions_client(client_id)`, `sessions_exp(expires_at)`, `outbox_next(next_at)`. Verify with `scripts/perf/dbbench.js` on PGlite/Neon branch first; on a large production table use `CREATE INDEX CONCURRENTLY` through `DATABASE_URL_UNPOOLED` instead.
3. P12 lazy `web-push`; P15 `statement_timeout`; P10 narrow selectors.

## 4. Tier-2 plans (need approval)
- **P1/P3 split i18n and Reanimated from the startup chunk**: load `fr/ar/dar` core namespaces first and admin namespaces on admin routes (`i18n.addResourceBundle`); re-measure LCP; rollback = revert commit. Check RTL and all 3 languages in the browser scripts.
- **P8 sync**: add `ETag`/`If-None-Match` to `/api/sync`, drop the `campaign_tick` write unless a campaign is due (read-only check first), optional push-driven invalidation. Rollback = server revert; clients ignore unknown fields.
- **P6 `space`**: new `space_messages` table (append-only), dual-write, backfill in batches on a Neon branch, switch reads, keep the old column for one release. Rollback = switch reads back.
- **P13 media**: add `/api/media` response with final URL + `immutable` and thumb/medium variants at upload.
- **P16 retention**: scheduled cleanup (sessions older than expiry, deliveries older than N days), dry-run count first.

## 5. How to re-measure
```
npx expo export -p web --output-dir /tmp/dist --dump-sourcemap && node scripts/postexport.js /tmp/dist
node scripts/perf/modsize.js /tmp/dist/_expo/static/js/web "" 40
STATIC_DIR=/tmp/dist PGLITE_DIR=:memory: API_RATE_LIMIT=5000 node server/start.js   # separate shell, then:
node scripts/measure-lcp.js http://127.0.0.1:8080 --runs=5 --cpu=4
node scripts/perf/apibench.js http://127.0.0.1:8080 200
node scripts/perf/coldstart.js
node scripts/perf/dbbench.js base            # unverified; writes to $TMPDIR
```
Run Chromium and the server one at a time on small machines; the 1 GB sandbox froze twice when they ran together.
