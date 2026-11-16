// Authentication, role gating and rate limiting.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let t;
test.before(async () => {
  t = await startServer();
});
test.after(async () => t.stop());

test('health endpoint reports ok and that Redis is not configured', async () => {
  const r = await t.call('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.redis.enabled, false);
});

test('protected routes reject requests with no token', async () => {
  assert.equal((await t.call('GET', '/api/bootstrap')).status, 401);
  assert.equal((await t.call('GET', '/api/hunter/dashboard')).status, 401);
});

test('login: wrong password is rejected, right password returns a working token', async () => {
  const bad = await t.call('POST', '/api/login', { body: { user_id: 'admin', password: 'wrong' } });
  assert.equal(bad.status, 401);
  const token = await t.admin();
  assert.ok(token && token.length > 20);
  const boot = await t.call('GET', '/api/bootstrap', { token });
  assert.equal(boot.status, 200);
  assert.equal(boot.body.user.role, 'Admin');
});

test('Client Hunter is limited to Admin and the Sales department', async () => {
  assert.equal((await t.call('GET', '/api/hunter/dashboard', { token: await t.employee() })).status, 403);
  assert.equal((await t.call('GET', '/api/hunter/dashboard', { token: await t.sales() })).status, 200);
  assert.equal((await t.call('GET', '/api/hunter/dashboard', { token: await t.admin() })).status, 200);
});

test('compliance endpoints are Admin-only', async () => {
  assert.equal((await t.call('GET', '/api/compliance/dnc', { token: await t.sales() })).status, 403);
  assert.equal((await t.call('GET', '/api/compliance/dnc', { token: await t.admin() })).status, 200);
});

test('login is rate limited after repeated failures', async () => {
  let blocked = false;
  for (let i = 0; i < 25 && !blocked; i++) {
    const r = await t.call('POST', '/api/login', { body: { user_id: 'nobody', password: 'x' } });
    if (r.status === 429) blocked = true;
  }
  assert.ok(blocked, 'expected a 429 within 25 attempts');
});
