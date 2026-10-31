const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const canonicalPhone = input => {
  let phone = String(input || '').replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (/^0[5-7]\d{8}$/.test(phone)) phone = '212' + phone.slice(1);
  return '+' + phone.replace(/^\+/, '');
};
const MAX_CREDITS = 1000000;
/** Only the columns toUser() needs: `prefs` (notification settings, can be large) is never read to authenticate, list or charge a client. */
const COLS = 'id,phone,name,free_used,credits,created_at,blocked,last_seen';
const CCOLS = COLS.split(',').map(c => 'c.' + c).join(',');
/**
 * A client who has not used the free design is shown `credits + 1`. To make the balance an admin types equal the balance
 * the user sees, a target of 0 also consumes the unused free design; any other target keeps it and stores the remainder.
 */
const balance = (row, shown) => (!row.free_used && shown <= 0 ? { credits: 0, freeUsed: 1 } : { credits: Math.max(0, shown - (row.free_used ? 0 : 1)), freeUsed: row.free_used });
const fail = (status, code) => Object.assign(new Error(code), { status });
const toUser = row => row && ({ id: row.id, name: row.name, whatsapp: row.phone, credits: row.credits + (row.free_used ? 0 : 1), freeUsed: row.free_used, leadDone: true, role: 'user', blocked: !!row.blocked, createdAt: row.created_at });

