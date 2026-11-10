/**
 * HTTP routes of the Super Admin (/api/superadmin/*). Kept out of server/index.js: the caller passes what it owns (body reader, JSON writer,
 * cookie builder) and gets back `true` when the request was answered here.
 */
const fail = (status, message) => Object.assign(new Error(message), { status });
const COOKIE = 'dwira_super';
const SESSION_AGE = 12 * 3600;

function createSuperRoutes({ superadmin, readBody }) {
  const route = (path, pattern) => { const m = pattern.exec(path); return m ? m.slice(1).map(decodeURIComponent) : null; };
  /** `ctx`: { url, req, res, json, cookie, token, ip }. Returns true when /api/superadmin/* was handled. */
  return async function handle(ctx) {
    const { url, req, res, json, cookie, token, ip } = ctx;
    if (!url.pathname.startsWith('/api/superadmin/') && url.pathname !== '/api/superadmin') return false;
    const method = req.method, path = url.pathname.slice('/api/superadmin'.length).replace(/\/+$/, '') || '/';
    const native = req.headers['x-dwira-native'] === '1';

    if (path === '/login' && method === 'POST') {
      const body = await readBody(req);
      const { token: fresh, profile } = await superadmin.login(body?.username, body?.password, { ip, ua: req.headers['user-agent'] });
      res.setHeader('Set-Cookie', cookie(COOKIE, fresh, SESSION_AGE));
      json(200, { ok: true, profile, ...(native ? { token: fresh } : {}) });
      return true;
    }
    const session = await superadmin.authenticate(token);
    if (path === '/logout' && method === 'POST') {
      await superadmin.logout(token);
      res.setHeader('Set-Cookie', cookie(COOKIE, '', 0));
      json(200, { ok: true });
      return true;
    }
    if (!session) throw fail(401, 'Super admin login required');
    const actor = (await superadmin.profile()).username;
    const send = (value, status = 200) => { json(status, value); return true; };
    let m;

    if (path === '/session' && method === 'GET') return send({ ok: true, profile: await superadmin.profile() });
    if (path === '/credentials' && method === 'POST') return send(await superadmin.changeCredentials(await readBody(req), session.tokenHash, ip));
    if (path === '/sessions' && method === 'GET') return send({ sessions: await superadmin.sessions(session.tokenHash) });
    if (path === '/sessions' && method === 'DELETE') { await superadmin.revokeOthers(session.tokenHash); await superadmin.record(actor, 'superadmin.sessions_revoked', '', {}, ip); return send({ ok: true }); }
    if (path === '/stats' && method === 'GET') return send(await superadmin.stats());
    if (path === '/audit' && method === 'GET') return send({ items: await superadmin.auditList({ limit: url.searchParams.get('limit'), before: url.searchParams.get('before'), q: url.searchParams.get('q') || '' }) });
    if (path === '/platform' && method === 'GET') return send(await superadmin.platformView());
    if (path === '/platform' && method === 'PATCH') return send(await superadmin.setPlatform(await readBody(req), actor, ip));

    // administrators
    if (path === '/admins' && method === 'GET') return send({ admins: await superadmin.listAdmins() });
    if (path === '/admins' && method === 'POST') return send(await superadmin.createAdmin(await readBody(req), actor, ip), 201);
    if ((m = route(path, /^\/admins\/([^/]+)\/password$/)) && method === 'POST') return send(await superadmin.resetAdminPassword(m[0], (await readBody(req))?.password, actor, ip));
    if ((m = route(path, /^\/admins\/([^/]+)\/signout$/)) && method === 'POST') { await superadmin.signOutAdmin(m[0], actor, ip); return send({ ok: true }); }
    if ((m = route(path, /^\/admins\/([^/]+)$/))) {
      if (method === 'PATCH') return send(await superadmin.updateAdmin(m[0], await readBody(req), actor, ip));
      if (method === 'DELETE') { await superadmin.deleteAdmin(m[0], actor, ip); return send({ ok: true }); }
    }
    // roles
    if (path === '/roles' && method === 'GET') return send({ roles: await superadmin.listRoles() });
    if (path === '/roles' && method === 'POST') return send(await superadmin.createRole(await readBody(req), actor, ip), 201);
    if ((m = route(path, /^\/roles\/([A-Za-z0-9_-]+)$/))) {
      if (method === 'PATCH') return send(await superadmin.updateRole(m[0], await readBody(req), actor, ip));
      if (method === 'DELETE') { await superadmin.deleteRole(m[0], actor, ip); return send({ ok: true }); }
    }
    // tenants
    if (path === '/tenants' && method === 'GET') return send({ tenants: await superadmin.listTenants() });
    if (path === '/tenants' && method === 'POST') return send(await superadmin.createTenant(await readBody(req), actor, ip), 201);
    if ((m = route(path, /^\/tenants\/([A-Za-z0-9_-]+)$/))) {
      if (method === 'PATCH') return send(await superadmin.updateTenant(m[0], await readBody(req), actor, ip));
      if (method === 'DELETE') { await superadmin.deleteTenant(m[0], actor, ip); return send({ ok: true }); }
    }
    // clients (the platform's end users)
    if (path === '/clients' && method === 'GET') return send(await superadmin.clientsPage({ q: url.searchParams.get('q') || '', page: url.searchParams.get('page'), size: url.searchParams.get('size'), status: url.searchParams.get('status') || 'all' }));
    if (path === '/clients/bulk' && method === 'POST') return send(await superadmin.bulkClients(await readBody(req), actor, ip));
    if ((m = route(path, /^\/clients\/([a-f0-9-]{8,64})$/))) {
      if (method === 'PATCH') return send(await superadmin.updateClient(m[0], await readBody(req), actor, ip));
      if (method === 'DELETE') { await superadmin.deleteClient(m[0], actor, ip); return send({ ok: true }); }
    }
    throw fail(404, 'API route not found');
  };
}
module.exports = { createSuperRoutes, SUPER_COOKIE: COOKIE };
