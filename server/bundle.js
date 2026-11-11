/**
 * One complete set of backend modules per tenant ("bundle"), all built on that tenant's scoped database handle (server/scope.js).
 *
 * Everything that keeps in-memory state (change-version cache, content snapshot, media metadata cache, campaign tick throttle, notifier
 * keys) lives inside the bundle, so a tenant can never be served another tenant's cached copy: there is no shared map keyed only by a
 * content hash or a sync key. Bundles are created lazily and kept in a small LRU (TENANT_CACHE, default 200); an evicted tenant is simply
 * rebuilt on its next request (every cache is a pure optimisation over rows in Postgres).
 */
const { scopeDb } = require('./scope');
const { createClients } = require('./clients');
const { createAdmins } = require('./admins');
const { createSync } = require('./sync');
const { createContent } = require('./content');
const { createR2Storage } = require('./media');
const { createNotifier } = require('./notifications');
const { createCampaigns } = require('./campaigns');
const { createChat } = require('./chat');
const { createAssistant } = require('./assistant');
const { createImageGen } = require('./imagegen');

const withTimeout = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);

function createBundles({ db, env = process.env, senders, media: mediaOptions = {}, chatFetch, imageFetch } = {}) {
  // One S3 client for the whole process: tenants differ by object-key prefix, not by credentials.
  const storage = 'storage' in mediaOptions ? mediaOptions.storage : createR2Storage(env);
  const cache = new Map();
  const max = Math.max(5, Math.min(2000, Number(env.TENANT_CACHE) || 200));

  function build(tenantId) {
    const tdb = scopeDb(db, tenantId);
    const rowOf = row => JSON.parse(row.data);
    let content;
    const notifier = createNotifier(tdb, env, senders, { settings: () => content.getDoc('settings'), platformDb: db });
    const clients = createClients(tdb);
    // Long-running server: anonymous polls are answered from a 2 s in-memory copy of the versions (local writes invalidate it at once).
    // Serverless instances keep no cache: each one only sees a fraction of the writes.
    const sync = createSync(tdb, { cacheMs: env.VERCEL ? 0 : Math.max(0, Math.min(10000, Number(env.SYNC_CACHE_MS ?? 2000) || 0)) });
    content = createContent(tdb, sync, { env, ...mediaOptions, storage });
    const media = content.media;
    const admins = createAdmins(tdb, { env, sync, media });
    // Campaigns (scheduled / recurring / automated pushes) and the free-provider AI chat. Both are lazy: no work until used.
    const campaigns = createCampaigns(tdb, notifier, { sync, settings: () => content.getDoc('settings') });
    const imagegen = createImageGen(tdb, { env, media, content, sync, ...(imageFetch ? { fetch: imageFetch } : {}) });
    const chat = createChat(tdb, { env, ...(chatFetch ? { fetch: chatFetch } : {}) });
    const assistant = createAssistant(tdb, { chat, content });

    /** Queue a notification. `kind`: request (new demand -> admins) | lead (new client -> admins) | ready (design delivered -> its owner). */
    async function enqueue(kind, jobId, payload) {
      await tdb.query('INSERT INTO outbox(tenant_id,request_id,attempts,next_at,completed,kind,payload) VALUES(:tenant,$1,0,$2,$3,$4,$5) ON CONFLICT (tenant_id,request_id) DO NOTHING', [jobId, Date.now(), '[]', kind, payload ? JSON.stringify(payload) : null]);
    }
    /** Deliver due notification jobs of THIS tenant. A short lease stops concurrent instances sending the same job twice. */
    async function pump(only) {
      try {
        const now = Date.now();
        const due = await tdb.query(only ? 'SELECT * FROM outbox WHERE tenant_id=:tenant AND request_id=$1 AND next_at<=$2' : 'SELECT * FROM outbox WHERE tenant_id=:tenant AND next_at<=$1 ORDER BY next_at LIMIT 20', only ? [only, now] : [now]);
        for (const job of due) {
          const leased = await tdb.query('UPDATE outbox SET next_at=$1 WHERE tenant_id=:tenant AND request_id=$2 AND next_at=$3 RETURNING request_id', [now + 60000, job.request_id, job.next_at]);
          if (!leased.length) continue;
          let item, options;
          if (job.kind === 'request') {
            const demand = (await tdb.query('SELECT data FROM requests WHERE tenant_id=:tenant AND id=$1', [job.request_id]))[0];
            if (demand) { item = rowOf(demand); options = { event: 'request' }; }
          } else {
            const payload = JSON.parse(job.payload || 'null');
            if (payload) { item = payload; options = { event: job.kind, ...(payload.audience ? { audience: payload.audience } : {}) }; }
          }
          if (!item) { await tdb.query('DELETE FROM outbox WHERE tenant_id=:tenant AND request_id=$1', [job.request_id]); continue; }
          try {
            const result = await notifier.deliver(item, JSON.parse(job.completed), options);
            if (!result.retry || job.attempts >= 6) await tdb.query('DELETE FROM outbox WHERE tenant_id=:tenant AND request_id=$1', [job.request_id]);
            else await tdb.query('UPDATE outbox SET completed=$1, attempts=attempts+1, next_at=$2 WHERE tenant_id=:tenant AND request_id=$3', [JSON.stringify(result.completed), Date.now() + Math.min(3600000, 30000 * 2 ** (job.attempts + 1)), job.request_id]);
          } catch { console.warn('Notification job deferred'); }
        }
      } catch { console.warn('Notification queue temporarily unavailable'); }
    }
    return { tenantId, db: tdb, notifier, clients, sync, content, media, admins, campaigns, imagegen, chat, assistant, enqueue, pump };
  }

  return {
    /** The bundle of one tenant (created on first use). The id must come from the tenant registry, never from request data. */
    get(tenantId) {
      let bundle = cache.get(tenantId);
      if (bundle) { cache.delete(tenantId); cache.set(tenantId, bundle); return bundle; }
      bundle = build(tenantId);
      cache.set(tenantId, bundle);
      if (cache.size > max) cache.delete(cache.keys().next().value);
      return bundle;
    },
    /** Forget a tenant's in-memory state (it was edited, suspended, deleted or re-seeded by the super admin). */
    drop: tenantId => void cache.delete(tenantId),
    loaded: () => [...cache.keys()],
    storage,
    /**
     * Tenants that have work for the background timer: a notification job due, or a campaign that can still fire (the default tenant is
     * always included, which keeps the single-tenant behaviour). Suspended tenants are skipped. Reads the raw database on purpose: this
     * only DISCOVERS which tenants to serve; the work itself then runs through each tenant's own bundle.
     */
    async dueTenants(now = Date.now()) {
      const rows = await db.query(`SELECT id FROM (SELECT 'default' AS id UNION SELECT t.id FROM saas_tenants t WHERE t.status <> 'suspended' AND (
        EXISTS (SELECT 1 FROM outbox o WHERE o.tenant_id=t.id AND o.next_at<=$1)
        OR EXISTS (SELECT 1 FROM campaigns c WHERE c.tenant_id=t.id AND c.status IN ('scheduled','active','sending')))) due`, [now]);
      return rows.map(row => row.id);
    },
  };
}
module.exports = { createBundles, withTimeout };
