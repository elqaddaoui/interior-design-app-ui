/**
 * Entry point of the long-running server: ONE Node.js process that serves the web export (dist/) and /api/* together.
 * Used by `npm run start:server`, `node server/index.js` and Hostinger's "Entry file" setting. Vercel does not use it.
 *
 * Shared-hosting friendly: no cluster, no child processes, a 2-thread libuv pool (instead of 4) and a small database pool.
 * It refuses to start, with a readable message, when a required variable is missing, and never prints a credential.
 */
const path = require('node:path');
const fs = require('node:fs');

// Must happen before anything uses the libuv thread pool (file reads, DNS lookups). Override with UV_THREADPOOL_SIZE.
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '2';

/**
 * Optional env files, never overriding variables the host already set: server/.env (local development) and Hostinger's
 * protected copy of the hPanel variables (~/domains/<domain>/hbuilds/config/.env), used only if the platform did not inject
 * them into the process. Returns the file names that were read (never their content).
 */
function loadEnvFiles(dir = __dirname) {
  const loaded = [];
  const files = [path.join(dir, '.env')];
  // <build>/nodejs/server -> hbuilds/config/.env, only inside Hostinger's layout (never a stray file elsewhere).
  if (require('./config').isHostinger(dir)) files.push(path.resolve(dir, '..', '..', '..', 'config', '.env'));
  for (const file of files) {
    try {
      if (!fs.statSync(file).isFile() || typeof process.loadEnvFile !== 'function') continue;
      process.loadEnvFile(file); // existing variables win
      loaded.push(path.relative(path.resolve(dir, '..'), file) || file);
    } catch { /* missing or unreadable: ignore */ }
  }
  return loaded;
}

function fatal(title, lines) {
  console.error(`\n[dwira] ${title}`);
  for (const line of lines) console.error(`  - ${line}`);
  console.error('  See docs/HOSTINGER.md for the list of environment variables.\n');
  process.exit(1);
}

function start() {
  const envFiles = loadEnvFiles();
  const { validateEnv, describeDatabase, resolvePort, platformName, redact } = require('./config');
  const env = process.env;
  const platform = platformName(env);
  env.DWIRA_PLATFORM = platform;
  // Hostinger's proxy runs on the same machine: trust the client address it forwards for loopback peers (rate limits).
  if (platform === 'hostinger' && env.TRUST_PROXY === undefined) env.TRUST_PROXY = 'true';

  let checked;
  try { checked = validateEnv(env); } catch (error) { fatal('Cannot start: configuration is incomplete.', error.problems || [redact(error.message)]); }
  const port = resolvePort(env);

  process.on('uncaughtException', error => { console.error('[dwira] Uncaught exception:', redact(error?.stack || error)); process.exit(1); });
  process.on('unhandledRejection', error => { console.error('[dwira] Unhandled rejection:', redact(error?.stack || error)); });

  const { createBackend } = require('./index');
  const backend = createBackend({ env });
  const { server, db, staticFiles } = backend;
  const database = describeDatabase(require('./db').connectionString(env));
  for (const warning of checked.warnings) console.warn(`[dwira] Warning: ${warning}`);
  if (!staticFiles.available()) console.warn(`[dwira] Warning: ${path.relative(process.cwd(), staticFiles.root) || staticFiles.root}/index.html not found. Run "npm run build:web" first; the API still works.`);

  server.on('error', error => {
    if (error.code === 'EADDRINUSE') fatal(`Port ${port} is already in use.`, ['Stop the other process, or set PORT to a free port.']);
    if (error.code === 'EACCES') fatal(`Not allowed to listen on port ${port}.`, ['Use a port above 1024, or the PORT your host provides.']);
    fatal('The HTTP server failed to start.', [redact(error.message)]);
  });
  server.listen(port, '0.0.0.0', () => {
    const db_ = database.kind === 'postgres' ? `postgres (${database.provider}${database.pooled === null ? '' : database.pooled ? ', pooled' : ', direct'}${env.DATABASE_URL_UNPOOLED ? ', migrations via DATABASE_URL_UNPOOLED' : ''})` : `pglite (${env.PGLITE_DIR || 'server/data/pglite'})`;
    console.log(`[dwira] Server ready on http://0.0.0.0:${port} | platform: ${platform} | Node.js ${process.versions.node} | database: ${db_} | web: ${staticFiles.available() ? 'dist/' : 'not built'} | threads: libuv ${env.UV_THREADPOOL_SIZE}${envFiles.length ? ` | env files: ${envFiles.join(', ')}` : ''}`);
    // Open the database once now (applies the schema if needed) so a bad DATABASE_URL shows up in the logs immediately.
    db.info().then(
      () => { console.log('[dwira] Database connected.'); void backend.pump(); },
      error => console.error(`[dwira] Database not reachable yet (${redact(error.code || error.message)}). /api/health reports 503 until it is; check DATABASE_URL.`),
    );
  });

  let stopping = false;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    console.log(`[dwira] ${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(signal));
  return backend;
}

module.exports = { start, loadEnvFiles };
if (require.main === module) start();
