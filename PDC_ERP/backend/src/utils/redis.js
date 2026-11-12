// Optional Redis. If REDIS_URL is not set (local dev, or Redis is down) the app keeps working:
// the cache, rate limiter and job queue each fall back to in-process versions. Redis adds
// durability (limits and queued jobs survive a restart) and a place to share state.
const IORedis = require('ioredis');

const url = () => process.env.REDIS_URL || '';
const isEnabled = () => !!url();

let general = null; // cache + rate-limit commands: give up after one retry when Redis is unavailable
let bull = null; // BullMQ needs maxRetriesPerRequest=null (it blocks on commands by design)

function logOnce(label) {
  let said = false;
  return (e) => {
    if (said) return;
    said = true;
    console.warn(`[redis:${label}] ${e.code || e.message} - falling back to in-process behaviour until it reconnects`);
  };
}

function getRedis() {
  if (!isEnabled()) return null;
  if (!general) {
    general = new IORedis(url(), { maxRetriesPerRequest: 1, connectTimeout: 3000 });
    general.on('error', logOnce('general'));
    general.on('ready', () => console.log('[redis] connected'));
  }
  return general;
}

// A separate connection for BullMQ (see note above).
function getBullConnection() {
  if (!isEnabled()) return null;
  if (!bull) {
    bull = new IORedis(url(), { maxRetriesPerRequest: null });
    bull.on('error', logOnce('queue'));
  }
  return bull;
}

// True only when the connection is up right now. Every caller checks this first, so an outage
// switches to the in-process fallback immediately instead of waiting on Redis timeouts.
const isReady = () => !!general && general.status === 'ready';

// Reject if `promise` takes longer than `ms` (a Redis call must never hold up a web request).
const withTimeout = (promise, ms = 1500) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('redis timeout')), ms).unref())]);

async function redisStatus() {
  if (!isEnabled()) return { enabled: false, ok: false };
  if (!isReady()) return { enabled: true, ok: false };
  try {
    return { enabled: true, ok: (await withTimeout(general.ping())) === 'PONG' };
  } catch (e) {
    return { enabled: true, ok: false };
  }
}

module.exports = { isEnabled, isReady, withTimeout, getRedis, getBullConnection, redisStatus };