/** Phone-based client profiles, sessions, free/paid entitlement claims and per-client history/chat space. */
function createClients(db) {
  const byId = async (id, q = db.query) => (await q('SELECT ' + COLS + ' FROM clients WHERE id=$1', [id]))[0];
  async function login(name, input, defaultCredits = 1) {
    const canonical = canonicalPhone(input);
    if (!/^\+[1-9]\d{5,14}$/.test(canonical) || typeof name !== 'string' || name.trim().length < 2 || name.length > 120) throw fail(400, 'INVALID_PROFILE');
    // Atomic upsert: two simultaneous first logins for one phone cannot create two profiles.
    // The admin's "default credits" setting is the balance a new client starts with (free design included).
    const start = balance({ free_used: 0 }, Number.isSafeInteger(defaultCredits) && defaultCredits >= 0 ? Math.min(defaultCredits, MAX_CREDITS) : 1);
    const created = (await db.query('INSERT INTO clients(id,phone,name,created_at,credits,free_used) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (phone) DO NOTHING RETURNING id', [crypto.randomUUID(), canonical, name.trim(), Date.now(), start.credits, start.freeUsed])).length > 0;
    const row = (await db.query('SELECT ' + COLS + ' FROM clients WHERE phone=$1', [canonical]))[0];
    if (row.blocked) throw fail(403, 'ACCOUNT_BLOCKED');
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('DELETE FROM user_sessions WHERE expires_at<=$1', [Date.now()]);
    await db.query('INSERT INTO user_sessions VALUES($1,$2,$3)', [digest(token), row.id, Date.now() + 365 * 86400000]);
    await db.query('UPDATE clients SET last_seen=$1 WHERE id=$2', [Date.now(), row.id]);
    return { token, user: toUser(row), created };
  }
  async function authenticate(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const rows = await db.query('SELECT ' + CCOLS + ' FROM user_sessions s JOIN clients c ON c.id=s.client_id WHERE s.token_hash=$1 AND s.expires_at>$2', [digest(token), Date.now()]);
    const row = rows[0];
    // Activity for notification segments: the sync poll only runs while the app is visible, so this is real usage. Written at most every 5 minutes.
    if (row && Date.now() - Number(row.last_seen || 0) > 300000) await db.query('UPDATE clients SET last_seen=$1 WHERE id=$2', [Date.now(), row.id]).catch(() => {});
    return toUser(row) || null;
  }
  /** Idempotent: replaying the same claim id never charges twice; the first free claim is atomic. */
  async function claim(client, id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw fail(400, 'INVALID_CLAIM');
    return db.tx(async q => {
      await q('SELECT id FROM clients WHERE id=$1 FOR UPDATE', [client.id]); // serialises concurrent claims per client
      const old = (await q('SELECT * FROM claims WHERE id=$1', [id]))[0];
      if (old) { if (old.client_id !== client.id) throw fail(409, 'INVALID_CLAIM'); return toUser(await byId(client.id, q)); }
      const row = await byId(client.id, q);
      if (!row) throw fail(401, 'USER_LOGIN_REQUIRED');
      if (row.blocked) throw fail(403, 'ACCOUNT_BLOCKED');
      const free = !row.free_used;
      if (!free && row.credits <= 0) throw fail(402, 'PRO_REQUIRED');
      await q(free ? 'UPDATE clients SET free_used=1 WHERE id=$1' : 'UPDATE clients SET credits=credits-1 WHERE id=$1', [client.id]);
      await q('INSERT INTO claims(id,client_id,free,created_at) VALUES($1,$2,$3,$4)', [id, client.id, free ? 1 : 0, Date.now()]);
      return toUser(await byId(client.id, q));
    });
  }
  const listSpace = async (client, kind) => (await db.query('SELECT value FROM space WHERE client_id=$1 AND kind=$2', [client.id, kind])).map(row => JSON.parse(row.value));
  /** One item by id (never the whole list): the row must belong to this client and kind. */
  const getSpaceItem = async (client, kind, id) => { const row = (await db.query('SELECT value FROM space WHERE id=$1 AND client_id=$2 AND kind=$3', [id, client.id, kind]))[0]; return row ? JSON.parse(row.value) : null; };
  async function putSpace(client, kind, value, id) {
    const existing = (await db.query('SELECT client_id,kind FROM space WHERE id=$1', [id]))[0];
    if (existing && (existing.client_id !== client.id || existing.kind !== kind)) throw fail(404, 'NOT_FOUND');
    const next = { ...value, id, userId: client.id };
    await db.query('INSERT INTO space VALUES($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value', [id, client.id, kind, JSON.stringify(next)]);
    return next;
  }
  /**
   * Admin view of the newest 300 assistant conversations: clients' (with who wrote it) and visitors' who have not signed in
   * (`guest: true`, no name or phone). The database picks the newest and only the chosen rows are read (the previous version
   * read every conversation ever written and sliced in JavaScript). `since` (an `updatedAt`) returns only conversations
   * changed after it, plus `ids` (the current top-300 set) so the app can drop deleted ones: `{ chats, ids }`.
   */
  const UPDATED = "CASE WHEN (s.value::jsonb->>'updatedAt') ~ '^[0-9]{1,15}$' THEN (s.value::jsonb->>'updatedAt')::bigint ELSE 0 END";
  async function adminConversations({ since = null } = {}) {
    const top = [
      ...(await db.query(`SELECT s.id, ${UPDATED} AS at FROM space s WHERE s.kind='conversations' AND CASE WHEN jsonb_typeof(s.value::jsonb->'messages')='array' THEN jsonb_array_length(s.value::jsonb->'messages') ELSE 0 END > 0 ORDER BY at DESC LIMIT 300`)).map(row => ({ id: row.id, at: Number(row.at), guest: false })),
      ...(await db.query('SELECT s.id, s.updated_at AS at FROM guest_chats s ORDER BY s.updated_at DESC LIMIT 300')).map(row => ({ id: row.id, at: Number(row.at), guest: true })),
    ].sort((a, b) => b.at - a.at).slice(0, 300);
    const pick = top.filter(item => since == null || item.at > since);
    const clientIds = pick.filter(item => !item.guest).map(item => item.id), guestIds = pick.filter(item => item.guest).map(item => item.id);
    const rows = [
      ...(clientIds.length ? (await db.query("SELECT s.value, c.name, c.phone FROM space s JOIN clients c ON c.id=s.client_id WHERE s.kind='conversations' AND s.id = ANY($1)", [clientIds])).map(row => ({ ...JSON.parse(row.value), clientName: row.name, whatsapp: row.phone })) : []),
      ...(guestIds.length ? (await db.query('SELECT value FROM guest_chats WHERE id = ANY($1)', [guestIds])).map(row => ({ ...JSON.parse(row.value), clientName: '', whatsapp: '', guest: true })) : []),
    ].filter(row => Array.isArray(row.messages) && row.messages.length).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return { chats: rows, ids: top.map(item => item.id) };
  }
  /** An admin answers inside the conversation: the thread stays in its owner's space (or the visitor's device chat) only. */
  async function adminReply(id, text, message) {
    const row = (await db.query("SELECT s.client_id, s.value, c.name, c.phone FROM space s JOIN clients c ON c.id=s.client_id WHERE s.id=$1 AND s.kind='conversations'", [id]))[0];
    if (!row) {
      const guest = (await db.query('SELECT device_hash, value FROM guest_chats WHERE id=$1', [id]))[0];
      if (!guest) throw fail(404, 'NOT_FOUND');
      const value = JSON.parse(guest.value);
      const next = { ...value, messages: [...value.messages, message], updatedAt: message.createdAt };
      await db.query('UPDATE guest_chats SET value=$1, updated_at=$2 WHERE id=$3', [JSON.stringify(next), message.createdAt, id]);
      return { conversation: { ...next, clientName: '', whatsapp: '', guest: true }, clientId: null, deviceHash: guest.device_hash };
    }
    const value = JSON.parse(row.value);
    const next = { ...value, messages: [...value.messages, message], updatedAt: message.createdAt };
    await db.query('UPDATE space SET value=$1 WHERE id=$2', [JSON.stringify(next), id]);
    return { conversation: { ...next, clientName: row.name, whatsapp: row.phone }, clientId: row.client_id };
  }

  /* ---- Visitors who have not signed in: their chats live under the (hashed) device token ---- */
  const MAX_GUEST_CHATS = 30;
  const guestList = async device => (await db.query('SELECT value FROM guest_chats WHERE device_hash=$1 ORDER BY updated_at DESC', [device])).map(row => JSON.parse(row.value));
  const guestGet = async (device, id) => { const row = (await db.query('SELECT value FROM guest_chats WHERE id=$1 AND device_hash=$2', [id, device]))[0]; return row ? JSON.parse(row.value) : null; };
  async function guestPut(device, value, id) {
    const existing = (await db.query('SELECT device_hash FROM guest_chats WHERE id=$1', [id]))[0];
    if (existing && existing.device_hash !== device) throw fail(404, 'NOT_FOUND');
    // An id that belongs to a signed-in client's own thread is never writable from a device token.
    if (!existing && (await db.query('SELECT 1 FROM space WHERE id=$1', [id]))[0]) throw fail(404, 'NOT_FOUND');
    if (!existing && Number((await db.query('SELECT COUNT(*) AS n FROM guest_chats WHERE device_hash=$1', [device]))[0].n) >= MAX_GUEST_CHATS) throw fail(429, 'TOO_MANY_CHATS');
    const next = { ...value, id, userId: 'guest' };
    await db.query('INSERT INTO guest_chats(id,device_hash,value,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at', [id, device, JSON.stringify(next), Number(next.updatedAt) || Date.now()]);
    return next;
  }
  const guestRemove = (device, id) => db.query('DELETE FROM guest_chats WHERE id=$1 AND device_hash=$2', [id, device]);
  /**
   * The visitor signed in: every conversation this device started (and every later one, because the next request finds none
   * left) now belongs to the client. One transaction, so a thread is either still a guest chat or already the client's, never both or neither.
   */
  async function adoptGuest(device, client) {
    if (!device) return [];
    return db.tx(async q => {
      const rows = await q('SELECT id, value FROM guest_chats WHERE device_hash=$1 FOR UPDATE', [device]);
      for (const row of rows) {
        const next = { ...JSON.parse(row.value), userId: client.id };
        await q("INSERT INTO space(id,client_id,kind,value) VALUES($1,$2,'conversations',$3) ON CONFLICT (id) DO NOTHING", [row.id, client.id, JSON.stringify(next)]);
        await q('DELETE FROM guest_chats WHERE id=$1', [row.id]);
      }
      return rows.map(row => row.id);
    });
  }
  return {
    adminConversations, adminReply, guestList, guestGet, getSpaceItem, guestPut, guestRemove, adoptGuest,
    login, authenticate, claim, listSpace, putSpace,
    hasClaim: async (id, clientId) => !!(await db.query('SELECT 1 FROM claims WHERE id=$1 AND client_id=$2', [id, clientId]))[0],
    user: async id => toUser(await byId(id)),
    logout: async token => { if (token) await db.query('DELETE FROM user_sessions WHERE token_hash=$1', [digest(token)]); },
    users: async () => (await db.query('SELECT ' + COLS + ' FROM clients ORDER BY created_at DESC')).map(toUser),
    grant: async (id, credits) => {
      const row = await byId(id);
      if (!row) throw fail(404, 'NOT_FOUND');
      if (!Number.isSafeInteger(credits) || credits < 0 || credits > MAX_CREDITS) throw fail(400, 'INVALID_CREDITS');
      const next = balance(row, credits);
      await db.query('UPDATE clients SET credits=$1, free_used=$2 WHERE id=$3', [next.credits, next.freeUsed, id]);
      return toUser(await byId(id));
    },
    /** Admin edit of one client. Only whitelisted fields; credits are the displayed balance (free design included). */
    update: async (id, patch) => {
      if (patch.credits !== undefined && (!Number.isSafeInteger(patch.credits) || patch.credits < 0 || patch.credits > MAX_CREDITS)) throw fail(400, 'INVALID_CREDITS');
      if (patch.blocked !== undefined && typeof patch.blocked !== 'boolean') throw fail(400, 'INVALID_BLOCKED');
      return db.tx(async q => {
        const row = (await q('SELECT ' + COLS + ' FROM clients WHERE id=$1 FOR UPDATE', [id]))[0];
        if (!row) throw fail(404, 'NOT_FOUND');
        if (patch.credits !== undefined) { const next = balance(row, patch.credits); await q('UPDATE clients SET credits=$1, free_used=$2 WHERE id=$3', [next.credits, next.freeUsed, id]); }
        if (patch.blocked !== undefined) await q('UPDATE clients SET blocked=$1 WHERE id=$2', [patch.blocked ? 1 : 0, id]);
        return toUser(await byId(id, q));
      });
    },
    /**
     * Admin bulk action on many clients in ONE transaction (all or nothing).
     * action: block | unblock | delete | credits(mode: set | add | subtract, amount).
     */
    bulk: async ({ ids, action, mode, amount }) => {
      if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9-]{8,64}$/.test(id))) throw fail(400, 'INVALID_IDS');
      if (!['block', 'unblock', 'delete', 'credits'].includes(action)) throw fail(400, 'INVALID_ACTION');
      if (action === 'credits') {
        if (!['set', 'add', 'subtract'].includes(mode) || !Number.isSafeInteger(amount) || amount < 0 || amount > MAX_CREDITS) throw fail(400, 'INVALID_CREDITS');
      }
      const unique = [...new Set(ids)];
      return db.tx(async q => {
        const rows = [];
        for (const id of unique.sort()) { // stable lock order avoids deadlocks between concurrent bulk calls
          const row = (await q('SELECT ' + COLS + ' FROM clients WHERE id=$1 FOR UPDATE', [id]))[0];
          if (row) rows.push(row);
        }
        for (const row of rows) {
          if (action === 'delete') await q('DELETE FROM clients WHERE id=$1', [row.id]);
          else if (action === 'block' || action === 'unblock') await q('UPDATE clients SET blocked=$1 WHERE id=$2', [action === 'block' ? 1 : 0, row.id]);
          else {
            const shown = row.credits + (row.free_used ? 0 : 1);
            const next = Math.min(MAX_CREDITS, Math.max(0, mode === 'set' ? amount : mode === 'add' ? shown + amount : shown - amount));
            const stored = balance(row, next);
            await q('UPDATE clients SET credits=$1, free_used=$2 WHERE id=$3', [stored.credits, stored.freeUsed, row.id]);
          }
        }
        const users = [];
        if (action !== 'delete') for (const row of rows) users.push(toUser(await byId(row.id, q)));
        return { affected: rows.length, users };
      });
    },
    remove: async id => {
      const rows = await db.query('DELETE FROM clients WHERE id=$1 RETURNING id', [id]);
      if (!rows.length) throw fail(404, 'NOT_FOUND');
    },
    removeSpace: (client, kind, id) => db.query('DELETE FROM space WHERE id=$1 AND client_id=$2 AND kind=$3', [id, client.id, kind]),
  };
}
module.exports = { createClients, canonicalPhone };
