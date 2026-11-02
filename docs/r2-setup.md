# Cloudflare R2 media storage

All media of the app (admin images, logos, loader images, tool videos and posters, client photos, AI results, final
designs, assistant chat images) is stored in a Cloudflare R2 bucket. The app always references files by a stable URL
`/api/media/<hash>.<ext>`. The API answers that URL with a redirect to the public R2 object, so existing links keep working
and the bytes never pass through the Vercel function.

Without the R2 variables, files are stored as raw bytes in the database's `media` table (fallback for local development).
Base64 is never written to the database in either mode.

## How it works

| Flow | What happens |
| --- | --- |
| Admin image fields (`ImageField`: content images, covers, posters, logo, loader image, final design) | The picked image is uploaded at once (`POST /api/admin/media`). The server checks the real file type from its bytes, stores it in R2 and returns the `/api/media` URL. |
| Admin pastes an external image link (Unsplash, CDN) | When the field loses focus (and again as a safety net on save), the server downloads the image once (`POST /api/admin/media/import`) and saves the `/api/media` URL. |
| Admin video upload (tool media of type video) | `POST /api/admin/media/presign` returns a presigned PUT URL that is valid for **5 minutes**. The server picks the key, and the type and exact size are part of the signature. The device uploads straight to R2, then `POST /api/admin/media/complete` checks size, type and magic bytes before publishing. Admin-only. |
| Client render flow (photo → request → AI result → history) | Photos are sent as data URLs. `POST /api/requests`, `PATCH /api/requests/:id` (`aiResult`, `finalResult`) and `/api/user/history` / `/api/user/conversations` store every inline image and every external AI/CDN image URL in R2. If an external download fails there, the original URL is kept so a design is never lost. |
| Content saved before this change | On the first start, inline images left in content are moved to storage. Everything else is handled by the migration script. |

All of this goes through one module, `server/media.js`: `storeMedia()` for writes and `readMedia()` for reads.

External download rules (`server/remote-media.js`):

- https only, port 443, no credentials in the URL, at most 3 redirects (each one checked again)
- private, loopback, link-local, CGNAT, multicast and reserved IPv4/IPv6 ranges are blocked, including through DNS (the connection is pinned to the checked address)
- 10 s timeout, 10 MB maximum, `image/*` only (checked against the file's real bytes)

Upload limits (env, in MB): `MEDIA_MAX_IMAGE_MB` (default 10) and `MEDIA_MAX_VIDEO_MB` (default 100). Allowed types: PNG,
JPEG, WebP, GIF, AVIF, SVG (admin inline uploads only), MP4, WebM and QuickTime.

## 1. Create the bucket

1. Cloudflare dashboard → **R2** → **Create bucket** (for example `dwira-media`). For the location, choose one near `fra1` (Europe).
2. Bucket → **Settings** → **Public access**: either
   - connect a **custom domain** (recommended, e.g. `media.example.com`; it is cached by Cloudflare's CDN), or
   - enable the **r2.dev subdomain** (rate-limited; fine for testing).
   That public URL is `R2_PUBLIC_BASE_URL`, with no trailing slash.
3. Bucket → **Settings** → **CORS policy**. This is needed for direct (presigned) uploads from the browser, and `GET` also lets the admin's **Performance > Video preview** read the card pictures to render the MP4 loops (the browser refuses to encode pictures served without CORS headers):

```json
[
  {
    "AllowedOrigins": ["https://your-app.vercel.app", "https://your-custom-domain"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

## 2. Create an API token

R2 → **Manage R2 API Tokens** → **Create API token**:

- Permission: **Object Read & Write**
- Scope: **only this bucket**
- Copy the **Access Key ID** and **Secret Access Key**. The secret is shown once.
- Your **Account ID** is shown on the R2 overview page.

## 3. Configure the environment

Vercel → Project → Settings → **Environment Variables** (Production and Preview):

| Variable | Value |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | token access key ID |
| `R2_SECRET_ACCESS_KEY` | token secret |
| `R2_BUCKET` | bucket name |
| `R2_PUBLIC_BASE_URL` | e.g. `https://media.example.com` |
| `R2_ENDPOINT` (optional) | only for EU-jurisdiction buckets: `https://<account>.eu.r2.cloudflarestorage.com` |

For local use, put the same names in `server/.env` (gitignored; see `server/.env.example`). Never put them in `EXPO_PUBLIC_*`
variables and never commit them.

Redeploy, then check `GET /api/health`. It should report `"media": "r2"` (`"database"` means no R2 variables are set;
`"incomplete"` means some are missing). Values are never shown.

## 4. Migrate existing media

Run the script from a machine that has the production `DATABASE_URL` and the R2 variables (in the environment or in
`server/.env`):

```bash
node scripts/migrate-media-to-r2.js --dry-run              # what would change; writes nothing
node scripts/migrate-media-to-r2.js                        # DB media rows + inline images -> R2
node scripts/migrate-media-to-r2.js --external --dry-run   # also list external image URLs (Unsplash, ...)
node scripts/migrate-media-to-r2.js --external             # download them into R2 and rewrite the URLs
node scripts/migrate-media-to-r2.js --videos               # optional: external videos too (MEDIA_MAX_VIDEO_MB cap)
```

- **Idempotent:** files are content-addressed, so a second run uploads nothing and changes nothing.
- **Never deletes from the database.** Legacy rows keep their bytes and are only marked `storage='r2'`. Once you have checked everything, you can reclaim the space yourself: `UPDATE media SET data='', body=NULL WHERE storage='r2';`
- URLs that cannot be downloaded are kept unchanged and listed at the end.
- Exit code `0` = success, `2` = some database rows could not be copied (run it again), `1` = configuration error.

## Troubleshooting

- **Images 404 after enabling R2:** run the migration (step 4). Rows still stored in the database keep being served until then.
- **Video upload fails in the browser:** check the bucket CORS policy (origin, `PUT`, `content-type` header). The admin now
  shows a dedicated message when R2 refuses the direct upload; files up to 4 MB are then sent through the API instead.
- **Presigned upload answers 400/403 (`x-amz-checksum-crc32`):** recent `@aws-sdk/client-s3` versions add a CRC32 of an
  empty body to presigned PUT URLs, which R2 rejects. `server/media.js` (`r2ClientOptions`) disables these optional checksums
  (`requestChecksumCalculation` / `responseChecksumValidation: 'WHEN_REQUIRED'`); keep that if you change the client.
- **End-to-end check against a real bucket or emulator:** `R2_TEST_ENDPOINT=<s3 endpoint> R2_TEST_BUCKET=<bucket>
  R2_TEST_KEY=... R2_TEST_SECRET=... node --test scripts/check-media-server.js` uploads an image and a video, saves them on a
  tool, reads them back through `/api/media` and the public URL, and stores a client photo.
- **`MEDIA_URL_*` error when saving:** the pasted link is not https, points to a private address, is not an image, is larger than 10 MB, or did not answer within 10 s. Upload the file instead.
- **Changing the public URL:** update `R2_PUBLIC_BASE_URL`. Redirects are cached for at most one day.
