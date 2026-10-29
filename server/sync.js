/**
 * Change versions for real-time sync. Every mutation bumps one or more keys in the database; devices poll the tiny
 * /api/sync endpoint and refetch only what changed. The counters live in Postgres, so every serverless instance
 * and every device sees the same numbers.
 *   content        shared app content + settings (public)
 *   requests       all render requests / leads (admin)
 *   clients        client list (admin)
 *   c:<clientId>   one client's profile, credits, history, chats, requests, prefs
 *   a:<adminId>    one admin's preferences
 *
 * `cacheMs` (long-running server only): versions read in the last `cacheMs` are answered from memory, so N open apps
 * polling every few seconds cost about one query per key per `cacheMs` instead of one per poll. A bump made by THIS process
 * drops the keys it changed at once; a change made by another process (another instance, or the www. copy of the site on
 * hosts that run one process per hostname) shows up at most `cacheMs` later.
 */
function createSync(db, { cacheMs = 0 } = {}) {
  const cache = new Map(); // key -> { version, at }
  const bump = async (...keys) => {
    for (const key of [...new Set(keys.filter(Boolean))]) {
      cache.delete(key);
      await db.query('INSERT INTO sync_state(key,version) VALUES($1,1) ON CONFLICT (key) DO UPDATE SET version=sync_state.version+1', [key]);
      cache.delete(key); // a read that started before the write must not keep the old value
    }
  };
  const read = async keys => {
    const now = Date.now();
    const missing = cacheMs > 0 ? keys.filter(key => !(now - (cache.get(key)?.at ?? -Infinity) < cacheMs)) : keys;
    if (missing.length) {
      const rows = await db.query('SELECT key,version FROM sync_state WHERE key = ANY($1)', [missing]);
      const fresh = Object.fromEntries(missing.map(key => [key, Number(rows.find(row => row.key === key)?.version ?? 0)]));
      if (cacheMs > 0) {
        if (cache.size > 5000) for (const [key, entry] of cache) if (now - entry.at >= cacheMs) cache.delete(key);
        for (const key of missing) cache.set(key, { version: fresh[key], at: now });
      }
      if (!cacheMs) return fresh;
      return Object.fromEntries(keys.map(key => [key, key in fresh ? fresh[key] : cache.get(key).version]));
    }
    return Object.fromEntries(keys.map(key => [key, cache.get(key).version]));
  };
  return { bump, read };
}
module.exports = { createSync };
