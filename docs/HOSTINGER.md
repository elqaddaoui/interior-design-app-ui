# Deploy on Hostinger (Business / Cloud, managed Node.js)

One Node.js process serves the web app (`dist/`) **and** the API (`/api/*`). Nothing in the Expo app, the mobile
build or the database schema changes. Vercel keeps working at the same time (see the end of this page).

## 1. hPanel settings

**Websites → Add Website → Node.js Web App → Import Git repository** (or upload a ZIP without `node_modules`, `.git` and `dist`).

| Field | Value |
|---|---|
| Framework preset | **Other** (or Express.js, if Hostinger detects it) |
| Branch | `main` |
| Node.js version | **24** (22 also works; `engines` requires 22.13 or newer) |
| Root directory | `/` (empty) |
| Package manager | **npm** (detected from `package-lock.json`) |
| Build command | `npm run build:web` |
| Output directory | **leave empty**. The server serves `dist/` itself. Do not enter `dist`, or Hostinger treats the app as a static site and `/api` stops working. |
| Entry file | `server/start.js` (this is what `npm run start:server` runs) |
| Start command (if shown) | `npm run start:server` |

Prefer the **Entry file** when both fields exist: Hostinger then runs `node server/start.js` directly. Going through
`npm run` adds an npm parent process that stays alive (measured: about 70 MB of RAM and 11 threads, on top of the server).

Then add the environment variables below and click **Deploy**.

If the domain is already on the plan as a normal website, remove that website first: the Node.js flow creates a fresh slot.
Do not edit the `.htaccess` that Hostinger generates in `public_html`; redeploying recreates it.

## 2. Environment variables

hPanel → your site → **Environment variables** (or *Import .env*). Saving redeploys the app. Keys use `A-Z`, `0-9` and `_` only.

### Required

| Variable | Value |
|---|---|
| `DATABASE_URL` | The Neon **pooled** connection string: Neon console → *Connect* → "Connection pooling" **on**. Its host contains `-pooler`. Example shape: `postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require` |

Without it the server does not start. The runtime log then shows:
`[dwira] Cannot start: configuration is incomplete. - DATABASE_URL is not set ...`

### Recommended

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL_UNPOOLED` | The Neon **direct** connection string (same, *without* `-pooler`) | Used only when the schema has to be created or updated, through one short direct connection, as Neon recommends for migrations. Normal traffic stays on the pooled URL. If you leave it out, migrations run on the pooled URL, which works for this schema. |
| `ADMIN_EMAIL` | your admin login | Replaces the default `admin` / `admin` |
| `ADMIN_PASSWORD_HASH` | output of `ADMIN_PASSWORD='a-long-password' node server/password.js` | |
| `DISABLE_DEFAULT_ADMIN` | `true` once your own login works | |
| `CRON_SECRET` | a long random string | Protects `/api/push/pump` (see section 4) |

### Optional (same meaning as on Vercel, see `server/.env.example`)

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` (media in Cloudflare R2; without them media is stored in the database) ·
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (otherwise generated and stored in the database) · `FCM_SERVICE_ACCOUNT_JSON` ·
`GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` · `APP_ORIGINS` (only for a frontend hosted on another domain) · `CONTENT_S_MAXAGE`, `API_RATE_LIMIT`, `CHAT_RATE_LIMIT`, `PUSH_WAIT_MS`.

### Do not set

| Variable | Why |
|---|---|
| `PORT` | The server uses Hostinger's `PORT` when it provides one, otherwise **3000** (the port Hostinger's proxy expects). Hostinger is detected from the deploy folder (`~/domains/<domain>/hbuilds/...`). If the startup log says `platform: node` and a port other than 3000, set `DWIRA_PLATFORM=hostinger` (or `PORT=3000`). |
| `PGLITE_DIR` | Local development only. On a host it would keep data on a disk that is replaced on every deploy. |
| `VERCEL` | Switches the server to serverless behaviour. |
| `COOKIE_SECURE=false` | Hostinger serves HTTPS; keep cookies `Secure`. |

### Tuning (normally leave unset)

| Variable | Default | Meaning |
|---|---|---|
| `DB_POOL_MAX` | `5` | Postgres connections held by the single process (Neon's pooler multiplexes them) |
| `UV_THREADPOOL_SIZE` | `2` | Node's worker threads (Node's own default is 4) |
| `NODE_OPTIONS` | unset | Set it to `--v8-pool-size=2` to save 2 more threads (measured: 9 → 7 threads per process) |
| `SYNC_CACHE_MS` | `2000` | How long `/api/sync` versions are reused in memory (0 disables) |
| `BACKGROUND_INTERVAL_MS` | `30000` | Notification retries and campaign scheduler while the app is in use |
| `BACKGROUND_IDLE_MS` | `300000` | The same when nobody used the app for 5 minutes |
| `TRUST_PROXY` | `true` on Hostinger | Reads the visitor address forwarded by Hostinger's local proxy (per-visitor rate limits) |

