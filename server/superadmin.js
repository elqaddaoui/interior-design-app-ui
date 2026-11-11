/**
 * Platform back office (docs/MULTI_TENANT_PLAN.md sections 5 and 6): the ONLY code that reads and writes the `saas_*` tables and the
 * only tenant-aware code that uses the raw database on purpose (it manages tenants; it is never reachable from a tenant's own routes).
 *
 *   - Super admin identity: separate table, cookie and header from every tenant admin. No built-in password: SUPERADMIN_EMAIL +
 *     SUPERADMIN_PASSWORD_HASH (same scrypt format as ADMIN_PASSWORD_HASH) must be set, otherwise login answers 503.
 *   - Tenants: create / edit / suspend / delete, their administrators and custom domains. Everything is audited.
 *   - Demos: a demo is a TEMPLATE tenant (kind 'demo') with sample data. Assigning it makes an independent tenant instance by VALUE
 *     (one transaction, no shared row, no reference back). Later edits of either side never reach the other.
 *   - Change requests: submitted by a tenant admin (tenant id from the session), answered and applied by the super admin. `apply`
 *     takes the tenant from the stored request row, never from the payload, and refuses demo templates.
 *
 * Nothing here stores or reads a style: the Super Admin's look is hard-coded in src/superadmin/tokens.ts.
 */
const crypto = require('node:crypto');
const { passwordMatches, hashPassword, passwordProblem } = require('./admins');
const { slugProblem } = require('../src/lib/reservedSlugs');
const { TENANT_TABLES } = require('./db');
const { keyFor, EXT } = require('./media');
const { TENANT_ID } = require('./scope');

const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const clean = (value, max) => Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, max).join('');
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,24}$/;
const newId = prefix => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const SESSION_MS = 12 * 3600 * 1000;
const RETIRE_MS = 30 * 86400000; // a released slug stays reserved for 30 days (Q6)
const REQUEST_KINDS = ['customize', 'manage', 'support'];
const REQUEST_STATUS = ['open', 'in_progress', 'done', 'rejected'];
const DEMO_STATUS = ['draft', 'published'];
const TENANT_STATUS = ['active', 'trial'];
// Settings keys a new instance inherits from its demo. Everything else (AI provider keys, VAPID, rotation cursor, counters, notification
// switches that point at a person) is deliberately NOT here: an instance starts with its own secrets and counters.
const COPIED_SETTINGS = ['content_seeded', 'media_migrated_v2', 'assistant_automations', 'prompt_rules'];
// Children before parents (foreign keys), then anything a future release adds to TENANT_TABLES.
const DELETE_ORDER = ['campaign_deliveries', 'campaigns', 'space', 'claims', 'user_sessions', 'guest_chats', 'requests', 'outbox', 'subscriptions', 'clients',
  'admin_sessions', 'admin_prefs', 'admin_accounts', 'content_items', 'content_docs', 'settings', 'sync_state', 'media'];
const num = value => (value == null ? null : Number(value));
const randomPassword = () => crypto.randomBytes(12).toString('base64url');

