-- What two EARLIER, never merged preview deployments left behind in the ONE Neon database that every Vercel preview and production share.
-- Applied on top of legacy-main-schema.sql. Taken verbatim from the schema of PR #53 (commit a47ddb0) and PR #54 (commit 04fb590).

-- PR #53
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, plan_id TEXT NOT NULL DEFAULT 'starter', status TEXT NOT NULL DEFAULT 'active',
  data TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS super_sessions (token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, at BIGINT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL DEFAULT '', target_id TEXT NOT NULL DEFAULT '',
  tenant_id TEXT, detail TEXT NOT NULL DEFAULT '{}'
);
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS account_id TEXT;
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS clients_tenant_phone ON clients(tenant_id, phone);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

-- PR #54: a NULLABLE tenant_id without default on admin_accounts (this is what made the multi-tenant migration fail with 23502)
CREATE TABLE IF NOT EXISTS superadmin_account (id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', pw_hash TEXT, pw_changed_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, last_login_at BIGINT);
CREATE TABLE IF NOT EXISTS sa_roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', permissions TEXT NOT NULL DEFAULT '{}', ui TEXT NOT NULL DEFAULT '[]', system INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS role_id TEXT;
ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS perm_override TEXT;
ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS tenant_id TEXT;
-- (the PR #54 code stored its schema markers in `settings`)
INSERT INTO settings(key,value) VALUES ('schema_version','pr54'),('schema_sa_version','pr54') ON CONFLICT (key) DO NOTHING;
