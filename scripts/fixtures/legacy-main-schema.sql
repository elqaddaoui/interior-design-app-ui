-- Schema of the single-tenant app on main (before multi-tenancy). Used by scripts/check-neon-migration.js.

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  free_used INTEGER NOT NULL DEFAULT 0, credits INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_sessions (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, free INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS space (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, kind TEXT NOT NULL, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS space_client ON space(client_id, kind);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS blocked INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_request_id TEXT, created_at BIGINT NOT NULL, data TEXT NOT NULL,
  UNIQUE (user_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS requests_created ON requests(created_at DESC);
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (request_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, next_at BIGINT NOT NULL, completed TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS prefs TEXT NOT NULL DEFAULT '{}';
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS admin_id TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'request';
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS payload TEXT;
CREATE TABLE IF NOT EXISTS content_items (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (coll, id));
CREATE TABLE IF NOT EXISTS content_docs (name TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_prefs (admin_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, version BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, created_at BIGINT NOT NULL);
-- Media metadata. storage: 'r2' (bytes in Cloudflare R2), 'db' (fallback without R2: raw bytes in body; legacy rows: base64 in data,
-- read-only), 'pending' (presigned direct upload not confirmed yet). New rows never put base64 in data.
ALTER TABLE media ADD COLUMN IF NOT EXISTS body BYTEA;
ALTER TABLE media ADD COLUMN IF NOT EXISTS size BIGINT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS storage TEXT NOT NULL DEFAULT 'db';
-- Assistant conversations of visitors who have not signed in yet, keyed by the secret device token (hashed). They move into the
-- client's own space (table space) the moment that person signs in from the same device.
CREATE TABLE IF NOT EXISTS guest_chats (id TEXT PRIMARY KEY, device_hash TEXT NOT NULL, value TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS guest_chats_device ON guest_chats(device_hash, updated_at);
-- Activity used by notification segments: last time the client's app was open (written at most every 5 minutes) and when each
-- design was started (claims = one per generation).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_seen BIGINT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS created_at BIGINT;
-- Notification campaigns. The data column holds the editable definition; status / next_at are columns so the scheduler can query them.
-- kind: once | recurring | trigger. status: draft | scheduled | sending | sent (once), active | paused | ended (recurring / trigger). One delivery row per (campaign, client, occurrence): the primary key
-- is the idempotency key, so a retry, a second server instance or a repeated tick can never notify the same person twice.
CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, next_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS campaigns_status ON campaigns(status, next_at);
CREATE TABLE IF NOT EXISTS campaign_deliveries (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  occurrence TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at BIGINT NOT NULL, created_at BIGINT NOT NULL,
  sent_at BIGINT, devices INTEGER NOT NULL DEFAULT 0, reason TEXT, completed TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS campaign_deliveries_due ON campaign_deliveries(status, next_at);
CREATE INDEX IF NOT EXISTS campaign_deliveries_campaign ON campaign_deliveries(campaign_id, status);
CREATE INDEX IF NOT EXISTS campaign_deliveries_client ON campaign_deliveries(client_id, sent_at);
-- Admin accounts: the profile of each administrator (id = the stable admin identity used by sessions and preferences). pw_hash is only set once the
-- password was changed in the panel (scrypt, salt:hex); until then the built-in / environment credentials apply. credits NULL = unlimited.
CREATE TABLE IF NOT EXISTS admin_accounts (
  admin_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '', pw_hash TEXT, pw_changed_at BIGINT, credits INTEGER, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, last_login_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_email ON admin_accounts(lower(email)) WHERE email <> '';
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS created_at BIGINT;
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS ua TEXT;
