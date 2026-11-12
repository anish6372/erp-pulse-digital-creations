// Small read-through cache: cached(key, ttlSeconds, compute). Uses Redis when available so the
// value is shared and survives restarts; otherwise a per-process Map with expiry. A cache
// failure never breaks a request - it just recomputes.
const { getRedis, isReady, withTimeout } = require('./redis');

const mem = new Map(); // key -> { v, exp }
const PREFIX = 'erp:cache:';

async function cached(key, ttlSeconds, compute) {
  const r = getRedis();
  if (r && isReady()) {
    try {
      const hit = await withTimeout(r.get(PREFIX + key));
      if (hit !== null) return JSON.parse(hit);
      const v = await compute();
      await withTimeout(r.set(PREFIX + key, JSON.stringify(v), 'EX', ttlSeconds));
      return v;
    } catch (e) {
      /* Redis unavailable - fall through to the in-memory path below */
    }
  }
  const m = mem.get(key);
  if (m && m.exp > Date.now()) return m.v;
  const v = await compute();
  mem.set(key, { v, exp: Date.now() + ttlSeconds * 1000 });
  return v;
}

// Drop every cached key that starts with `prefix` (call after the underlying data changes).
async function invalidate(prefix) {
  for (const k of mem.keys()) if (k.startsWith(prefix)) mem.delete(k);
  const r = getRedis();
  if (!r || !isReady()) return;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await withTimeout(r.scan(cursor, 'MATCH', PREFIX + prefix + '*', 'COUNT', 100));
      cursor = next;
      if (keys.length) await withTimeout(r.del(...keys));
    } while (cursor !== '0');
  } catch (e) {
    /* best effort - entries expire on their own TTL anyway */
  }
}

module.exports = { cached, invalidate };
