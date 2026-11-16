// Content calendar: spreadsheet import and the AI assistant (against a fake Anthropic server).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let t, admin, employee, clientId;
test.before(async () => {
  t = await startServer({ ai: true });
  admin = await t.admin();
  employee = await t.employee();
  const c = await t.call('POST', '/api/clients', { token: admin, body: { name: 'Chai Theatre', short_name: 'CT', business_type: 'Cafe', brand_voice: 'Warm, playful, short sentences' } });
  clientId = c.body.id;
});
test.after(async () => t.stop());

const items = (token) => t.call('GET', `/api/content?client_id=${clientId}`, { token }).then((r) => r.body.items);

test('import adds cards on their dates and skips duplicates, bad dates and missing titles', async () => {
  const r = await t.call('POST', '/api/content/import', {
    token: admin,
    body: {
      client_id: clientId,
      items: [
        { title: 'Cold coffee pour', date: '2026-12-01', kind: 'reel', caption: 'Summer', link: 'https://x.test' },
        { title: 'Menu carousel', date: '2026-12-03', kind: 'Carousel' },
        { title: 'Cold coffee pour', date: '2026-12-01' }, // duplicate
        { title: 'Bad date', date: '2026-13-45' },
        { title: '', date: '2026-12-05' },
        { title: 'Undated idea', date: '' },
      ],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.added, 3);
  assert.equal(r.body.first_date, '2026-12-01');
  assert.equal(r.body.last_date, '2026-12-03');
  const reasons = r.body.skipped.map((s) => s.reason).join('|');
  assert.match(reasons, /already on the calendar/);
  assert.match(reasons, /date not understood/);
  assert.match(reasons, /missing title/);
  const saved = await items(admin);
  assert.ok(saved.find((i) => i.title === 'Cold coffee pour' && i.scheduled_date === '2026-12-01' && i.kind === 'Reel'));
});

test('import validates the client and the size of the file', async () => {
  assert.equal((await t.call('POST', '/api/content/import', { token: admin, body: { client_id: 99999, items: [{ title: 'x' }] } })).status, 400);
  assert.equal((await t.call('POST', '/api/content/import', { token: admin, body: { client_id: clientId, items: [] } })).status, 400);
  const many = Array.from({ length: 301 }, (_, i) => ({ title: 'T' + i }));
  assert.equal((await t.call('POST', '/api/content/import', { token: admin, body: { client_id: clientId, items: many } })).status, 400);
});

test('an employee cannot import a card straight into the Approved stage', async () => {
  await t.call('POST', '/api/content/import', { token: employee, body: { client_id: clientId, items: [{ title: 'Sneaky approved', date: '2026-12-09', stage: 'Approved' }] } });
  const row = (await items(admin)).find((i) => i.title === 'Sneaky approved');
  assert.equal(row.stage, 'Idea');
});

test('AI caption: uses the brand voice and a past approved caption, and returns validated JSON', async () => {
  await t.call('POST', '/api/content', { token: admin, body: { client_id: clientId, title: 'Cold brew pour', kind: 'Reel', stage: 'Approved', caption: 'Slow pour, big flavour.' } });
  const r = await t.call('POST', '/api/content/ai/caption', { token: admin, body: { client_id: clientId, title: 'Iced coffee summer special', kind: 'Reel' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.caption, 'Cold brew season is here');
  assert.deepEqual(r.body.hashtags, ['#coldbrew', '#cafelife']); // missing "#" is added
  assert.equal(r.body.used_examples.length, 1);
  const prompt = t.mock.state.requests.at(-1).user;
  assert.match(prompt, /Warm, playful, short sentences/); // brand voice reached the model
  assert.match(prompt, /Slow pour, big flavour/); // retrieved example reached the model
});

test('AI: a reply wrapped in code fences is still parsed', async () => {
  t.mock.state.mode = 'fenced';
  const r = await t.call('POST', '/api/content/ai/script', { token: admin, body: { client_id: clientId, title: 'Iced coffee', kind: 'Reel' } });
  t.mock.state.mode = 'json';
  assert.equal(r.status, 200);
  assert.equal(r.body.shots.length, 2);
});

test('AI ideas: unknown formats fall back to Reel and the count is capped', async () => {
  const r = await t.call('POST', '/api/content/ai/ideas', { token: admin, body: { client_id: clientId, month: '2026-12', count: 99 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ideas[1].kind, 'Reel'); // "Nope" is not a real format
});

test('AI: a reply that is not JSON ends in a clear error and is retried', async () => {
  t.mock.state.mode = 'garbage';
  const before = t.mock.state.requests.length;
  const r = await t.call('POST', '/api/content/ai/caption', { token: admin, body: { client_id: clientId, title: 'Anything', kind: 'Post' } });
  t.mock.state.mode = 'json';
  assert.equal(r.status, 502);
  assert.ok(t.mock.state.requests.length - before >= 2, 'should have retried');
});

test('AI: a missing title or client is rejected before any model call', async () => {
  const before = t.mock.state.requests.length;
  assert.equal((await t.call('POST', '/api/content/ai/caption', { token: admin, body: { client_id: clientId } })).status, 400);
  assert.equal((await t.call('POST', '/api/content/ai/caption', { token: admin, body: { title: 'x' } })).status, 400);
  assert.equal(t.mock.state.requests.length, before);
});

test('AI usage is logged per feature and the monthly token cap stops further calls', async () => {
  const status = await t.call('GET', '/api/content/ai/status', { token: admin });
  assert.equal(status.body.enabled, true);
  assert.ok(status.body.usage.tokens_used > 0);
  assert.ok(status.body.usage.by_feature.some((f) => f.feature === 'caption'));
  // employees do not see usage numbers
  assert.equal((await t.call('GET', '/api/content/ai/status', { token: employee })).body.usage, undefined);

  process.env.AI_MONTHLY_TOKEN_CAP = '1';
  const r = await t.call('POST', '/api/content/ai/caption', { token: admin, body: { client_id: clientId, title: 'Over the cap', kind: 'Post' } });
  delete process.env.AI_MONTHLY_TOKEN_CAP;
  assert.equal(r.status, 429);
  assert.match(r.body.error, /limit/i);
});
