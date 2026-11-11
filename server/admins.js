/**
 * Administrator accounts: profile (name, e-mail, phone, title, picture, credits), password and signed-in devices.
 *
 * Identity: an administrator is identified by a stable `admin_id` ("admin" for the built-in login, the lower-cased e-mail for the
 * ADMIN_EMAIL login). Sessions, preferences and notification devices already hang off that id; this module adds the profile.
 *
 * Passwords: until an administrator changes it in the panel, the built-in (admin / admin, unless DISABLE_DEFAULT_ADMIN=true) and
 * environment (ADMIN_EMAIL + ADMIN_PASSWORD_HASH) credentials work. From the first change the stored scrypt hash REPLACES them for that
 * identity: the default password stops working at once, and every other device is signed out.
 */
const crypto = require('node:crypto');

const fail = (status, message) => Object.assign(new Error(message), { status });
const clean = (value, max) => Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, max).join('');
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,24}$/;
const MAX_CREDITS = 1000000;
const WEAK = new Set(['admin', 'administrator', 'password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui', 'azertyui', 'dwira123', 'admin123', 'admin1234', 'motdepasse', '00000000', '11111111']);

function passwordMatches(password, encoded) {
  const [salt, digest] = String(encoded || '').split(':');
  if (!salt || !digest || !/^[a-f0-9]{128}$/.test(digest)) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(String(password), salt, 64), Buffer.from(digest, 'hex'));
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}
/** Rules for a NEW password. Returns an error code or '' when it is acceptable. */
function passwordProblem(password, { username = '', email = '' } = {}) {
  const value = String(password ?? '');
  if (value.length < 8 || value.length > 128) return 'WEAK_PASSWORD';
  const low = value.toLowerCase();
  if (WEAK.has(low) || /^(.)\1+$/.test(value)) return 'WEAK_PASSWORD';
  if ((username && low === String(username).toLowerCase()) || (email && low === String(email).toLowerCase())) return 'WEAK_PASSWORD';
  return '';
}

