#!/usr/bin/env node
/**
 * npm "postinstall" hook: builds the web app (dist/) while Hostinger installs dependencies.
 *
 * Why: Hostinger's Node.js preset has no build command field, so nothing ever ran `npm run build:web` and the server
 * answered "The web app is not built yet". Hostinger does run `npm install` / `npm ci`, so the export happens here.
 *
 * Safety rules (see docs/HOSTINGER.md):
 *  - Runs ONLY when there is a positive Hostinger signal: the install folder is ~/domains/<domain>/hbuilds/... or inside
 *    /home/u<digits>/ (Hostinger account home), or
 *    DWIRA_PLATFORM=hostinger, or DWIRA_BUILD_ON_INSTALL=1. A plain `npm install` on a laptop, a CI job, the Android
 *    release workflow, EAS and Vercel (it has its own buildCommand) never build here.
 *  - Skips when dist/index.html already exists (for example a build command did the work).
 *  - NEVER fails the install: any problem prints one clear message and exits 0. The server then still starts and shows
 *    its "not built yet" page instead of the deploy failing.
 *  - Low memory: V8 heap capped at 2 GB, two Metro workers.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const HEAP_MB = 2048;
const TIMEOUT_MS = 20 * 60 * 1000;
const TAG = '[dwira postinstall]';

const truthy = value => value !== undefined && value !== '' && !/^(0|false|no|off)$/i.test(String(value));
// Deploy folder (~/domains/<domain>/hbuilds/<build>/nodejs) or a Hostinger account home (/home/u123456789/...).
const isHostingerDir = dir => /[\\/]domains[\\/][^\\/]+[\\/]hbuilds[\\/]/.test(dir) || /^[\\/]home[\\/]u\d{6,}[\\/]/.test(dir);

/** Returns { run: boolean, reason: string }. Pure, so scripts/check-postinstall.js can test every case. */
function decide({ env = process.env, dir = root, distReady = false } = {}) {
  if (truthy(env.DWIRA_SKIP_BUILD_ON_INSTALL)) return { run: false, reason: 'DWIRA_SKIP_BUILD_ON_INSTALL is set' };
  if (env.VERCEL) return { run: false, reason: 'Vercel builds with its own buildCommand' };
  if (env.GITHUB_ACTIONS || env.EAS_BUILD) return { run: false, reason: 'CI / Android release install' };
  if (distReady) return { run: false, reason: 'dist/index.html already exists' };
  if (truthy(env.DWIRA_BUILD_ON_INSTALL)) return { run: true, reason: 'DWIRA_BUILD_ON_INSTALL is set' };
  if (env.DWIRA_PLATFORM === 'hostinger') return { run: true, reason: 'DWIRA_PLATFORM=hostinger' };
  if (isHostingerDir(dir) || (env.INIT_CWD && isHostingerDir(env.INIT_CWD))) return { run: true, reason: 'Hostinger deploy folder / account home' };
  return { run: false, reason: 'not Hostinger (set DWIRA_BUILD_ON_INSTALL=1 to force)' };
}

/** NODE_OPTIONS with the heap cap added, keeping whatever the host already set (an existing cap wins). */
function withHeapLimit(existing, mb = HEAP_MB) {
  const current = String(existing || '').trim();
  return /--max-old-space-size/.test(current) ? current : `${current} --max-old-space-size=${mb}`.trim();
}

function run(label, args, env) {
  console.log(`${TAG} ${label}`);
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit', timeout: TIMEOUT_MS });
  if (result.error) throw new Error(`${label}: ${result.error.code === 'ETIMEDOUT' ? `timed out after ${TIMEOUT_MS / 60000} min` : result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}: exited with ${result.signal ? `signal ${result.signal} (out of memory?)` : `code ${result.status}`}`);
}

function main() {
  const indexHtml = path.join(root, 'dist', 'index.html');
  const decision = decide({ distReady: fs.existsSync(indexHtml) });
  if (!decision.run) {
    if (decision.reason !== 'not Hostinger (set DWIRA_BUILD_ON_INSTALL=1 to force)') console.log(`${TAG} skipped: ${decision.reason}.`);
    return;
  }
  console.log(`${TAG} building dist/ (${decision.reason}); heap capped at ${HEAP_MB} MB, this takes a few minutes...`);
  const started = Date.now();
  const env = {
    ...process.env,
    NODE_OPTIONS: withHeapLimit(process.env.NODE_OPTIONS),
    NODE_ENV: 'production',
    CI: '1', // no watch mode, no prompts
    EXPO_NO_TELEMETRY: '1',
    EXPO_NO_GIT_STATUS: '1',
  };
  try {
    const expoCli = require.resolve('expo/bin/cli', { paths: [root] });
    run('expo export -p web', [expoCli, 'export', '-p', 'web', '--max-workers', '2'], env);
    run('postexport', [path.join(__dirname, 'postexport.js')], env);
    if (!fs.existsSync(indexHtml)) throw new Error('the export finished but dist/index.html is missing');
    console.log(`${TAG} dist/ is ready (${Math.round((Date.now() - started) / 1000)} s).`);
  } catch (error) {
    // A half-written dist/ would hide the real problem and could be served; remove it so the next install retries.
    try { fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true }); } catch { /* ignore */ }
    console.warn([
      '',
      `${TAG} WARNING: the web build FAILED, but the install continues.`,
      `${TAG} Reason: ${error.message}`,
      `${TAG} The site will show "The web app is not built yet" until dist/ exists. Fix the error above and redeploy,`,
      `${TAG} or build elsewhere (GitHub Action + "deploy" branch, see docs/HOSTINGER.md).`,
      '',
    ].join('\n'));
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.warn(`${TAG} unexpected error, ignored: ${error && error.message}`); }
  process.exitCode = 0;
}

module.exports = { decide, withHeapLimit, isHostingerDir };
