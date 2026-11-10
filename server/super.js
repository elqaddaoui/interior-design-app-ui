/**
 * Super Admin: platform owner authentication and the /api/super/* routes.
 *
 * Credentials, in order of precedence:
 *   1. the password changed from the panel (stored as a salted scrypt hash in `settings.super_admin`)
 *   2. SUPER_ADMIN_USER (default "superadmin") + SUPER_ADMIN_PASSWORD_HASH (same `salt:hex` format as ADMIN_PASSWORD_HASH)
 *   3. the built-in default superadmin / superadmin, unless DISABLE_DEFAULT_SUPERADMIN=true
 *
 * Sessions are random tokens stored hashed in `super_sessions` (12 h), sent as the HttpOnly cookie `dwira_super` (browsers) or as a
 * Bearer token (native app). Every mutation is written to the audit log.
 */
const crypto = require('node:crypto');
const access = require('./access');

const SESSION_MS = 12 * 3600000;
const fail = (status, message) => Object.assign(new Error(message), { status });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const cleanId = value => { if (!ID.test(value || '')) throw fail(404, 'NOT_FOUND'); return value; };

function createSuper({ db, platform, clients, sync, env = process.env }) {
  const readStored = async () => { try { return JSON.parse((await db.query("SELECT value FROM settings WHERE key='super_admin'"))[0]?.value || 'null'); } catch { return null; } };

  /** { user, kind: 'stored' | 'env' | 'default' | 'none' } and a matcher for one attempt. */
  async function verifyLogin(username, password) {
    const user = String(username || '').trim().toLowerCase();
    const stored = await readStored();
    if (stored?.hash) return same(user, stored.user) && platform.verifyPassword(password, stored.hash) ? stored.user : null;
    if (env.SUPER_ADMIN_PASSWORD_HASH) return same(user, String(env.SUPER_ADMIN_USER || 'superadmin').toLowerCase()) && platform.verifyPassword(password, env.SUPER_ADMIN_PASSWORD_HASH) ? user : null;
    if (env.DISABLE_DEFAULT_SUPERADMIN !== 'true' && same(user, 'superadmin') && same(password, 'superadmin')) return 'superadmin';
    return null;
  }
  const usingDefault = async () => !(await readStored())?.hash && !env.SUPER_ADMIN_PASSWORD_HASH && env.DISABLE_DEFAULT_SUPERADMIN !== 'true';

  async function session(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = (await db.query('SELECT token_hash FROM super_sessions WHERE token_hash=$1 AND expires_at>$2', [hash(token), Date.now()]))[0];
    return row || null;
  }
  const actorName = async () => (await readStored())?.user || String(env.SUPER_ADMIN_USER || 'superadmin').toLowerCase();

  const clientOut = row => ({ id: row.id, name: row.name, whatsapp: row.phone, credits: Number(row.credits) + (row.free_used ? 0 : 1), blocked: !!row.blocked, tenantId: row.tenant_id, createdAt: Number(row.created_at), lastSeen: row.last_seen == null ? null : Number(row.last_seen) });
  async function listClients({ tenantId, q, limit, offset }) {
    const where = [], params = [];
    if (tenantId) { params.push(tenantId); where.push('c.tenant_id=$' + params.length); }
    if (q) { params.push('%' + String(q).slice(0, 80).replace(/[%_\\]/g, '\\$&') + '%'); where.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`); }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = Number((await db.query(`SELECT COUNT(*) AS n FROM clients c ${clause}`, params))[0].n);
    const lim = Math.max(1, Math.min(200, Number(limit) || 50)), off = Math.max(0, Number(offset) || 0);
    const rows = await db.query(`SELECT c.id,c.name,c.phone,c.credits,c.free_used,c.blocked,c.tenant_id,c.created_at,c.last_seen FROM clients c ${clause} ORDER BY c.created_at DESC LIMIT ${lim} OFFSET ${off}`, params);
    return { total, items: rows.map(clientOut) };
  }

  /**
   * Handles one /api/super/* request. `ctx` carries the per-request helpers from server/index.js:
   * { req, res, url, json, readBody, cookie, token } where `token` is the Bearer token or `dwira_super` cookie.
   */
  async function handle({ req, res, url, json, readBody, cookie, token }) {
    const route = url.pathname.slice('/api/super/'.length).replace(/\/+$/, '').split('/');
    const method = req.method, [head, id, action] = route;
    await platform.ensureReady();

    if (head === 'login' && method === 'POST') {
      const body = await readBody(req);
      const user = typeof body.username === 'string' && typeof body.password === 'string' && body.password.length <= 512 ? await verifyLogin(body.username, body.password) : null;
      if (!user) { await platform.log('anonymous', 'super.login_failed', { type: 'super' }, { username: String(body?.username || '').slice(0, 40) }); throw fail(401, 'Invalid credentials'); }
      const fresh = crypto.randomBytes(32).toString('hex'), now = Date.now();
      await db.query('DELETE FROM super_sessions WHERE expires_at<=$1', [now]);
      await db.query('INSERT INTO super_sessions(token_hash,expires_at,created_at) VALUES($1,$2,$3)', [hash(fresh), now + SESSION_MS, now]);
      res.setHeader('Set-Cookie', cookie('dwira_super', fresh, SESSION_MS / 1000));
      await platform.log(user, 'super.login', { type: 'super' });
      return json(200, { ok: true, user: { username: user }, defaultCredentials: await usingDefault(), ...(req.headers['x-dwira-native'] === '1' ? { token: fresh } : {}) });
    }
    if (head === 'logout' && method === 'POST') {
      if (token) await db.query('DELETE FROM super_sessions WHERE token_hash=$1', [hash(token)]);
      res.setHeader('Set-Cookie', cookie('dwira_super', '', 0));
      return json(200, { ok: true });
    }

    // Everything below needs a valid Super Admin session.
    if (!(await session(token))) throw fail(401, 'Super admin login required');
    const actor = await actorName();
    const audit = (action, target, detail) => platform.log(actor, action, target, detail);

    if (head === 'session' && method === 'GET') return json(200, { ok: true, user: { username: actor }, defaultCredentials: await usingDefault() });
    if (head === 'catalog' && method === 'GET') return json(200, { features: access.FEATURES, groups: access.GROUPS, levels: access.LEVELS, systemRoles: access.SYSTEM_ROLES.map(role => ({ id: role.id, name: role.name })) });
    if (head === 'overview' && method === 'GET') return json(200, await platform.overview(Number(url.searchParams.get('days')) || 30));

    if (head === 'password' && method === 'POST') {
      const body = await readBody(req);
      if (typeof body.current !== 'string' || typeof body.next !== 'string' || body.next.length < 10 || body.next.length > 200) throw fail(400, 'WEAK_PASSWORD');
      if (!(await verifyLogin(actor, body.current))) throw fail(403, 'WRONG_PASSWORD');
      const user = typeof body.username === 'string' && /^[a-z0-9][a-z0-9._-]{2,40}$/i.test(body.username.trim()) ? body.username.trim().toLowerCase() : actor;
      await db.query("INSERT INTO settings(key,value) VALUES('super_admin',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify({ user, hash: platform.hashPassword(body.next) })]);
      // Every other session is signed out; the caller keeps working.
      await db.query('DELETE FROM super_sessions WHERE token_hash<>$1', [hash(token)]);
      await audit('super.password_changed', { type: 'super', id: user });
      return json(200, { ok: true, user: { username: user }, defaultCredentials: false });
    }

    /* ---- tenants ---- */
    if (head === 'tenants') {
      if (!id) {
        if (method === 'GET') return json(200, await platform.listTenants());
        if (method === 'POST') {
          const body = await readBody(req), created = await platform.createTenant(body);
          const out = [];
          // Optionally create the first admin together with the tenant (one call from the "new tenant" form).
          if (body.owner && typeof body.owner === 'object') {
            try { out.push(await platform.createAccount({ ...body.owner, tenantId: created, roleId: body.owner.roleId || 'role_owner' })); }
            catch (error) { await platform.removeTenant(created); throw error; }
            await audit('account.create', { type: 'account', id: out[0], tenantId: created }, { username: body.owner.username, roleId: body.owner.roleId || 'role_owner' });
          }
          await audit('tenant.create', { type: 'tenant', id: created, tenantId: created }, { name: body.name, planId: body.planId || null });
          return json(201, await platform.getTenant(created));
        }
        throw fail(405, 'Method not allowed');
      }
      cleanId(id);
      if (!action) {
        if (method === 'GET') return json(200, await platform.getTenant(id));
        if (method === 'PATCH') {
          const body = await readBody(req), result = await platform.updateTenant(id, body);
          await audit(result.before.status !== result.after.status ? (result.after.status === 'suspended' ? 'tenant.suspend' : 'tenant.activate') : 'tenant.update', { type: 'tenant', id, tenantId: id }, { fields: Object.keys(body), ...result });
          // Suspension takes effect at once: signed-in tenant admins are signed out.
          if (body.status === 'suspended') await db.query('DELETE FROM admin_sessions WHERE tenant_id=$1', [id]);
          await sync.bump('clients', 'requests', 'platform');
          return json(200, await platform.getTenant(id));
        }
        if (method === 'DELETE') {
          const body = await readBody(req).catch(() => ({}));
          const tenant = await platform.getTenant(id);
          if (body.confirm !== tenant.slug) throw fail(400, 'CONFIRMATION_REQUIRED');
          const removed = await platform.removeTenant(id);
          await audit('tenant.delete', { type: 'tenant', id, tenantId: null }, removed);
          await sync.bump('clients', 'requests', 'campaigns', 'platform');
          return json(200, { ok: true, ...removed });
        }
        throw fail(405, 'Method not allowed');
      }
      if (action === 'impersonate' && method === 'POST') {
        // "Open the tenant panel": a one-hour owner session for that tenant, recorded in the audit log.
        const tenant = await platform.getTenant(id);
        if (tenant.status !== 'active') throw fail(409, 'TENANT_SUSPENDED');
        const fresh = crypto.randomBytes(32).toString('hex'), now = Date.now();
        await db.query('INSERT INTO admin_sessions(token_hash,expires_at,admin_id,account_id,tenant_id) VALUES($1,$2,$3,NULL,$4)', [hash(fresh), now + 3600000, `super:${id}`, id]);
        res.setHeader('Set-Cookie', cookie('dwira_admin', fresh, 3600));
        await audit('tenant.impersonate', { type: 'tenant', id, tenantId: id });
        return json(200, { ok: true, ...(req.headers['x-dwira-native'] === '1' ? { token: fresh } : {}) });
      }
      throw fail(404, 'NOT_FOUND');
    }

    /* ---- admin accounts ---- */
    if (head === 'accounts') {
      if (!id) {
        if (method === 'GET') return json(200, await platform.listAccounts({ tenantId: url.searchParams.get('tenantId') || undefined }));
        if (method === 'POST') {
          const body = await readBody(req), created = await platform.createAccount(body);
          await audit('account.create', { type: 'account', id: created, tenantId: body.tenantId }, { username: String(body.username).toLowerCase(), roleId: body.roleId });
          return json(201, (await platform.listAccounts()).find(a => a.id === created));
        }
        throw fail(405, 'Method not allowed');
      }
      cleanId(id);
      if (!action) {
        if (method === 'PATCH') {
          const body = await readBody(req), result = await platform.updateAccount(id, body);
          await audit(body.status && result.before.status !== result.after.status ? (result.after.status === 'suspended' ? 'account.suspend' : 'account.activate') : 'account.update', { type: 'account', id, tenantId: result.tenantId }, { fields: Object.keys(body), ...result });
          await sync.bump('platform');
          return json(200, (await platform.listAccounts()).find(a => a.id === id));
        }
        if (method === 'DELETE') {
          const removed = await platform.removeAccount(id);
          await audit('account.delete', { type: 'account', id, tenantId: removed.tenantId }, { username: removed.username });
          return json(200, { ok: true });
        }
        throw fail(405, 'Method not allowed');
      }
      if (action === 'password' && method === 'POST') {
        const tenantId = await platform.setAccountPassword(id, (await readBody(req)).password);
        await audit('account.password_reset', { type: 'account', id, tenantId });
        return json(200, { ok: true });
      }
      throw fail(404, 'NOT_FOUND');
    }

    /* ---- roles ---- */
    if (head === 'roles') {
      if (!id) {
        if (method === 'GET') return json(200, await platform.listRoles({ tenantId: url.searchParams.get('tenantId') || undefined }));
        if (method === 'POST') {
          const body = await readBody(req), created = await platform.saveRole(null, body, { tenantId: body.tenantId || null });
          await audit('role.create', { type: 'role', id: created, tenantId: body.tenantId || null }, { name: body.name });
          return json(201, (await platform.listRoles()).find(r => r.id === created));
        }
        throw fail(405, 'Method not allowed');
      }
      cleanId(id);
      if (method === 'PATCH') {
        const body = await readBody(req);
        await platform.saveRole(id, body);
        await audit('role.update', { type: 'role', id }, { name: body.name });
        await sync.bump('platform');
        return json(200, (await platform.listRoles()).find(r => r.id === id));
      }
      if (method === 'DELETE') { await platform.removeRole(id); await audit('role.delete', { type: 'role', id }); return json(200, { ok: true }); }
      throw fail(405, 'Method not allowed');
    }

    /* ---- plans and platform settings ---- */
    if (head === 'plans') {
      if (method === 'GET') return json(200, await platform.getPlans());
      if (method === 'PUT') { const plans = await platform.setPlans(await readBody(req)); await audit('plans.update', { type: 'plans' }, { plans: plans.map(p => p.id) }); await sync.bump('platform'); return json(200, plans); }
      throw fail(405, 'Method not allowed');
    }
    if (head === 'config') {
      if (method === 'GET') return json(200, await platform.getConfig());
      if (method === 'PATCH') {
        const body = await readBody(req), config = await platform.setConfig(body);
        await audit('config.update', { type: 'config' }, { fields: Object.keys(body), maintenance: config.maintenance.enabled, signupOpen: config.signupOpen });
        await sync.bump('platform');
        return json(200, config);
      }
      throw fail(405, 'Method not allowed');
    }

    /* ---- clients of every tenant ---- */
    if (head === 'clients') {
      if (!id && method === 'GET') return json(200, await listClients({ tenantId: url.searchParams.get('tenantId') || undefined, q: url.searchParams.get('q'), limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') }));
      if (id && !action) {
        cleanId(id);
        const tenantId = await clients.tenantOf(id);
        if (!tenantId) throw fail(404, 'NOT_FOUND');
        if (method === 'PATCH') {
          const body = await readBody(req);
          const updated = await clients.update(id, { credits: body.credits, blocked: body.blocked });
          await audit('client.update', { type: 'client', id, tenantId }, { credits: body.credits, blocked: body.blocked });
          await sync.bump('clients', `c:${id}`);
          return json(200, { ...updated, tenantId });
        }
        if (method === 'DELETE') {
          await clients.remove(id);
          await db.query("DELETE FROM subscriptions WHERE owner_type='client' AND owner_id=$1", [id]);
          await audit('client.delete', { type: 'client', id, tenantId });
          await sync.bump('clients', 'requests', `c:${id}`);
          return json(200, { ok: true });
        }
      }
      throw fail(405, 'Method not allowed');
    }

    /* ---- audit log ---- */
    if (head === 'audit' && method === 'GET') {
      const p = url.searchParams;
      return json(200, await platform.auditList({ tenantId: p.get('tenantId') || undefined, action: p.get('action') || undefined, q: p.get('q') || undefined, before: p.get('before') || undefined, limit: p.get('limit') || 100 }));
    }
    throw fail(404, 'API route not found');
  }
  return { handle, session, verifyLogin };
}
module.exports = { createSuper };
