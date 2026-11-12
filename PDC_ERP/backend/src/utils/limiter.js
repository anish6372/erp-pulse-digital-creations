// Rate limiter factory. With Redis the counters live there (so limits survive a restart or
// deploy and are shared); without it, express-rate-limit's in-memory store is used.
// passOnStoreError: if Redis is down or slow, let the request through (limits are not
// enforced during an outage) instead of failing it.
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedis, isEnabled, isReady, withTimeout } = require('./redis');

function makeLimiter({ windowMs, limit, message, prefix }) {
  const opts = { windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: message }, passOnStoreError: true };
  if (isEnabled()) {
    const r = getRedis();
    const store = new RedisStore({ prefix: `erp:rl:${prefix}:`, sendCommand: (...args) => (isReady() ? withTimeout(r.call(...args)) : Promise.reject(new Error('redis not ready'))) });
    // The store loads its Lua script in the background at start-up; if Redis is down at that
    // moment the rejection would otherwise be unhandled and crash the process.
    for (const k of ['incrementScriptSha', 'getScriptSha']) if (store[k] && store[k].catch) store[k].catch(() => {});
    opts.store = store;
  }
  return rateLimit(opts);
}

module.exports = { makeLimiter };
