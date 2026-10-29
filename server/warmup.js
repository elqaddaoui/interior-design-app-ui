/**
 * Background database start-up for the long-running server (server/start.js).
 *
 * The HTTP server listens first; this opens the database (connection, schema check / migration, all done lazily by
 * db.info()) afterwards and keeps retrying with a growing delay, because a Neon database that was suspended needs a few
 * seconds (sometimes more) to wake up and the first connections can time out or be refused.
 *
 * Never logs a credential: only an error code or a redacted message.
 */
function warmUp(db, { redact = String, log = console, minDelayMs = 1000, maxDelayMs = 15000, onReady } = {}) {
  const state = { ready: false, attempts: 0, stopped: false, stop: () => { state.stopped = true; clearTimeout(timer); } };
  let timer;
  const attempt = async () => {
    state.attempts++;
    try {
      await db.info();
    } catch (error) {
      if (state.stopped) return;
      const delay = Math.min(maxDelayMs, minDelayMs * 2 ** Math.min(state.attempts - 1, 10));
      // The first attempts and then about one in five: a database that stays down must not flood the log.
      if (state.attempts <= 3 || state.attempts % 5 === 0) {
        log.error(`[dwira] Database not reachable yet (attempt ${state.attempts}, ${redact(error?.code || error?.message || 'unknown error')}). /api/health reports 503 until it is; retrying in ${Math.round(delay / 1000)} s. Check DATABASE_URL if this persists.`);
      }
      timer = setTimeout(attempt, delay);
      timer.unref?.();
      return;
    }
    if (state.stopped) return;
    state.ready = true;
    log.log(`[dwira] Database connected${state.attempts > 1 ? ` (attempt ${state.attempts})` : ''}.`);
    try { await onReady?.(); } catch { /* background work must never take the server down */ }
  };
  void attempt();
  return state;
}

module.exports = { warmUp };
