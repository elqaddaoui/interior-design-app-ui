# Dwira — AI interior design (Android · iOS · Web)

One Expo codebase (SDK 57, Expo Router, TypeScript, NativeWind, Zustand, i18next, Reanimated).
Hybrid app: content repositories retain their existing mock/local implementation. User sessions, credits, image spaces, requests and admin notifications use the Postgres-backed API in `server/` (served on Vercel through `api/index.js`).

## Android app (APK)
Download the latest APK from **[GitHub Releases](https://github.com/elqaddaoui/interior-design-app-ui/releases/latest)**.
**Every update is released as a new version:** after merging into `main`, push a tag `vX.Y.Z` (or Actions → *Android release* → *Run workflow*); the workflow builds the signed APK and publishes the release. One-time setup (move the workflow file into `.github/workflows/`, signing key): [`docs/ANDROID_RELEASES.md`](docs/ANDROID_RELEASES.md).

## Run
```bash
npm install
npx expo start        # then press a (Android) / i (iOS) / w (web)
npm run web           # web only (responsive: centred layout, desktop top nav)
npm run typecheck
npm run build:web     # static export to dist/ (+ Vercel-safe asset post-processing)
npm run serve:web     # serve dist/ locally with the same SPA fallback as Vercel
npm run check:themes  # WCAG contrast report for the 20 theme presets
```
- User app: `/` · Admin panel: `/admin`. Default login everywhere (real and demo mode): user `admin` / password `admin`. Custom server credentials (`ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH`) also work in addition.
- Languages: Moroccan Darija (default, RTL), Arabic (RTL), French — Settings → Language.
- Admin edits write to the same Zustand store the user app reads, so they apply instantly.
- Admin panel shortcuts: **right-click** (mouse) on any row, tile, menu entry or the page background opens a context menu (edit, duplicate, show/hide, move first/last, select, delete; WhatsApp/call/copy on clients and requests; open in a new tab on menu entries). Touch long-press keeps selecting rows as before. Every collection row also has a **Duplicate** button (and a bulk Duplicate for the selection); campaigns, slideshow pictures and palette colours can be duplicated too. Each admin page shows the configured loading animation until its data has arrived from the database. Search/filter inputs and API-key fields are not auto-filled by the browser (`autoComplete` is off / `new-password`); saved keys stay on the server untouched.
- Bottom-bar navigation speed: tabs are lazy (built on first press), so the first press on Explore / History / Assistant used to build the whole screen while the person waited (about 330-390 ms on a 4x-throttled phone CPU, against about 120 ms for every later press). `src/hooks/useTabPreload.ts` now builds the other tabs one at a time in idle time, after the start-up loader is gone and never in data-saver mode, so the first press costs the same as later ones. Preloaded screens stay hidden and unfocused (their cards and animations do not run). The staggered fade-in on Explore and on the Assistant WhatsApp card was removed: it played while the screen was still hidden and only delayed the first paint.
- Multiple-images popup (Tools > Edit > Multiple images): pick **several pictures at once** (computer file dialog or phone gallery), or drop files from the computer onto the area; **drag a picture onto another** (mouse, or touch after a short hold) to set the order.

## Architecture
```
src/
  app/            Expo Router routes ((tabs), tool, render, lead, result, explore, chat, settings, pro, admin/*)
  components/     ui/ (Card, MediaView, StepHeader, GridSelector, Sheet…), wizard/, result/, admin/ (CrudTable, FormModal…)
  admin/entities  ONE config per CRUD entity -> one generic CrudScreen
  data/types.ts   domain model (LText = {dar, ar, fr})
  data/repositories/{types,index}.ts   interfaces + composition root (the ONLY file to change for a backend)
  data/mock/      in-memory + AsyncStorage implementations, seed data, mock services
  store/ theme/ i18n/ hooks/ lib/
```

## Data: everything lives in the database
With the backend enabled (default on web, or `EXPO_PUBLIC_API_URL` on native) the app keeps **no local copy** of business data. `src/data/repositories/index.ts` wires every repository to the API:

| Data | Table(s) | Who writes it |
| --- | --- | --- |
| Content: `tabs`, `tools`, `roomTypes`, `styles`, `palettes`, `sections`, `categories`, `inspirations`, `models`, `plans` | `content_items` | admin (`PUT/DELETE /api/admin/content/...`) |
| Settings documents: `branding`, `theme`, `assistant`, `settings` | `content_docs` | admin (`PATCH /api/admin/doc/:name`) |
| Auto-translation: `POST /api/admin/translate` (admin only) fills the other languages of multilingual fields (Darija / Arabic / French) with free, keyless providers: Pollinations LLM first (real Darija), MyMemory fallback (fr<->ar). Toggle: Admin > Interface > Automatic translation (`settings.autoTranslate`). | - | admin |
| Clients (leads), credits, blocked state | `clients` | clients sign in; admin edits credits/blocked |
| Render requests | `requests` | clients create; admin updates |
| Per-client history and chats | `space` | the client |
| Notification / banner / language preferences | `clients.prefs` (clients), `admin_prefs` (admins) | the person, from any device |
| Push devices | `subscriptions` (owner = admin id or client id) | the person, per device |

The starter content in `server/seed-content.json` (generated from `src/data/mock/seed.ts` with `npm run gen:seed`) is inserted **once** into an empty database (`content_seeded` marker); after that edits and deletions are permanent. Provider API keys are only returned to admin sessions. Only truly device-local values stay on the device: the anonymous device token, the "admin session exists" flag, and in-progress UI state. `EXPO_PUBLIC_BACKEND_MODE=demo` restores the old AsyncStorage mocks for offline demos only.

### Real-time sync
`GET /api/sync` returns a version counter per kind of data (`content`, `requests`, `clients`, one per client, one per admin). Every device polls it every 4 s (and on focus/visibility/reconnect) and reloads only what changed: admin edits appear on all admin and client devices, new leads/requests appear on every admin device, credits/blocks/history reach the owning client on all of their devices. Unsaved admin drafts are never overwritten. (Websockets are not available on Vercel serverless; polling is the portable real-time channel. The same poll also retries failed notifications.)

### Uploaded images
All media (admin images and videos, client photos, AI results, chat images, external image links) is stored in **Cloudflare R2** through `server/media.js` and referenced by stable `/api/media/<hash>.<ext>` URLs (a redirect to the public R2 object). Videos use admin-only presigned uploads; external https images are downloaded once. Without the `R2_*` variables, files fall back to raw bytes in the `media` table; base64 is never stored. Setup and migration (`scripts/migrate-media-to-r2.js`): see [docs/r2-setup.md](docs/r2-setup.md).

## Services to replace later (`Services`)
`upload` (file storage) and `whatsapp` (send design) are still mock services; `render` is real as soon as an image engine has a key (see **AI image generation** below; without one the app keeps its sample result); `auth` is the real admin login and `chat` is real (see **AI chat** below; it falls back to the local canned reply when no provider answers).

## Deploy on Vercel (UI + API)
`vercel.json` builds the static web export **and** exposes the backend as a Vercel Function (`api/index.js` -> `server/index.js`). The backend needs a Postgres database; without one every `/api/*` call answers `503 DATABASE_NOT_CONFIGURED` and `/lead` shows "service temporairement indisponible".
1. Import the repo in Vercel (framework preset: **Other**); install/build/output are set in `vercel.json`.
2. **Project -> Storage -> Create Database -> Neon (Postgres)** and connect it to the project (Production + Preview). Vercel injects `DATABASE_URL` / `POSTGRES_URL`; tables are created automatically on first request.
3. Redeploy, then open `https://<your-domain>/api/health`: it must return `{"ok":true,"database":"pg",...}`. Then test `/lead`.
4. Admin login at `/admin`: `admin` / `admin` by default. For real credentials set `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (`ADMIN_PASSWORD='...' node server/password.js`) and then `DISABLE_DEFAULT_ADMIN=true`.
5. Optional environment variables: `CRON_SECRET` (protects `/api/push/pump`), `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (otherwise generated and stored in the database), `FCM_SERVICE_ACCOUNT_JSON` (native Android app). See `server/.env.example`.
6. Node 22.13+ is required (`engines` in `package.json`).

## Deploy on Hostinger (managed Node.js, UI + API in one process)
Build command not needed (`dist/` is built by `postinstall` during Hostinger's `npm install`; `npm run build:web` also works), entry file `server/start.js` (= `npm run start:server`), output directory **empty**, Node 24, one required variable: `DATABASE_URL` (Neon pooled). Exact hPanel settings, all variables and troubleshooting: [docs/HOSTINGER.md](docs/HOSTINGER.md). Vercel keeps working unchanged; `vercel.json` and `api/` are Vercel-only.

### Performance (first load)
What keeps the first load fast, and where to change it:
- **The UI never waits for the network.** Home renders as soon as the device-only reads (language, local flags) are done. Public content comes from, in order: the HTML shell's early request (`scripts/postexport.js` injects a `fetch('/api/content')` that starts before the JavaScript has downloaded), the copy cached on the device (`dwira:v1:content-cache`, public content only, never an admin copy), then the network. With nothing cached, Home shows same-size placeholders (never a false "empty" message). The session check runs in the background. Startup reads retry at most 4 times (0.8 s, 1.6 s, 2.4 s) and then the app stays open; the 4 s sync loop keeps trying.
- **API.** `vercel.json` pins the function to `fra1` (next to the Neon database in Frankfurt). `/api/health` and the public `/api/content` skip the session/auth lookup (an admin credential or `?a=1` is the only thing that triggers it). Tables are created only when the stored schema marker (`settings.schema_version`, a hash of the schema) differs, not on every cold start.
- **`/api/content` caching.** Public responses carry `Cache-Control: public, max-age=0, s-maxage=<CONTENT_S_MAXAGE>, stale-while-revalidate=<10x>`; `CONTENT_S_MAXAGE` defaults to 30 seconds, is capped at 300 and `0` disables shared caching. Admin requests (`?a=1`, or any credential) are always `private, no-store`: that copy contains provider API keys. After an admin edit, devices reload with `?v=<version>` so the short CDN window never delays a change they were told about.
- **Bundle.** The gesture library (before/after slider, admin drag handle) is an on-demand chunk; the web gesture root no longer imports it. The Home route chunks are preloaded from the shell. Unused packages were removed.
- **Assets.** The web icon font is subset to the glyphs the app can use (`python3 scripts/subset-icons.py`, needs `fonttools` + `brotli`; re-run it if you add icons to `ICON_CHOICES` or the seed). The first Home card image is `fetchpriority=high`/eager and preloaded by the shell once the content names it. Hashed files under `/_expo` and `/assets` are immutable for a year; icons/favicon are cached for 30 days, the manifest for a day, `index.html` always revalidates (same policy in `vercel.json` and the Node server).
- **Measure it.** `node scripts/measure-lcp.js <url> --runs=5 [--images=allow] [--cpu=4]` runs a cold-cache load on emulated Slow-4G (1.6 Mbit/s, 150 ms RTT) and prints LCP/FCP/bytes. It is a lab figure from your machine; use PageSpeed Insights for the real one.

### Notifications
- **Admins** get a push for every **new lead** (a client signing up) and every **new render request**, on every device where notifications are enabled. Open `/admin` -> **Activer les notifications** then **Envoyer un test**.
- Admins also get a push for every **new chat message** from a client. It opens `/admin/chats` on that conversation, where the admin can reply (or open WhatsApp). The reply is saved in the client's own conversation and pushed to that client only (opens `/chat/<id>`).
- **Clients** get a push when their design is **ready** (the admin marks the request delivered), and when an admin **replies in chat**, on every device where they enabled notifications.
- **Notification switches** (`/admin/notifications`, stored in `settings.notifyAdmins` / `settings.notifyUsers`, both on by default, saved with Submit): one for admin notifications, one for user notifications. They are checked on the server for every delivery path (requests, leads, chats, replies, ready, test push), on top of each person's own preference. When user notifications are off, the Settings toggle is disabled with an explanation. The same page lists the clients who enabled browser/app notifications with a status (on, off by the client, paused by the admin).
- **On by default:** whenever a device already has notification permission and the person's saved setting (stored in the database, per admin / per client) is not "off", the device is subscribed silently on sign-in or startup, with no prompt. Turning notifications off in Settings is saved in the database and applies to all of that person's devices. The browser/OS permission prompt can only be shown from a tap, so first-time opt-in is the toggle in Settings or the banner in History.
- Works on desktop Chrome/Edge/Firefox/Safari, Android Chrome, and the Android app. On iPhone/iPad, first use Safari **Share -> Add to Home Screen**, open Dwira from that icon, then enable notifications (Apple only allows web push for installed web apps).
- Delivery is sent from the API request itself (bounded wait); failures stay in the outbox and are retried by the sync poll and the daily cron (`/api/push/pump`, Vercel Hobby allows daily crons only).

### Push campaigns and automations (`/admin/notifications`)
- **Campaigns**: one-off (now or scheduled), or recurring (daily / weekly / monthly) with title and body in Darija, Arabic and French (`{name}` is replaced by the client's first name), an in-app link, and an audience: everyone, **new** clients, **existing** clients, **inactive** clients, clients who **generated images** (or never did), and/or hand-picked people. The composer shows the reachable device count and can send a test push to your own devices.
- **Automations** run on activity: after sign-up, after a first/each design, or after inactivity, with a delay, a per-client cooldown and the global frequency cap (`settings.campaignCapHours`, default 24 h). Quiet hours default to 22:00-08:00 Africa/Casablanca. Every delivery is recorded once per client and occurrence (`campaign_deliveries`), so retries and parallel runs never double-send.
- **Scheduler**: Vercel Hobby only allows a daily cron, so due campaigns are also processed by every sync poll, by `/api/push/pump` and by an in-process timer. For minute-level punctuality, point a free external pinger (cron-job.org, UptimeRobot) at `GET /api/push/pump` every minute, with `Authorization: Bearer $CRON_SECRET`.
- The push card on the dashboards (admin home, requests, notifications > Devices) shares one minimal component.

### AI image generation (`POST /api/ai/render`)
- **Inputs, all working for text-to-image and image-to-image:** the client's photo (or, with no photo, a written description), the room type, the style preset, the Explore inspiration (sent as a style reference, never as the room), a preset palette or up to 5 **custom hex colours** (applied exactly, with roles for walls / furniture / accents), the mode (restyle keeps the layout, renovation allows more freedom) and the client's own instructions (500 characters).
- **Interior accuracy:** `server/imagegen/prompt.js` builds a structure-preserving prompt (room layout, walls, openings, perspective, proportions, furniture footprint, materials) and the output keeps the photo's aspect ratio (multiples of 16, longest side `IMAGEGEN_MAX_SIDE`, default 1024).
- **Default engine: Pollinations** (`gen.pollinations.ai`, free models). Photo models: FLUX.2 Klein, FLUX.1 Kontext, MAI Image 2.6 Flash. Text-only models: Z-Image Turbo, FLUX.1 Schnell. It needs **one free key** from <https://enter.pollinations.ai>: set `POLLINATIONS_API_KEY` or paste it in **Admin > AI models** (write-only, stored server-side, never returned to any client). Without a key the app stays in demo mode and shows its sample result.
- **Any OpenAI-compatible images API** (`/images/generations` + `/images/edits`) works too: `IMAGEGEN_API_KEY` / `IMAGEGEN_BASE_URL`, or set an **engine** (and optional API URL / key) on an admin AI model. To add a different kind of engine, add one entry to `ENGINES` in `server/imagegen/index.js`.
- **Active model & switching:** the wizard's last step shows the model that will run. The admin picks the model per tool (Admin > AI models); turning on *Let the client choose the model* shows a switcher limited to the models that tool allows. The admin's model runs first, then the free chain (a failing or rate-limited model rests for a while and the next takes over). Optional: `IMAGEGEN_MODELS_I2I` / `IMAGEGEN_MODELS_T2I` (comma-separated model ids put in front of the chain).
- **Safety:** one generation per request (idempotent per claim id, so retries never generate or charge twice), owner-checked, max 2 concurrent per client; the photo and result go through the media store (R2 or the database).
- **Time limit:** Vercel stops functions after 30 s, so there the budget is 25 s (`IMAGEGEN_BUDGET_MS` / `IMAGEGEN_ATTEMPT_MS` override it). Hostinger / any long-running Node host gets 54 s per request. Prefer a long-running host for the slower photo models.
- Tests: `node --test scripts/check-imagegen-server.js` (engines are mocked, no network).

### Database transfer (Neon free tier)
Network transfer is the bytes Postgres sends back. What was reduced (measured with `scripts/bench-db-transfer.js`: **48,340 KB -> 1,961 KB** for the same scripted session, 96% less): media is read metadata-first with an in-memory byte-budget cache (`MEDIA_CACHE_MB`, default 24) and `HEAD`/`304` support; `/api/content` answers `304` from a version-keyed snapshot (ETag) without touching the tables; per-user and guest reads fetch one row (not the whole space); client sync is per part (`c:<id>:history|requests|conversations`) so one change reloads one list; the admin inbox is the newest 300 chats plus a `since` delta; `/api/requests` is bounded (`?limit=`, `?before=`). Everything else (schema, endpoints, payload shapes for existing clients) is unchanged. Tests: `node --test scripts/check-neon-transfer.js`.

### AI chat (`/api/chat/reply`)
- Free providers are tried in order and the next takes over on error or quota: **Google Gemini** (`GEMINI_API_KEY`, aistudio.google.com, best for Darija/Arabic/French), **Groq** (`GROQ_API_KEY`), **OpenRouter** free models (`OPENROUTER_API_KEY`), then keyless **Pollinations** as a last resort. Keys can be set as environment variables or pasted in `/admin/assistant` (write-only, stored server-side, never returned). Optional: `CHAT_PROVIDER_ORDER` (e.g. `groq,gemini`), `GEMINI_MODEL` / `GROQ_MODEL` / `OPENROUTER_MODEL`, `CHAT_RATE_LIMIT` (messages per minute per visitor).
- The reply language follows the visitor (Darija in Arabic script or Latin letters, Arabic, French).
- **Human-like pacing** (`/admin/assistant`, per assistant config): *Instant*, *Natural* (delay scales with the answer length, 0.9-3.5 s) or *Custom* min/max seconds, plus an optional typewriter reveal. The typing indicator shows immediately; the request starts at once and its own network time counts towards the delay.

Why `scripts/postexport.js`? Vercel never serves paths containing a `node_modules` segment, but `expo export` writes package fonts/images
(icon font, router icons) to `dist/assets/node_modules/...`. The script moves them to `dist/assets/vendor/...` and rewrites all references, injects the web app manifest/iOS meta tags, and fails the build if any are left.

## Admin: interface options
- **Loading screen** (`/admin/interface`): on/off, 9 built-in styles (ring, dots, pulse, bars, plus four Moroccan-interior ones: zellige tiles, horseshoe arch, fanous lantern, mosaic wave) + a custom image (GIF/SVG/PNG/WebP, optional spin/pulse), colour, and display time. **Auto** (default) removes it as soon as the first two Home cards have painted; a fixed time (0.5-10 s) keeps it that long after opening. The same loader is shown whatever page the app opens on, and every in-app spinner (buttons, loading placeholders, large images) uses it too (`<Spinner/>`). On web it is plain HTML/SVG in `index.html` (painted before any JavaScript, see `src/lib/loaderShell.js`); native draws the same styles in React (`BootOverlay`).
- **Chats**: client conversations are stored per account (database `space` table) and restored on every device the client signs in on; a new account starts empty and the app clears the previous account's data when the user changes. Admin messages cannot be forged or overwritten by a client.
- **Video thumbnails**: when a tool has a video but no image, the first frame of the video is captured automatically (on upload and on a pasted URL; web canvas, native expo-video + ImageManipulator) and used as its preview. If capture fails the form still saves.
- **Dashboard**: 7/30/90-day KPIs with trend vs the previous period, activity chart, search (requests, users, tools, styles, rooms), best features, recent activity, quick actions.
- **Interface & menus** (`/admin/interface`): choose the user bottom bar (Classic / Floating / Minimal) and the admin menu (icon rail / collapsible drawer / grouped horizontal menu). Stored in `settings.userNavStyle` / `settings.adminNavMode`.
- **Home tabs** (`/admin/tabs`): switch "show all tools by default" (`settings.homeShowAll`). When on, Home opens on an "All" pill and tabs are an optional filter.
- **Theme** (`/admin/theme`): 20 presets in 6 categories + custom (5 colours, the rest derived with contrast checks). The phone status bar and Android navigation bar take the theme background colour (`SystemBars`).
- The AI model is chosen by the admin per tool (default model fallback); end users never see a model picker.

## Local full stack
```bash
npm run build:web
PGLITE_DIR=:memory: COOKIE_SECURE=false npm run start:server   # API + dist on http://localhost:8080 (in-process Postgres, no install)
```
`npm run start:server` runs `server/start.js`: one process for `dist/` and `/api/*`, listening on `PORT` (0.0.0.0). It refuses to start without `DATABASE_URL` unless `PGLITE_DIR` is set (`:memory:` or a folder, e.g. `server/data/pglite`). Set `DATABASE_URL` to use a real Postgres instead. The server listens first and connects to the database in the background (retrying while a sleeping Neon database wakes up): `/api/health` answers 503 with `database: "starting"` until then. `/api/health` returns JSON with `ok`, `runtime`, `database` and `adminConfigured`; HTML means `/api` routing is wrong. For a separately hosted API, set `EXPO_PUBLIC_API_URL=https://api-host/api` **before building** (required for Android/iOS) and `APP_ORIGINS` on the backend. To intentionally run the UI-only demo, build with `EXPO_PUBLIC_BACKEND_MODE=demo`.

### Checks
```bash
npm run typecheck
npm run lint
npm run test:server        # backend (in-memory Postgres), push, config
# with the local full stack running (use API_RATE_LIMIT=5000):
node scripts/check-client-browser.js   # lead flow, sessions, admin menu
node scripts/check-push-browser.js     # notification button desktop/mobile/iOS hint
node scripts/check-inbox-browser.js    # admin chat deep link + reply, notification switches, Moroccan loader tiles
node scripts/check-sync-browser.js     # two browsers: content, leads and preferences sync (server serving dist/)
```
Phone-only login is the existing behavior (no OTP verification); do not treat knowledge of a phone number as production-grade proof of identity. Real push delivery to Google/Apple and physical devices remain manual checks.