## 3. Check the deployment

1. The **Runtime logs** show one line like this (it never contains a password or a connection string):

   ```
   [dwira] Server ready on http://0.0.0.0:3000 | platform: hostinger | Node.js 24.x | database: postgres (neon, pooled, migrations via DATABASE_URL_UNPOOLED) | web: dist/ | threads: libuv 2
   [dwira] Database connected.
   ```
2. Open `https://YOUR-DOMAIN/api/health`. It must return HTTP 200 with JSON:

   ```json
   { "ok": true, "runtime": "node", "node": "24.x", "platform": "hostinger", "database": "pg", "media": "r2", "adminConfigured": true, "uptime": 42 }
   ```
   `database` is `pg` when Postgres answers, `error` (HTTP 503) when it does not. If you get **HTML** instead of JSON, the
   site is deployed as static: clear **Output directory** and set **Entry file** to `server/start.js`.
3. Open `/`, `/lead` and `/admin`. Every app route loads the same `index.html`, as on Vercel.

| Symptom | Fix |
|---|---|
| 503 page, log says `Cannot start: configuration is incomplete` | Add the variable named in the log, save (this redeploys) |
| `/api/health` → `"database":"error"` | Wrong `DATABASE_URL` or password, or the Neon project is deleted or over quota. The log line `Database not reachable yet (...)` shows the error code (never the URL). |
| 503 / "too many processes" | hPanel → Resource usage → **Stop running processes**, then Restart. `domain.tld` and `www.domain.tld` each run one process: redirect `www` to the main domain if you do not need both. |
| Log warns `DATABASE_URL points to a direct Neon endpoint` | Put the `-pooler` URL in `DATABASE_URL` and the direct one in `DATABASE_URL_UNPOOLED` |

## 4. Scheduled campaigns and notification retries (optional cron)

The server runs notification retries and the campaign scheduler itself: every 30 s while the app is in use, and every
5 minutes when nobody has used it for 5 minutes (so an idle site lets Neon suspend). Hostinger stops background timers
on every deploy or restart, and they start again with the app. For campaigns that must fire on the exact minute when
nobody has the app open, add a cron job: hPanel → your site → **Advanced → Cron Jobs**, every 5 minutes:

```
curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR-DOMAIN/api/push/pump
```

(`YOUR_CRON_SECRET` = the `CRON_SECRET` variable. The command must not contain `%`.)

## 5. Resource usage

What the server does to stay small on a shared plan:

- **One process, no cluster, no child processes, no PM2.** Hostinger starts and restarts the process itself.
- **9 threads** (7 with `NODE_OPTIONS=--v8-pool-size=2`): the main thread, V8's helper threads, and a libuv pool of 2 instead of 4. Without these settings Node uses 11.
- **At most 5 database connections**, through Neon's pooler.
- **About 75 MB of RAM** measured on Node 24 after serving the app and the API. Static files are streamed from disk; only compressed text files (HTML, JS, CSS) are kept in memory.
- Never set `PGLITE_DIR` on the host: the in-process development database alone needs several hundred MB.
- **`/api/sync` costs less**: the web app polls every 4 s only while someone uses the page. An open tab nobody touches slows to 15 s after 2 minutes and 30 s after 10 minutes; a hidden tab does not poll at all. Any click, key, scroll or focus polls at once. The server answers polls from a 2 s in-memory copy that its own writes refresh immediately, and a poll no longer triggers the notification queue or the campaign scheduler (the background timer does that). The native apps keep their 4 s foreground polling, unchanged.

## 6. Vercel at the same time

Nothing changes for Vercel: `vercel.json` and `api/index.js` (Vercel-only files) still build `dist/` and run the same backend
as a function. These files are used by the long-running server only and ignored by Vercel's routing:

| File | Role |
|---|---|
| `server/start.js` | Entry point: env check, startup log, `PORT` / `0.0.0.0`, shutdown |
| `server/config.js` | Variable validation, port and platform detection, log redaction |
| `server/static.js` | `dist/` hosting with vercel.json's SPA fallback and cache headers (`scripts/check-node-hosting.js` compares them) |

The `public/.htaccess` file is for static-only Apache hosting. The Node server never serves it, and Hostinger's Node.js setup does not use it.
