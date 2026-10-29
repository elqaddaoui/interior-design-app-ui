/**
 * Runtime configuration for the long-running Node server (Hostinger managed Node.js, a VPS, local `npm run start:server`).
 * Pure functions only, so they can be unit tested. Nothing here ever prints a connection string, password or token.
 * Vercel does not use this file: api/index.js loads server/index.js directly.
 */
const { connectionString } = require('./db');

/** Hostinger deploys server apps into ~/domains/<domain>/hbuilds/<build>/nodejs (see docs/HOSTINGER.md). */
const isHostinger = (dir = __dirname) => /[\\/]domains[\\/][^\\/]+[\\/]hbuilds[\\/]/.test(dir);
/** 'vercel' | 'hostinger' | 'node'. DWIRA_PLATFORM=hostinger forces Hostinger behaviour if its folder layout ever changes. */
const platformName = (env = process.env, dir = __dirname) => (env.VERCEL ? 'vercel' : env.DWIRA_PLATFORM === 'hostinger' || isHostinger(dir) ? 'hostinger' : 'node');

/**
 * PORT from the host when it provides one. Otherwise 3000 on Hostinger (the port its proxy expects) and 8080 locally
 * (the port used by the README and the browser checks).
 */
function resolvePort(env = process.env, dir = __dirname) {
  if (env.PORT !== undefined && env.PORT !== '') {
    const port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw configError([`PORT must be a whole number between 0 and 65535 (got "${String(env.PORT).slice(0, 20)}").`]);
    return port;
  }
  return platformName(env, dir) === 'hostinger' ? 3000 : 8080;
}

function configError(problems) {
  return Object.assign(new Error(problems.join('\n')), { code: 'CONFIG_INVALID', problems });
}

/** Database description that is safe to log: driver, provider and whether the Neon endpoint is the pooled one. Never the URL. */
function describeDatabase(url) {
  if (!url) return { kind: 'pglite' };
  let host = '';
  try { host = new URL(url).hostname; } catch { /* validated separately */ }
  const neon = /\.neon\.tech$/i.test(host);
  return { kind: 'postgres', provider: neon ? 'neon' : 'postgres', pooled: neon ? /-pooler\./i.test(host) : null };
}

/**
 * Checks the variables the server cannot run without. Returns { warnings } or throws an Error whose message lists every
 * problem in plain words. DATABASE_URL is required unless PGLITE_DIR explicitly asks for the in-process dev database:
 * without that rule a host that forgot the variable would silently write to a disk that is wiped on every deploy.
 */
function validateEnv(env = process.env) {
  const problems = [], warnings = [];
  const url = connectionString(env);
  if (!url && !env.PGLITE_DIR) {
    problems.push('DATABASE_URL is not set. Add your Neon *pooled* connection string (host contains "-pooler") as the DATABASE_URL environment variable. For a local in-process database instead, start with PGLITE_DIR=:memory: (or a folder path).');
  }
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { /* reported below */ }
    if (!parsed || !/^postgres(ql)?:$/.test(parsed.protocol) || !parsed.hostname) problems.push('DATABASE_URL is not a valid postgres:// or postgresql:// connection string (value not shown).');
    else {
      const db = describeDatabase(url);
      if (db.provider === 'neon' && !db.pooled) warnings.push('DATABASE_URL points to a direct Neon endpoint. Use the pooled one (host contains "-pooler") for the app, and put the direct one in DATABASE_URL_UNPOOLED.');
    }
  }
  if (env.DATABASE_URL_UNPOOLED) {
    let parsed;
    try { parsed = new URL(env.DATABASE_URL_UNPOOLED); } catch { /* reported below */ }
    if (!parsed || !/^postgres(ql)?:$/.test(parsed.protocol) || !parsed.hostname) problems.push('DATABASE_URL_UNPOOLED is set but is not a valid postgres:// connection string (value not shown). Remove it or fix it.');
  }
  if (env.UV_THREADPOOL_SIZE !== undefined && !(Number(env.UV_THREADPOOL_SIZE) >= 1 && Number(env.UV_THREADPOOL_SIZE) <= 64)) problems.push('UV_THREADPOOL_SIZE must be a number between 1 and 64.');
  try { resolvePort(env); } catch (error) { problems.push(...error.problems); }
  if (env.DISABLE_DEFAULT_ADMIN !== 'true' && !(env.ADMIN_EMAIL && env.ADMIN_PASSWORD_HASH)) warnings.push('Custom admin credentials are not configured: the default login admin / admin is active. Set ADMIN_EMAIL + ADMIN_PASSWORD_HASH, then DISABLE_DEFAULT_ADMIN=true.');
  if (problems.length) throw configError(problems);
  return { warnings };
}

/** Removes secrets (the connection strings and their passwords) from a message before it is logged. */
function redact(message, env = process.env) {
  let text = String(message ?? '');
  for (const value of [connectionString(env), env.DATABASE_URL_UNPOOLED].filter(Boolean)) {
    text = text.split(value).join('[database url]');
    try { const { password } = new URL(value); if (password) text = text.split(decodeURIComponent(password)).join('***').split(password).join('***'); } catch { /* not a URL */ }
  }
  return text.replace(/postgres(ql)?:\/\/[^\s'"]+/gi, '[database url]');
}

module.exports = { validateEnv, describeDatabase, resolvePort, platformName, isHostinger, redact };
