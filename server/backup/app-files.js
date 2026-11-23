/**
 * The "app" part of a backup: the deployable files (web export, server, api, public files, package manifests), never anything secret.
 * Both directions use the same allow-list and the same deny-list, so a hand-made archive cannot write outside it either.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { hashing } = require('./zip');

const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
// The "code" of a backup is the WHOLE project, enough to push it to a new GitHub repository and build it there (npm ci, npm run build:web):
// the source (src/, assets/, scripts/, docs/), the server, the build configuration and the repository files. `dist/` (the web export) is
// included too so the archive can also be deployed as it is.
const DIRS = ['dist', 'server', 'api', 'public', 'src', 'assets', 'scripts', 'docs', '.github'];
const FILES = [
  'package.json', 'package-lock.json', 'vercel.json', 'app.json', 'app.config.js', 'eas.json',
  'babel.config.js', 'metro.config.js', 'tailwind.config.js', 'tsconfig.json', 'nativewind-env.d.ts', 'eslint.config.js',
  '.gitignore', '.gitattributes', '.nvmrc', '.editorconfig', '.prettierrc', '.prettierignore',
  'README.md', 'AGENTS.md', 'LICENSE',
];
/**
 * Names that can hold a credential, wherever they are, plus editor / tool litter that the project's own .gitignore leaves out.
 * `.env.example` (and .sample) is the template of the settings: it holds no value and a new repository needs it.
 */
const DENY_NAME = /^(\.env(?!\.(?:example|sample)$)(\..*)?|.*\.(pem|key|p12|p8|pfx|jks|keystore|mobileprovision)|id_(rsa|ed25519|ecdsa).*|credentials.*\.json|service[-_]?account.*\.json|\.npmrc|\.netrc|\.git-credentials|\.htpasswd|\.DS_Store|.*\.log|.*\.tsbuildinfo)$/i;
/** Directories that are never part of the app: dependencies, VCS, tool caches. */
const DENY_DIR = new Set(['node_modules', '.git', '.expo', '.pw', '.playwright', '.pw-browsers', '.npm-cache', '.font-tools', '.baseline']);
/**
 * `data` is the server's own data (database files, uploads, backups) ONLY below server/. Everywhere else it is an ordinary folder:
 * src/data holds the app's models, repositories and seed content, public/data may hold public files.
 */
const isDenied = (parts, index) => DENY_DIR.has(parts[index]) || (parts[index] === 'data' && parts[0] === 'server');

/** Is `rel` (forward slashes, relative to the app root) allowed in an app backup / restore? */
function allowed(rel) {
  const parts = String(rel).split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return false;
  if (parts.length === 1) return FILES.includes(parts[0]) && !DENY_NAME.test(parts[0]);
  if (!DIRS.includes(parts[0])) return false;
  for (let i = 0; i < parts.length - 1; i++) if (isDenied(parts, i)) return false;
  return !DENY_NAME.test(parts[parts.length - 1]);
}

/** Every file of the app, as { rel, abs, size }. Symlinks and anything not allowed are skipped. */
async function listApp(root) {
  const found = [];
  const walk = async (rel) => {
    let entries;
    try { entries = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!isDenied(next.split('/'), next.split('/').length - 1)) await walk(next); continue; }
      if (!entry.isFile() || !allowed(next)) continue;
      found.push({ rel: next, abs: path.join(root, next), size: (await fs.promises.stat(path.join(root, next))).size });
    }
  };
  for (const name of FILES) {
    try { const st = await fs.promises.lstat(path.join(root, name)); if (st.isFile()) found.push({ rel: name, abs: path.join(root, name), size: st.size }); } catch { /* absent */ }
  }
  for (const dir of DIRS) await walk(dir);
  return found;
}

/** Writes one entry below `base` (created if needed), refusing anything outside the allow-list or outside `base`. Returns { size, sha256 }. */
async function writeInto(base, rel, stream) {
  if (!allowed(rel)) throw fail(400, 'ARCHIVE_UNSAFE_PATH', { entry: rel.slice(0, 80) });
  const target = path.resolve(base, ...rel.split('/'));
  if (!target.startsWith(path.resolve(base) + path.sep)) throw fail(400, 'ARCHIVE_UNSAFE_PATH', { entry: rel.slice(0, 80) });
  await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  const temp = `${target}.restore-${process.pid}.tmp`;
  const hasher = hashing();
  try {
    await pipeline(stream, hasher, fs.createWriteStream(temp, { mode: 0o644 }));
    await fs.promises.rename(temp, target);
  } catch (error) { await fs.promises.rm(temp, { force: true }); throw error; }
  return hasher.result();
}

/**
 * Copies a staged app into the live app directory (file by file, atomically per file). Every file it replaces is first copied to `undo`; when
 * anything fails the originals are put back (and files that did not exist are removed), so a restore never leaves a half-old, half-new app.
 * Returns the number of files.
 */
async function applyStage(stage, root, rels, undo) {
  let count = 0;
  const done = [];
  try {
    for (const rel of rels) {
      if (!allowed(rel)) continue;
      const from = path.join(stage, ...rel.split('/'));
      const to = path.resolve(root, ...rel.split('/'));
      if (!to.startsWith(path.resolve(root) + path.sep)) continue;
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      let existed = false;
      if (undo) {
        const keep = path.join(undo, ...rel.split('/'));
        try { await fs.promises.mkdir(path.dirname(keep), { recursive: true }); await fs.promises.copyFile(to, keep); existed = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      done.push({ to, rel, existed });
      const temp = `${to}.apply-${process.pid}.tmp`;
      await fs.promises.copyFile(from, temp);
      await fs.promises.rename(temp, to);
      count++;
    }
  } catch (error) {
    if (undo) for (const item of done.reverse()) {
      try { if (item.existed) await fs.promises.copyFile(path.join(undo, ...item.rel.split('/')), item.to); else await fs.promises.rm(item.to, { force: true }); } catch { /* best effort */ }
    }
    throw error;
  }
  return count;
}

module.exports = { listApp, allowed, writeInto, applyStage, DENY_NAME };