function createAdmins(db, { env = process.env, sync, media } = {}) {
  // The built-in admin / admin login and the ADMIN_EMAIL environment login exist for the default tenant only: every other tenant's
  // administrators are created by the super admin with their own password, so no shared credential can open a customer's panel.
  const isDefault = db.tenantId === 'default';
  const defaultAllowed = () => isDefault && env.DISABLE_DEFAULT_ADMIN !== 'true';
  const rowOf = async id => (await db.query('SELECT * FROM admin_accounts WHERE tenant_id=:tenant AND admin_id=$1', [id]))[0];

  /** Makes sure the account row exists (first sign-in creates it). The environment admin's id is its e-mail, so it starts filled in. */
  async function ensure(adminId) {
    const now = Date.now();
    const email = adminId.includes('@') ? adminId : '';
    await db.query('INSERT INTO admin_accounts(tenant_id,admin_id,email,created_at,updated_at) VALUES(:tenant,$1,$2,$3,$3) ON CONFLICT (tenant_id,admin_id) DO NOTHING', [adminId, email, now]);
    return rowOf(adminId);
  }
  const view = row => ({
    id: row.admin_id, username: row.admin_id, name: row.name, email: row.email, phone: row.phone, title: row.title, avatar: row.avatar,
    credits: row.credits == null ? null : Number(row.credits), createdAt: Number(row.created_at), lastLoginAt: row.last_login_at == null ? 0 : Number(row.last_login_at),
    passwordChangedAt: row.pw_changed_at == null ? 0 : Number(row.pw_changed_at),
    // True while the built-in admin / admin password is still the one that opens this account: the panel nags about it.
    defaultPassword: defaultAllowed() && row.admin_id === 'admin' && !row.pw_hash,
  });
  async function get(adminId) { return view(await ensure(adminId)); }

  /** The administrator identity for these credentials, or null. A stored password replaces the built-in / environment ones. */
  async function verify(identifier, password) {
    const user = String(identifier ?? '').trim().toLowerCase();
    if (!user || user.length > 190 || typeof password !== 'string' || !password || password.length > 512) return null;
    const stored = (await db.query('SELECT admin_id, pw_hash FROM admin_accounts WHERE tenant_id=:tenant AND pw_hash IS NOT NULL AND disabled=0 AND (admin_id=$1 OR lower(email)=$1) ORDER BY (admin_id=$1) DESC LIMIT 1', [user]))[0];
    if (stored) return passwordMatches(password, stored.pw_hash) ? stored.admin_id : null;
    if (defaultAllowed() && user === 'admin' && password === 'admin') return 'admin';
    return isDefault && env.ADMIN_EMAIL && user === env.ADMIN_EMAIL.toLowerCase() && passwordMatches(password, env.ADMIN_PASSWORD_HASH) ? user : null;
  }
  const touchLogin = async adminId => { await ensure(adminId); await db.query('UPDATE admin_accounts SET last_login_at=$1 WHERE tenant_id=:tenant AND admin_id=$2', [Date.now(), adminId]); };

  /** Validates and stores a profile change. Every field is optional; `credits: null` = unlimited. */
  async function update(adminId, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail(400, 'INVALID_PROFILE');
    const row = await ensure(adminId);
    const next = {};
    if (patch.name !== undefined) next.name = clean(patch.name, 80).replace(/\s+/g, ' ');
    if (patch.title !== undefined) next.title = clean(patch.title, 80).replace(/\s+/g, ' ');
    if (patch.email !== undefined) {
      const email = clean(patch.email, 254).toLowerCase();
      if (email && !EMAIL.test(email)) throw fail(400, 'INVALID_EMAIL');
      if (email) {
        const taken = (await db.query('SELECT admin_id FROM admin_accounts WHERE tenant_id=:tenant AND lower(email)=$1 AND admin_id<>$2', [email, adminId]))[0];
        if (taken) throw fail(409, 'EMAIL_TAKEN');
      }
      next.email = email;
    }
    if (patch.phone !== undefined) {
      const phone = clean(patch.phone, 32).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
      if (phone && !/^\+?\d{6,15}$/.test(phone)) throw fail(400, 'INVALID_PHONE');
      next.phone = phone;
    }
    if (patch.avatar !== undefined) {
      let avatar = typeof patch.avatar === 'string' ? patch.avatar.trim() : '';
      if (avatar.startsWith('data:') && media) avatar = (await media.externalize({ image: avatar }, { svg: false })).value.image;
      if (avatar && !/^(\/api\/media\/[a-f0-9]{32}\.[a-z0-9]+|https:\/\/[^\s]{1,2000})$/i.test(avatar)) throw fail(400, 'INVALID_AVATAR');
      next.avatar = avatar;
    }
    if (patch.credits !== undefined) {
      if (patch.credits !== null && !(Number.isInteger(patch.credits) && patch.credits >= 0 && patch.credits <= MAX_CREDITS)) throw fail(400, 'INVALID_CREDITS');
      next.credits = patch.credits;
    }
    const keys = Object.keys(next);
    if (!keys.length) return view(row);
    const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(',');
    await db.query(`UPDATE admin_accounts SET ${sets}, updated_at=$${keys.length + 1} WHERE tenant_id=:tenant AND admin_id=$${keys.length + 2}`, [...keys.map(k => next[k]), Date.now(), adminId]);
    if (sync) await sync.bump(`a:${adminId}`);
    return view(await rowOf(adminId));
  }

  /** Changes the password after checking the current one, then signs out every other device of this administrator. */
  async function changePassword(adminId, current, next, keepToken) {
    if (typeof current !== 'string' || typeof next !== 'string' || !current || current.length > 512) throw fail(400, 'INVALID_PASSWORD');
    const row = await ensure(adminId);
    // The current password is checked with the same rules as a sign-in (stored hash first, then built-in / environment).
    const ok = row.pw_hash ? passwordMatches(current, row.pw_hash)
      : (defaultAllowed() && adminId === 'admin' && current === 'admin') || (isDefault && !!env.ADMIN_EMAIL && adminId === env.ADMIN_EMAIL.toLowerCase() && passwordMatches(current, env.ADMIN_PASSWORD_HASH));
    if (!ok) throw fail(403, 'WRONG_PASSWORD');
    if (next === current) throw fail(400, 'SAME_PASSWORD');
    const problem = passwordProblem(next, { username: adminId, email: row.email });
    if (problem) throw fail(400, problem);
    await db.query('UPDATE admin_accounts SET pw_hash=$1, pw_changed_at=$2, updated_at=$2 WHERE tenant_id=:tenant AND admin_id=$3', [hashPassword(next), Date.now(), adminId]);
    await db.query('DELETE FROM admin_sessions WHERE tenant_id=:tenant AND admin_id=$1 AND token_hash<>$2', [adminId, keepToken]);
    if (sync) await sync.bump(`a:${adminId}`);
    return view(await rowOf(adminId));
  }

  const clip = value => String(value ?? '').slice(0, 300);
  async function sessions(adminId, currentHash) {
    const rows = await db.query('SELECT token_hash, created_at, expires_at, ua FROM admin_sessions WHERE tenant_id=:tenant AND admin_id=$1 AND expires_at>$2 ORDER BY created_at DESC NULLS LAST', [adminId, Date.now()]);
    return rows.map(r => ({ id: r.token_hash.slice(0, 16), current: r.token_hash === currentHash, createdAt: r.created_at == null ? 0 : Number(r.created_at), expiresAt: Number(r.expires_at), ua: clip(r.ua) }));
  }
  async function revokeOthers(adminId, currentHash) { await db.query('DELETE FROM admin_sessions WHERE tenant_id=:tenant AND admin_id=$1 AND token_hash<>$2', [adminId, currentHash]); }
  async function revoke(adminId, id, currentHash) {
    if (!/^[a-f0-9]{16}$/.test(String(id))) throw fail(400, 'INVALID_SESSION');
    const rows = await db.query('SELECT token_hash FROM admin_sessions WHERE tenant_id=:tenant AND admin_id=$1 AND token_hash LIKE $2', [adminId, `${id}%`]);
    if (rows.some(r => r.token_hash === currentHash)) throw fail(400, 'CURRENT_SESSION');
    await db.query('DELETE FROM admin_sessions WHERE tenant_id=:tenant AND admin_id=$1 AND token_hash LIKE $2 AND token_hash<>$3', [adminId, `${id}%`, currentHash]);
  }

  return { get, verify, touchLogin, update, changePassword, sessions, revoke, revokeOthers };
}

module.exports = { createAdmins, passwordMatches, hashPassword, passwordProblem };