function createSuperAdmin({ db, env = process.env, bundles, tenants, storage = bundles.storage }) {
  const configured = () => !!(env.SUPERADMIN_EMAIL && env.SUPERADMIN_PASSWORD_HASH);
  const attempts = new Map(); // address -> { count, until }: 5 failed sign-ins lock that address for 15 minutes
  const cookieFlags = `HttpOnly; SameSite=Strict; Path=/api${env.COOKIE_SECURE === 'false' ? '' : '; Secure'}`;

  // ---------- Identity ----------
  async function login(ip, ua, body) {
    if (!configured()) throw fail(503, 'SUPERADMIN_NOT_CONFIGURED');
    const now = Date.now();
    const lock = attempts.get(ip);
    if (lock && lock.until > now && lock.count >= 5) throw fail(429, 'Too many attempts');
    const email = clean(body?.email, 190).toLowerCase();
    const password = typeof body?.password === 'string' && body.password.length <= 512 ? body.password : '';
    // The hash is always computed (same cost whatever the e-mail) so timing does not tell which part was wrong.
    const passwordOk = passwordMatches(password, env.SUPERADMIN_PASSWORD_HASH);
    if (!(passwordOk && email === env.SUPERADMIN_EMAIL.trim().toLowerCase())) {
      const entry = lock && lock.until > now ? lock : { count: 0, until: now + 15 * 60000 };
      entry.count++; attempts.set(ip, entry);
      if (attempts.size > 5000) for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
      throw fail(401, 'Invalid credentials');
    }
    attempts.delete(ip);
    const id = 'sa_' + sha(email).slice(0, 12);
    await db.query('INSERT INTO saas_super(id,email,name,pw_hash,created_at,last_login_at) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT (id) DO UPDATE SET pw_hash=EXCLUDED.pw_hash, last_login_at=EXCLUDED.last_login_at', [id, email, 'Super admin', env.SUPERADMIN_PASSWORD_HASH, now]);
    const row = (await db.query('SELECT disabled FROM saas_super WHERE id=$1', [id]))[0];
    if (row.disabled) throw fail(403, 'ACCOUNT_DISABLED');
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('DELETE FROM saas_super_sessions WHERE expires_at<=$1', [now]);
    await db.query('INSERT INTO saas_super_sessions(token_hash,super_id,expires_at,created_at,ua) VALUES($1,$2,$3,$4,$5)', [sha(token), id, now + SESSION_MS, now, String(ua || '').slice(0, 300)]);
    await audit(email, 'super.login', null, '', '');
    return { token, email, cookie: `dwira_super=${token}; ${cookieFlags}; Max-Age=${SESSION_MS / 1000}` };
  }
  const clearCookie = () => `dwira_super=; ${cookieFlags}; Max-Age=0`;
  const tokenOf = req => {
    const header = req.headers['x-super-token'];
    if (typeof header === 'string' && /^[a-f0-9]{64}$/.test(header)) return header;
    const raw = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('dwira_super='))?.slice(12);
    return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : '';
  };
  /** The signed-in super admin or null. The e-mail must still be the configured one: rotating SUPERADMIN_EMAIL signs everybody out. */
  async function authenticate(req) {
    const token = tokenOf(req);
    if (!token || !configured()) return null;
    const row = (await db.query('SELECT s.super_id, u.email FROM saas_super_sessions s JOIN saas_super u ON u.id=s.super_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.disabled=0', [sha(token), Date.now()]))[0];
    return row && row.email === env.SUPERADMIN_EMAIL.trim().toLowerCase() ? { id: row.super_id, email: row.email, token } : null;
  }

  // ---------- Audit ----------
  async function audit(actor, action, tenantId, target, detail) {
    await db.query('INSERT INTO saas_audit(id,at,actor,action,tenant_id,target,detail) VALUES($1,$2,$3,$4,$5,$6,$7)', [newId('au'), Date.now(), actor, action, tenantId || null, String(target || '').slice(0, 200), typeof detail === 'string' ? detail.slice(0, 1000) : JSON.stringify(detail || '').slice(0, 1000)]);
  }

  // ---------- Slugs ----------
  async function checkSlug(raw, { except } = {}) {
    const slug = clean(raw, 40).toLowerCase();
    const problem = slugProblem(slug);
    if (problem) throw fail(400, problem === 'reserved' ? 'SLUG_RESERVED' : 'INVALID_SLUG');
    const taken = (await db.query('SELECT id FROM saas_tenants WHERE slug=$1', [slug]))[0];
    if (taken && taken.id !== except) throw fail(409, 'SLUG_TAKEN');
    const retired = (await db.query('SELECT value FROM saas_kv WHERE key=$1', [`retired_slug:${slug}`]))[0];
    if (retired && Number(retired.value) > Date.now() && !except) throw fail(409, 'SLUG_RETIRED');
    return slug;
  }
  const retireSlug = (q, slug) => q('INSERT INTO saas_kv(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [`retired_slug:${slug}`, String(Date.now() + RETIRE_MS)]);

  // ---------- Tenants ----------
  const urls = row => ({ path: row.kind === 'default' ? '/' : `/${row.slug}`, adminPath: row.kind === 'default' ? '/admin' : `/${row.slug}/admin` });
  const tenantView = row => ({
    id: row.id, slug: row.slug, name: row.name, kind: row.kind, status: row.status, plan: row.plan, ownerEmail: row.owner_email,
    sourceDemoId: row.source_demo_id, sourceDemoVersion: num(row.source_demo_version), notes: row.notes,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), suspendedAt: num(row.suspended_at), ...urls(row),
    ...(row.clients !== undefined ? { counts: { clients: row.clients, requests: row.requests, admins: row.admins, domains: row.domains, openRequests: row.open_requests } } : {}),
  });
  const getTenantRow = async id => {
    if (!TENANT_ID.test(String(id))) throw fail(404, 'NOT_FOUND');
    const row = (await db.query('SELECT * FROM saas_tenants WHERE id=$1', [id]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    return row;
  };
  async function listTenants(kinds) {
    const rows = await db.query(`SELECT t.*,
      (SELECT COUNT(*) FROM clients c WHERE c.tenant_id=t.id)::int AS clients, (SELECT COUNT(*) FROM requests r WHERE r.tenant_id=t.id)::int AS requests,
      (SELECT COUNT(*) FROM admin_accounts a WHERE a.tenant_id=t.id)::int AS admins, (SELECT COUNT(*) FROM saas_domains d WHERE d.tenant_id=t.id)::int AS domains,
      (SELECT COUNT(*) FROM saas_requests q WHERE q.tenant_id=t.id AND q.status IN ('open','in_progress'))::int AS open_requests
      FROM saas_tenants t WHERE t.kind = ANY($1) ORDER BY t.created_at, t.id`, [kinds]);
    return rows.map(tenantView);
  }

  /** Adds an administrator to a tenant. Returns the generated password when none was given (shown once, never stored in clear). */
  async function addAdmin(q, tenantId, { email, name, password, phone = '', title = '', pwHash }) {
    const address = clean(email, 254).toLowerCase();
    if (!EMAIL.test(address)) throw fail(400, 'INVALID_EMAIL');
    let generated = null, stored = pwHash;
    if (!stored) {
      let value = typeof password === 'string' && password ? password : '';
      if (value) { const problem = passwordProblem(value, { email: address }); if (problem) throw fail(400, problem); } else value = generated = randomPassword();
      stored = hashPassword(value);
    }
    const now = Date.now();
    try {
      await q('INSERT INTO admin_accounts(tenant_id,admin_id,name,email,phone,title,pw_hash,pw_changed_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8)', [tenantId, address, clean(name, 80), address, phone, title, stored, now]);
    } catch (error) { if (/duplicate key|unique/i.test(String(error.message))) throw fail(409, 'ADMIN_EXISTS'); throw error; }
    return { id: address, email: address, password: generated };
  }

  async function createTenant(body, actor, { kind = 'instance' } = {}) {
    const name = clean(body?.name, 80);
    if (name.length < 2) throw fail(400, 'INVALID_NAME');
    const slug = await checkSlug(body?.slug);
    const status = body?.status === undefined ? 'active' : body.status;
    if (!TENANT_STATUS.includes(status)) throw fail(400, 'INVALID_STATUS');
    const ownerEmail = clean(body?.ownerEmail, 254).toLowerCase();
    if (!EMAIL.test(ownerEmail)) throw fail(400, 'INVALID_EMAIL');
    const id = newId('t'), now = Date.now();
    let admin;
    await db.tx(async q => {
      try {
        await q('INSERT INTO saas_tenants(id,slug,name,kind,status,plan,owner_email,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)', [id, slug, name, kind, status, clean(body?.plan, 40), ownerEmail, clean(body?.notes, 1000), now]);
      } catch (error) { if (/duplicate key|unique/i.test(String(error.message))) throw fail(409, 'SLUG_TAKEN'); throw error; }
      admin = await addAdmin(q, id, { email: ownerEmail, name: body?.ownerName, password: body?.password });
    });
    await bundles.get(id).content.ensureSeed(); // starter content now, so the tenant is complete from its first visit
    tenants.invalidate();
    await audit(actor, `tenant.create`, id, slug, { kind, owner: ownerEmail });
    return { tenant: tenantView(await getTenantRow(id)), admin };
  }

  async function updateTenant(id, body, actor) {
    const row = await getTenantRow(id);
    const next = {};
    if (body.name !== undefined) { next.name = clean(body.name, 80); if (next.name.length < 2) throw fail(400, 'INVALID_NAME'); }
    if (body.plan !== undefined) next.plan = clean(body.plan, 40);
    if (body.notes !== undefined) next.notes = clean(body.notes, 1000);
    if (body.ownerEmail !== undefined) { next.owner_email = clean(body.ownerEmail, 254).toLowerCase(); if (next.owner_email && !EMAIL.test(next.owner_email)) throw fail(400, 'INVALID_EMAIL'); }
    if (body.status !== undefined) {
      if (!TENANT_STATUS.includes(body.status)) throw fail(400, 'INVALID_STATUS');
      if (row.status === 'suspended') throw fail(409, 'USE_UNSUSPEND');
      next.status = body.status;
    }
    if (body.slug !== undefined && body.slug !== row.slug) {
      if (row.kind === 'default') throw fail(400, 'DEFAULT_TENANT_PROTECTED');
      next.slug = await checkSlug(body.slug, { except: id });
    }
    const keys = Object.keys(next);
    if (!keys.length) return tenantView(row);
    await db.tx(async q => {
      if (next.slug) await retireSlug(q, row.slug);
      try { await q(`UPDATE saas_tenants SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map(k => next[k]), Date.now(), id]); }
      catch (error) { if (/duplicate key|unique/i.test(String(error.message))) throw fail(409, 'SLUG_TAKEN'); throw error; }
    });
    tenants.invalidate();
    await audit(actor, 'tenant.update', id, row.slug, Object.fromEntries(keys.map(k => [k, k === 'notes' ? '(edited)' : next[k]])));
    return tenantView(await getTenantRow(id));
  }

  async function setSuspended(id, suspended, actor) {
    const row = await getTenantRow(id);
    if (row.kind === 'default') throw fail(400, 'DEFAULT_TENANT_PROTECTED');
    const now = Date.now();
    await db.query(suspended ? "UPDATE saas_tenants SET status='suspended', suspended_at=$1, updated_at=$1 WHERE id=$2" : "UPDATE saas_tenants SET status='active', suspended_at=NULL, updated_at=$1 WHERE id=$2", suspended ? [now, id] : [now, id]);
    tenants.invalidate();
    await audit(actor, suspended ? 'tenant.suspend' : 'tenant.unsuspend', id, row.slug, '');
    return tenantView(await getTenantRow(id));
  }

  /** Deletes one tenant and everything it owns. Files in object storage are removed best-effort. Returns what was purged. */
  async function deleteTenantData(row) {
    let purged = 0;
    if (storage && row.kind !== 'default') {
      const key = keyFor(row.id);
      for (const media of await db.query("SELECT id,mime FROM media WHERE tenant_id=$1 AND storage='r2'", [row.id])) {
        try { await storage.remove(key(`${media.id}.${EXT[media.mime]}`)); purged++; } catch { /* kept: a later purge can remove the prefix */ }
      }
    }
    await db.tx(async q => {
      for (const table of [...DELETE_ORDER, ...TENANT_TABLES.filter(t => !DELETE_ORDER.includes(t))]) await q(`DELETE FROM ${table} WHERE tenant_id=$1`, [row.id]);
      await q('DELETE FROM saas_domains WHERE tenant_id=$1', [row.id]);
      await q('DELETE FROM saas_requests WHERE tenant_id=$1', [row.id]);
      await q('DELETE FROM saas_assignments WHERE tenant_id=$1', [row.id]);
      await q('DELETE FROM saas_demos WHERE tenant_id=$1', [row.id]);
      await q('DELETE FROM saas_kv WHERE key=$1', [`demo_sample:${row.id}`]);
      await q('DELETE FROM saas_tenants WHERE id=$1', [row.id]);
      await retireSlug(q, row.slug);
    });
    bundles.drop(row.id);
    tenants.invalidate();
    return { purgedFiles: purged };
  }
  async function deleteTenant(id, body, actor) {
    const row = await getTenantRow(id);
    if (row.kind === 'default') throw fail(400, 'DEFAULT_TENANT_PROTECTED');
    if (row.kind === 'demo') throw fail(409, 'USE_DEMO_DELETE');
    if (body?.confirmSlug !== row.slug) throw fail(400, 'CONFIRM_SLUG');
    const result = await deleteTenantData(row);
    await audit(actor, 'tenant.delete', id, row.slug, result);
    return { ok: true, ...result };
  }

  // ---------- Tenant administrators ----------
  const adminView = row => ({ id: row.admin_id, name: row.name, email: row.email, phone: row.phone, title: row.title, disabled: !!row.disabled, hasPassword: !!row.pw_hash, lastLoginAt: num(row.last_login_at), createdAt: Number(row.created_at) });
  const getAdminRow = async (tenantId, adminId) => {
    const row = (await db.query('SELECT * FROM admin_accounts WHERE tenant_id=$1 AND admin_id=$2', [tenantId, String(adminId).toLowerCase()]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    return row;
  };
  const dropAdminSessions = (q, tenantId, adminId) => q('DELETE FROM admin_sessions WHERE tenant_id=$1 AND admin_id=$2', [tenantId, adminId]);
  const adminOps = {
    async list(tenantId) { await getTenantRow(tenantId); return (await db.query('SELECT * FROM admin_accounts WHERE tenant_id=$1 ORDER BY created_at, admin_id', [tenantId])).map(adminView); },
    async create(tenantId, body, actor) {
      await getTenantRow(tenantId);
      const created = await addAdmin(db.query, tenantId, body || {});
      await audit(actor, 'admin.create', tenantId, created.email, '');
      return { admin: adminView(await getAdminRow(tenantId, created.id)), password: created.password };
    },
    async update(tenantId, adminId, body, actor) {
      await getTenantRow(tenantId);
      const row = await getAdminRow(tenantId, adminId);
      const next = {};
      if (body.name !== undefined) next.name = clean(body.name, 80);
      if (body.email !== undefined) {
        const email = clean(body.email, 254).toLowerCase();
        if (!EMAIL.test(email)) throw fail(400, 'INVALID_EMAIL');
        next.email = email;
      }
      if (body.disabled !== undefined) next.disabled = body.disabled ? 1 : 0;
      const keys = Object.keys(next);
      if (keys.length) {
        try { await db.query(`UPDATE admin_accounts SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE tenant_id=$${keys.length + 2} AND admin_id=$${keys.length + 3}`, [...keys.map(k => next[k]), Date.now(), tenantId, row.admin_id]); }
        catch (error) { if (/duplicate key|unique/i.test(String(error.message))) throw fail(409, 'EMAIL_TAKEN'); throw error; }
        if (next.disabled) await dropAdminSessions(db.query, tenantId, row.admin_id);
        await audit(actor, 'admin.update', tenantId, row.admin_id, Object.keys(next).join(','));
      }
      return adminView(await getAdminRow(tenantId, row.admin_id));
    },
    async resetPassword(tenantId, adminId, body, actor) {
      await getTenantRow(tenantId);
      const row = await getAdminRow(tenantId, adminId);
      let value = typeof body?.password === 'string' && body.password ? body.password : '', generated = null;
      if (value) { const problem = passwordProblem(value, { username: row.admin_id, email: row.email }); if (problem) throw fail(400, problem); } else value = generated = randomPassword();
      await db.query('UPDATE admin_accounts SET pw_hash=$1, pw_changed_at=$2, updated_at=$2 WHERE tenant_id=$3 AND admin_id=$4', [hashPassword(value), Date.now(), tenantId, row.admin_id]);
      await dropAdminSessions(db.query, tenantId, row.admin_id); // every device is signed out
      await audit(actor, 'admin.password_reset', tenantId, row.admin_id, '');
      return { ok: true, password: generated };
    },
    async remove(tenantId, adminId, actor) {
      await getTenantRow(tenantId);
      const row = await getAdminRow(tenantId, adminId);
      await db.tx(async q => {
        await dropAdminSessions(q, tenantId, row.admin_id);
        await q('DELETE FROM admin_prefs WHERE tenant_id=$1 AND admin_id=$2', [tenantId, row.admin_id]);
        await q("DELETE FROM subscriptions WHERE tenant_id=$1 AND owner_type='admin' AND owner_id=$2", [tenantId, row.admin_id]);
        await q('DELETE FROM admin_accounts WHERE tenant_id=$1 AND admin_id=$2', [tenantId, row.admin_id]);
      });
      await audit(actor, 'admin.delete', tenantId, row.admin_id, '');
      return { ok: true };
    },
  };

  // ---------- Demos (template tenants) ----------
  const slugify = text => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const contentVersion = async tenantId => Number((await db.query("SELECT version FROM sync_state WHERE tenant_id=$1 AND key='content'", [tenantId]))[0]?.version ?? 0);
  const demoView = async row => ({
    id: row.id, name: row.name, description: row.description, status: row.status, tenantId: row.tenant_id, slug: row.slug,
    version: await contentVersion(row.tenant_id), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    assignments: row.assignments ?? 0, path: `/${row.slug}`, adminPath: `/${row.slug}/admin`,
  });
  const DEMO_SQL = 'SELECT d.*, t.slug, (SELECT COUNT(*) FROM saas_assignments a WHERE a.demo_id=d.id)::int AS assignments FROM saas_demos d JOIN saas_tenants t ON t.id=d.tenant_id';
  const getDemoRow = async id => {
    const row = (await db.query(`${DEMO_SQL} WHERE d.id=$1`, [String(id)]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    return row;
  };

  /** A handful of clients and requests so the demo's dashboard is not empty. Their ids are recorded: ONLY these are copied to instances. */
  async function seedSample(tenantId) {
    const tools = (await db.query("SELECT id FROM content_items WHERE tenant_id=$1 AND coll='tools' ORDER BY id LIMIT 4", [tenantId])).map(row => row.id);
    const now = Date.now();
    const people = [['Salma Benali', '+212600000101', 3], ['Youssef Amrani', '+212600000102', 1], ['Nadia El Idrissi', '+212600000103', 5], ['Karim Tazi', '+212600000104', 0]];
    const clientIds = [], requestIds = [];
    await db.tx(async q => {
      for (const [index, [name, phone, credits]] of people.entries()) {
        const id = crypto.randomUUID();
        await q('INSERT INTO clients(tenant_id,id,phone,name,credits,free_used,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [tenantId, id, phone, name, credits, index % 2, now - (index + 1) * 86400000]);
        clientIds.push(id);
      }
      const prompts = ['Warm Moroccan living room with zellige tiles', 'Minimal bedroom, natural light, linen', 'Bright kitchen with open shelves', 'Modern salon, green and gold accents', 'Small balcony turned into a reading nook'];
      for (let index = 0; index < prompts.length; index++) {
        const owner = clientIds[index % clientIds.length], person = people[index % people.length];
        const request = { id: crypto.randomUUID(), userId: owner, name: person[0], whatsapp: person[1], status: ['pending', 'processing', 'delivered'][index % 3], createdAt: now - (index + 1) * 3600000 * 5, photoUri: '', draft: { ...(tools.length ? { toolId: tools[index % tools.length] } : { toolId: 'sample' }), source: 'text', prompt: prompts[index] } };
        await q('INSERT INTO requests(tenant_id,id,user_id,client_request_id,created_at,data) VALUES($1,$2,$3,NULL,$4,$5)', [tenantId, request.id, owner, request.createdAt, JSON.stringify(request)]);
        requestIds.push(request.id);
      }
      await q('INSERT INTO saas_kv(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [`demo_sample:${tenantId}`, JSON.stringify({ clients: clientIds, requests: requestIds })]);
    });
    await bundles.get(tenantId).sync.bump('clients', 'requests');
  }

  async function createDemo(body, actor) {
    const name = clean(body?.name, 80);
    if (name.length < 2) throw fail(400, 'INVALID_NAME');
    const base = slugify(body?.slug || `demo-${name}`);
    let slug = base;
    // A demo name is free text, so a taken slug is not an error: add a short suffix until one is available.
    for (let tries = 0; ; tries++) {
      try { slug = await checkSlug(slug); break; } catch (error) { if (tries > 5 || !['SLUG_TAKEN', 'SLUG_RETIRED'].includes(error.message) || body?.slug) throw error; slug = `${base.slice(0, 34)}-${crypto.randomBytes(2).toString('hex')}`; }
    }
    const created = await createTenant({ name, slug, ownerEmail: `admin@${slug}.demo`, ownerName: `${name} demo admin` }, actor, { kind: 'demo' });
    const id = newId('d'), now = Date.now();
    await db.query('INSERT INTO saas_demos(id,name,description,tenant_id,status,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,$6,$6)', [id, name, clean(body?.description, 500), created.tenant.id, 'draft', now]);
    await seedSample(created.tenant.id);
    await audit(actor, 'demo.create', created.tenant.id, id, name);
    return { demo: await demoView(await getDemoRow(id)), admin: created.admin };
  }
  async function updateDemo(id, body, actor) {
    const row = await getDemoRow(id);
    const next = {};
    if (body.name !== undefined) { next.name = clean(body.name, 80); if (next.name.length < 2) throw fail(400, 'INVALID_NAME'); }
    if (body.description !== undefined) next.description = clean(body.description, 500);
    if (body.status !== undefined) { if (!DEMO_STATUS.includes(body.status)) throw fail(400, 'INVALID_STATUS'); next.status = body.status; }
    const keys = Object.keys(next);
    if (keys.length) {
      await db.query(`UPDATE saas_demos SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map(k => next[k]), Date.now(), row.id]);
      await audit(actor, 'demo.update', row.tenant_id, row.id, keys.join(','));
    }
    return demoView(await getDemoRow(row.id));
  }
  async function deleteDemo(id, body, actor) {
    const row = await getDemoRow(id);
    if (body?.confirmSlug !== row.slug) throw fail(400, 'CONFIRM_SLUG');
    // Only the template goes. Instances are independent tenants: the assignment rows keep `demo_id` as history.
    const result = await deleteTenantData(await getTenantRow(row.tenant_id));
    await audit(actor, 'demo.delete', row.tenant_id, row.id, row.name);
    return { ok: true, ...result };
  }

  /**
   * Assigns a demo: creates a NEW tenant whose data is a by-value copy of the template, in one transaction. After this the two share
   * nothing (no key, reference or row), so an instance edit can only touch its own tenant_id and the template is never modified.
   * owner: { email, name?, password? } (a new administrator) or { tenantId, adminId } (re-use an existing administrator's profile + password).
   */
  async function assignDemo(demoId, body, actor) {
    const demo = await getDemoRow(demoId);
    const template = await getTenantRow(demo.tenant_id);
    const name = clean(body?.name || demo.name, 80);
    if (name.length < 2) throw fail(400, 'INVALID_NAME');
    const slug = await checkSlug(body?.slug);
    // The owner: validated before anything is created.
    let owner;
    if (body?.owner?.tenantId) {
      const source = await getAdminRow((await getTenantRow(body.owner.tenantId)).id, body.owner.adminId);
      if (!EMAIL.test(source.email)) throw fail(400, 'OWNER_EMAIL_REQUIRED');
      owner = { email: source.email, name: source.name, phone: source.phone, title: source.title, pwHash: source.pw_hash || undefined };
    } else {
      owner = { email: body?.owner?.email, name: body?.owner?.name, password: body?.owner?.password };
      if (!EMAIL.test(clean(owner.email, 254).toLowerCase())) throw fail(400, 'INVALID_EMAIL');
    }
    const tenantId = newId('t'), now = Date.now();
    const version = await contentVersion(template.id);
    // Files: R2 keys carry the tenant id, so each instance gets its own copy of the template's objects (content-addressed, copied once).
    const mediaRows = await db.query("SELECT id,mime,storage FROM media WHERE tenant_id=$1 AND storage IN ('r2','db')", [template.id]);
    if (storage) {
      const from = keyFor(template.id), to = keyFor(tenantId);
      for (const row of mediaRows.filter(row => row.storage === 'r2')) {
        const file = `${row.id}.${EXT[row.mime]}`;
        await storage.put(to(file), await storage.get(from(file)), row.mime);
      }
    }
    const sample = JSON.parse((await db.query('SELECT value FROM saas_kv WHERE key=$1', [`demo_sample:${template.id}`]))[0]?.value || '{"clients":[],"requests":[]}');
    let admin;
    await db.tx(async q => {
      await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); // one consistent picture of the template, even while it is being edited
      try {
        await q('INSERT INTO saas_tenants(id,slug,name,kind,status,plan,owner_email,source_demo_id,source_demo_version,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)',
          [tenantId, slug, name, 'instance', 'active', clean(body?.plan, 40), clean(owner.email, 254).toLowerCase(), demo.id, version, clean(body?.notes, 1000), now]);
      } catch (error) { if (/duplicate key|unique/i.test(String(error.message))) throw fail(409, 'SLUG_TAKEN'); throw error; }
      const ids = mediaRows.map(row => row.id);
      await q("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at) SELECT $2,id,mime,data,body,size,storage,created_at FROM media WHERE tenant_id=$1 AND id=ANY($3) AND storage IN ('r2','db')", [template.id, tenantId, ids]);
      await q("INSERT INTO content_items(tenant_id,coll,id,data,updated_at) SELECT $2,coll,id,data,updated_at FROM content_items WHERE tenant_id=$1 AND coll<>'models'", [template.id, tenantId]);
      // AI model entries hold provider API keys: the copy keeps the entry and drops the key.
      for (const row of await q("SELECT coll,id,data,updated_at FROM content_items WHERE tenant_id=$1 AND coll='models'", [template.id])) {
        const item = JSON.parse(row.data);
        if ('apiKey' in item) item.apiKey = '';
        await q('INSERT INTO content_items(tenant_id,coll,id,data,updated_at) VALUES($1,$2,$3,$4,$5)', [tenantId, row.coll, row.id, JSON.stringify(item), row.updated_at]);
      }
      await q('INSERT INTO content_docs(tenant_id,name,data,updated_at) SELECT $2,name,data,updated_at FROM content_docs WHERE tenant_id=$1', [template.id, tenantId]);
      await q('INSERT INTO settings(tenant_id,key,value) SELECT $2,key,value FROM settings WHERE tenant_id=$1 AND key=ANY($3)', [template.id, tenantId, COPIED_SETTINGS]);
      // Sample clients / requests get NEW ids; requests are re-pointed to the new client ids and lose every device or idempotency link.
      const map = new Map();
      for (const row of await q('SELECT * FROM clients WHERE tenant_id=$1 AND id=ANY($2)', [template.id, sample.clients])) {
        const id = crypto.randomUUID();
        map.set(row.id, id);
        await q('INSERT INTO clients(tenant_id,id,phone,name,free_used,credits,created_at,blocked,prefs) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8)', [tenantId, id, row.phone, row.name, row.free_used, row.credits, row.created_at, '{}']);
      }
      for (const row of await q('SELECT * FROM requests WHERE tenant_id=$1 AND id=ANY($2)', [template.id, sample.requests])) {
        const data = JSON.parse(row.data), id = crypto.randomUUID(), userId = map.get(row.user_id);
        if (!userId) continue;
        delete data.clientHash; delete data.clientRequestId;
        await q('INSERT INTO requests(tenant_id,id,user_id,client_request_id,created_at,data) VALUES($1,$2,$3,NULL,$4,$5)', [tenantId, id, userId, row.created_at, JSON.stringify({ ...data, id, userId })]);
      }
      admin = await addAdmin(q, tenantId, owner);
      await q('INSERT INTO saas_assignments(id,demo_id,tenant_id,owner_email,demo_version,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [newId('as'), demo.id, tenantId, admin.email, version, now, actor]);
    });
    await bundles.get(tenantId).sync.bump('content', 'clients', 'requests');
    tenants.invalidate();
    await audit(actor, 'demo.assign', tenantId, demo.id, { slug, owner: admin.email, version });
    return { tenant: tenantView(await getTenantRow(tenantId)), admin, demoId: demo.id };
  }
  async function listAssignments(demoId) {
    const demo = await getDemoRow(demoId);
    return (await db.query('SELECT a.id, a.tenant_id, a.owner_email, a.demo_version, a.created_at, a.created_by, t.slug, t.name, t.status FROM saas_assignments a LEFT JOIN saas_tenants t ON t.id=a.tenant_id WHERE a.demo_id=$1 ORDER BY a.created_at DESC', [demo.id]))
      .map(row => ({ id: row.id, tenantId: row.tenant_id, slug: row.slug, name: row.name, status: row.status, ownerEmail: row.owner_email, demoVersion: Number(row.demo_version), createdAt: Number(row.created_at), createdBy: row.created_by, path: `/${row.slug}`, adminPath: `/${row.slug}/admin` }));
  }

  // ---------- Change requests ----------
  const requestView = row => ({ id: row.id, tenantId: row.tenant_id, tenantSlug: row.slug ?? null, tenantName: row.tenant_name ?? null, tenantKind: row.kind_of ?? null, adminId: row.admin_id, kind: row.kind, title: row.title, body: row.body, status: row.status, response: row.response, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });
  const REQUEST_SQL = 'SELECT q.*, t.slug, t.name AS tenant_name, t.kind AS kind_of FROM saas_requests q LEFT JOIN saas_tenants t ON t.id=q.tenant_id';
  /** What a TENANT sees: its own requests only (the tenant id is a parameter taken from the resolved tenant, never from the request). */
  const requestsOfTenant = async tenantId => (await db.query('SELECT * FROM saas_requests WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200', [tenantId])).map(requestView);
  async function submitRequest(tenant, adminId, body) {
    if (tenant.kind === 'demo') throw fail(403, 'DEMO_CANNOT_REQUEST');
    const kind = body?.kind === undefined ? 'customize' : body.kind;
    if (!REQUEST_KINDS.includes(kind)) throw fail(400, 'INVALID_KIND');
    const title = clean(body?.title, 120), text = clean(body?.body, 4000).replace(/\s+$/, '');
    if (title.length < 3 || text.length < 3) throw fail(400, 'INVALID_REQUEST');
    const open = Number((await db.query("SELECT COUNT(*) AS n FROM saas_requests WHERE tenant_id=$1 AND status IN ('open','in_progress')", [tenant.id]))[0].n);
    if (open >= 20) throw fail(429, 'TOO_MANY_OPEN_REQUESTS');
    const id = newId('rq'), now = Date.now();
    await db.query('INSERT INTO saas_requests(id,tenant_id,admin_id,kind,title,body,status,response,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)', [id, tenant.id, adminId, kind, title, text, 'open', '', now]);
    await audit(adminId, 'request.create', tenant.id, id, title);
    return requestView((await db.query('SELECT * FROM saas_requests WHERE id=$1', [id]))[0]);
  }
  async function listRequests({ status, tenantId } = {}) {
    const where = [], params = [];
    if (status) { if (!REQUEST_STATUS.includes(status)) throw fail(400, 'INVALID_STATUS'); params.push(status); where.push(`q.status=$${params.length}`); }
    if (tenantId) { params.push(String(tenantId)); where.push(`q.tenant_id=$${params.length}`); }
    return (await db.query(`${REQUEST_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE q.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, q.created_at DESC LIMIT 300`, params)).map(requestView);
  }
  const getRequestRow = async id => {
    const row = (await db.query(`${REQUEST_SQL} WHERE q.id=$1`, [String(id)]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    return row;
  };
  async function updateRequest(id, body, actor) {
    const row = await getRequestRow(id);
    const next = {};
    if (body.status !== undefined) { if (!REQUEST_STATUS.includes(body.status)) throw fail(400, 'INVALID_STATUS'); next.status = body.status; }
    if (body.response !== undefined) next.response = clean(body.response, 4000);
    const keys = Object.keys(next);
    if (keys.length) {
      await db.query(`UPDATE saas_requests SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map(k => next[k]), Date.now(), row.id]);
      await audit(actor, 'request.update', row.tenant_id, row.id, next.status || 'response');
    }
    return requestView(await getRequestRow(row.id));
  }
  /**
   * Applies a change to the tenant that SUBMITTED the request. The target is `saas_requests.tenant_id` (a stored row), the payload has no tenant
   * field, the content modules used are that tenant's own bundle (tenant-bound database), and demo templates are refused.
   */
  async function applyRequest(id, body, actor) {
    const row = await getRequestRow(id);
    if (row.kind_of === 'demo' || !row.kind_of) throw fail(409, 'DEMO_PROTECTED');
    const tenant = await getTenantRow(row.tenant_id);
    if (tenant.kind === 'demo') throw fail(409, 'DEMO_PROTECTED');
    const docs = body?.docs && typeof body.docs === 'object' && !Array.isArray(body.docs) ? body.docs : {};
    const items = Array.isArray(body?.items) ? body.items : [];
    const remove = Array.isArray(body?.remove) ? body.remove : [];
    if (items.length > 200 || remove.length > 50 || Object.keys(docs).length > 8) throw fail(400, 'PAYLOAD_TOO_LARGE');
    if (!Object.keys(docs).length && !items.length && !remove.length) throw fail(400, 'NOTHING_TO_APPLY');
    const { content } = bundles.get(tenant.id);
    for (const [name, patch] of Object.entries(docs)) await content.patchDoc(name, patch);
    for (const item of items) await content.putItem(String(item?.coll), String(item?.id), item?.data);
    for (const entry of remove) await content.deleteItems(String(entry?.coll), entry?.ids);
    if (body?.markDone) await db.query("UPDATE saas_requests SET status='done', updated_at=$1 WHERE id=$2", [Date.now(), row.id]);
    await audit(actor, 'request.apply', tenant.id, row.id, { docs: Object.keys(docs), items: items.length, removed: remove.length });
    return { ok: true, tenantId: tenant.id, applied: { docs: Object.keys(docs), items: items.length, removed: remove.length } };
  }

  // ---------- Reports ----------
  async function stats() {
    const count = async (sql, params) => Number((await db.query(sql, params))[0].n);
    return {
      tenants: await count("SELECT COUNT(*) AS n FROM saas_tenants WHERE kind IN ('default','instance')"),
      active: await count("SELECT COUNT(*) AS n FROM saas_tenants WHERE kind IN ('default','instance') AND status<>'suspended'"),
      suspended: await count("SELECT COUNT(*) AS n FROM saas_tenants WHERE status='suspended'"),
      demos: await count('SELECT COUNT(*) AS n FROM saas_demos'),
      assignments: await count('SELECT COUNT(*) AS n FROM saas_assignments'),
      openRequests: await count("SELECT COUNT(*) AS n FROM saas_requests WHERE status IN ('open','in_progress')"),
      clients: await count('SELECT COUNT(*) AS n FROM clients'),
    };
  }
  async function auditLog({ tenantId, limit }) {
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = tenantId ? await db.query('SELECT * FROM saas_audit WHERE tenant_id=$1 ORDER BY at DESC LIMIT $2', [tenantId, n]) : await db.query('SELECT * FROM saas_audit ORDER BY at DESC LIMIT $1', [n]);
    return rows.map(row => ({ id: row.id, at: Number(row.at), actor: row.actor, action: row.action, tenantId: row.tenant_id, target: row.target, detail: row.detail }));
  }

  // ---------- HTTP ----------
  /**
   * `{ status, data, headers? }` for a request under /api/super-admin. Every route except login needs a super admin session; a tenant
   * admin or client token never matches (different table, cookie and header).
   */
  async function handle({ req, url, readBody, ip }) {
    const method = req.method, path = url.pathname.slice('/api/super-admin'.length) || '/';
    const ok = (data, status = 200, headers) => ({ status, data, headers });
    if (path === '/login' && method === 'POST') {
      const result = await login(ip, req.headers['user-agent'], await readBody(req));
      return ok({ ok: true, email: result.email, ...(req.headers['x-dwira-native'] === '1' ? { token: result.token } : {}) }, 200, { 'Set-Cookie': result.cookie });
    }
    if (!configured()) throw fail(503, 'SUPERADMIN_NOT_CONFIGURED');
    const me = await authenticate(req);
    if (!me) throw fail(401, 'Super admin login required');
    const actor = me.email;
    if (path === '/logout' && method === 'POST') { await db.query('DELETE FROM saas_super_sessions WHERE token_hash=$1', [sha(me.token)]); return ok({ ok: true }, 200, { 'Set-Cookie': clearCookie() }); }
    if (path === '/session' && method === 'GET') return ok({ ok: true, email: me.email });
    if (path === '/stats' && method === 'GET') return ok(await stats());
    if (path === '/audit' && method === 'GET') return ok(await auditLog({ tenantId: url.searchParams.get('tenant') || undefined, limit: url.searchParams.get('limit') }));

    let m;
    if (path === '/tenants') {
      if (method === 'GET') {
        const kinds = (url.searchParams.get('kind') || 'default,instance').split(',').filter(k => ['default', 'instance', 'demo'].includes(k));
        return ok(await listTenants(kinds.length ? kinds : ['default', 'instance']));
      }
      if (method === 'POST') return ok(await createTenant(await readBody(req), actor), 201);
    }
    if ((m = /^\/tenants\/([a-z0-9_-]+)$/.exec(path))) {
      if (method === 'GET') return ok(tenantView(await getTenantRow(m[1])));
      if (method === 'PATCH') return ok(await updateTenant(m[1], await readBody(req), actor));
      if (method === 'DELETE') return ok(await deleteTenant(m[1], await readBody(req), actor));
    }
    if ((m = /^\/tenants\/([a-z0-9_-]+)\/(suspend|unsuspend)$/.exec(path)) && method === 'POST') return ok(await setSuspended(m[1], m[2] === 'suspend', actor));
    if ((m = /^\/tenants\/([a-z0-9_-]+)\/admins$/.exec(path))) {
      if (method === 'GET') return ok(await adminOps.list(m[1]));
      if (method === 'POST') return ok(await adminOps.create(m[1], await readBody(req), actor), 201);
    }
    if ((m = /^\/tenants\/([a-z0-9_-]+)\/admins\/([^/]{3,254})$/.exec(path))) {
      const adminId = decodeURIComponent(m[2]);
      if (method === 'PATCH') return ok(await adminOps.update(m[1], adminId, await readBody(req), actor));
      if (method === 'DELETE') return ok(await adminOps.remove(m[1], adminId, actor));
    }
    if ((m = /^\/tenants\/([a-z0-9_-]+)\/admins\/([^/]{3,254})\/password$/.exec(path)) && method === 'POST') return ok(await adminOps.resetPassword(m[1], decodeURIComponent(m[2]), await readBody(req), actor));
    if ((m = /^\/tenants\/([a-z0-9_-]+)\/domains(?:\/(verify|remove))?$/.exec(path))) {
      const row = await getTenantRow(m[1]);
      if (!m[2] && method === 'GET') return ok(await tenants.domains.list(row.id));
      if (!m[2] && method === 'POST') { const view = await tenants.domains.add(row.id, (await readBody(req)).domain); await audit(actor, 'domain.add', row.id, view.domain, ''); return ok(view, 201); }
      if (m[2] === 'verify' && method === 'POST') { const body = await readBody(req); const view = await tenants.domains.verify(row.id, body.domain, { force: body.force === true }); await audit(actor, 'domain.verify', row.id, view.domain, body.force === true ? 'forced' : 'dns'); return ok(view); }
      if (m[2] === 'remove' && method === 'POST') { const body = await readBody(req); await tenants.domains.remove(row.id, body.domain); await audit(actor, 'domain.remove', row.id, String(body.domain), ''); return ok({ ok: true }); }
    }
    if (path === '/demos') {
      if (method === 'GET') return ok(await Promise.all((await db.query(`${DEMO_SQL} ORDER BY d.created_at DESC`)).map(demoView)));
      if (method === 'POST') return ok(await createDemo(await readBody(req), actor), 201);
    }
    if ((m = /^\/demos\/([a-z0-9_-]+)$/.exec(path))) {
      if (method === 'GET') return ok(await demoView(await getDemoRow(m[1])));
      if (method === 'PATCH') return ok(await updateDemo(m[1], await readBody(req), actor));
      if (method === 'DELETE') return ok(await deleteDemo(m[1], await readBody(req), actor));
    }
    if ((m = /^\/demos\/([a-z0-9_-]+)\/assign$/.exec(path)) && method === 'POST') return ok(await assignDemo(m[1], await readBody(req), actor), 201);
    if ((m = /^\/demos\/([a-z0-9_-]+)\/assignments$/.exec(path)) && method === 'GET') return ok(await listAssignments(m[1]));
    if (path === '/requests' && method === 'GET') return ok(await listRequests({ status: url.searchParams.get('status') || undefined, tenantId: url.searchParams.get('tenant') || undefined }));
    if ((m = /^\/requests\/([a-z0-9_-]+)$/.exec(path)) && method === 'PATCH') return ok(await updateRequest(m[1], await readBody(req), actor));
    if ((m = /^\/requests\/([a-z0-9_-]+)\/apply$/.exec(path)) && method === 'POST') return ok(await applyRequest(m[1], await readBody(req), actor));
    throw fail(404, 'API route not found');
  }

  return { handle, authenticate, configured, submitRequest, requestsOfTenant, createTenant, assignDemo, createDemo, deleteTenant, setSuspended, listTenants, stats, audit };
}

module.exports = { createSuperAdmin, COPIED_SETTINGS };
