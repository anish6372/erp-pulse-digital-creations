// Client Hunter: lead scoring through the API, do-not-contact, background bulk import, job access, caching.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let t, admin, sales, employee;
test.before(async () => {
  t = await startServer(); // AI off: no outreach drafting, no network
  admin = await t.admin();
  sales = await t.sales();
  employee = await t.employee();
});
test.after(async () => t.stop());

test('adding a lead scores and stores it', async () => {
  const r = await t.call('POST', '/api/hunter/leads', { token: sales, body: { name: 'Smile Dental', niche: 'dental', city: 'Bangalore', email: 'hello@smile.test', signal_type: 'new_opening' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.lead.name, 'Smile Dental');
  assert.ok(r.body.lead.score > 0 && r.body.lead.score <= 100);
  assert.ok(['hot', 'warm', 'parked'].includes(r.body.lead.tier));
  const list = await t.call('GET', '/api/hunter/leads?q=smile', { token: sales });
  assert.equal(list.body.rows.length, 1);
});

test('a lead needs a business name', async () => {
  const r = await t.call('POST', '/api/hunter/leads', { token: sales, body: { name: '  ', niche: 'dental' } });
  assert.equal(r.status, 400);
});

test('a contact on the do-not-contact list is refused', async () => {
  const add = await t.call('POST', '/api/compliance/dnc', { token: admin, body: { type: 'email', value: 'stop@me.test', reason: 'asked' } });
  assert.ok(add.status < 300, JSON.stringify(add.body));
  const r = await t.call('POST', '/api/hunter/leads', { token: sales, body: { name: 'Blocked Cafe', niche: 'cafe_restaurant', city: 'Pune', email: 'STOP@me.test' } });
  assert.equal(r.status, 409);
});

test('bulk import runs as a background job and reports added, duplicate and invalid rows', async () => {
  const rows = [
    { name: 'Bulk Alpha', niche: 'dental', city: 'Mumbai', instagram: '@alpha' },
    { name: 'Bulk Beta', niche: 'jewellery', city: 'Pune' },
    { name: 'Bulk Alpha', niche: 'dental', city: 'Mumbai' }, // duplicate of row 1
    { name: '', niche: 'dental', city: 'Pune' }, // no name
    { name: 'On The List', niche: 'dental', city: 'Pune', email: 'stop@me.test' }, // do-not-contact
  ];
  const start = await t.call('POST', '/api/hunter/leads/bulk', { token: sales, body: { rows } });
  assert.equal(start.status, 202);
  assert.ok(start.body.job_id);
  const job = await t.waitForJob(sales, start.body.job_id);
  assert.equal(job.state, 'completed');
  assert.equal(job.result.added, 2);
  const reasons = job.result.skipped.map((s) => s.reason).join('|');
  assert.match(reasons, /already in your leads/);
  assert.match(reasons, /missing name/);
  assert.match(reasons, /do-not-contact/);
  assert.equal(job.progress.total, 5);
});

test('bulk import rejects an empty file and more than 200 rows', async () => {
  assert.equal((await t.call('POST', '/api/hunter/leads/bulk', { token: sales, body: { rows: [] } })).status, 400);
  const many = Array.from({ length: 201 }, (_, i) => ({ name: 'L' + i }));
  assert.equal((await t.call('POST', '/api/hunter/leads/bulk', { token: sales, body: { rows: many } })).status, 400);
});

test("a job can only be read by the person who started it (or an admin)", async () => {
  const start = await t.call('POST', '/api/hunter/leads/bulk', { token: sales, body: { rows: [{ name: 'Private Job Lead', niche: 'dental', city: 'Chennai' }] } });
  await t.waitForJob(sales, start.body.job_id);
  assert.equal((await t.call('GET', '/api/hunter/jobs/' + start.body.job_id, { token: admin })).status, 200);
  assert.equal((await t.call('GET', '/api/hunter/jobs/' + start.body.job_id, { token: employee })).status, 403); // not Sales/Admin at all
  assert.equal((await t.call('GET', '/api/hunter/jobs/does-not-exist', { token: sales })).status, 404);
});

test('running a Hunt without an Apify token is refused clearly', async () => {
  const created = await t.call('POST', '/api/hunter/hunts', { token: sales, body: { niche: 'dental', city: 'Bangalore' } });
  const r = await t.call('POST', `/api/hunter/hunts/${created.body.id}/run`, { token: sales });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not configured/i);
});

test('dashboard counts update straight after a write (cache is cleared on change)', async () => {
  const total = async () => (await t.call('GET', '/api/hunter/dashboard', { token: sales })).body.cities.reduce((a, c) => a + c.lead_count, 0);
  const before = await total();
  await t.call('POST', '/api/hunter/leads', { token: sales, body: { name: 'Cache Probe', niche: 'saas', city: 'Hyderabad' } });
  assert.equal(await total(), before + 1);
});

test('market endpoint returns an estimate, neighbourhood landmarks and only this city\'s pinned leads', async () => {
  await t.call('POST', '/api/hunter/leads', { token: sales, body: { name: 'Pinned Place', niche: 'dental', city: 'Bangalore', lat: 12.9352, lng: 77.6245 } });
  const r = await t.call('GET', '/api/hunter/market?niche=dental&city=Bangalore&months=2', { token: sales });
  assert.equal(r.status, 200);
  assert.ok(r.body.estimate.monthly_spend_estimate > 0);
  assert.ok(r.body.localities.some((l) => l.name === 'Koramangala'));
  assert.ok(r.body.points.some((p) => p.name === 'Pinned Place' && p.lat === 12.9352));
  assert.ok(r.body.points.every((p) => p.name !== 'Bulk Alpha')); // a Mumbai lead is not on the Bangalore map
});

test('notes: the team logs what the AI got wrong, resolves and deletes it', async () => {
  const lead = await t.call('POST', '/api/hunter/leads', { token: sales, body: { name: 'Note Dental', niche: 'dental', city: 'Pune' } });
  const made = await t.call('POST', '/api/hunter/notes', { token: sales, body: { kind: 'Wrong data', lead_id: lead.body.lead.id, note: 'Phone number is wrong', ai_said: '99999', should_be: '88888' } });
  assert.equal(made.status, 201);
  assert.equal((await t.call('POST', '/api/hunter/notes', { token: sales, body: { note: '   ' } })).status, 400);
  assert.equal((await t.call('POST', '/api/hunter/notes', { token: sales, body: { note: 'x', lead_id: 999999 } })).status, 400);
  const open = await t.call('GET', '/api/hunter/notes?status=Open', { token: admin });
  const row = open.body.rows.find((r) => r.id === made.body.id);
  assert.equal(row.lead_name, 'Note Dental');
  assert.equal(row.status, 'Open');
  assert.equal((await t.call('GET', '/api/hunter/notes', { token: employee })).status, 403); // not Sales/Admin
  assert.equal((await t.call('PUT', '/api/hunter/notes/' + made.body.id, { token: admin, body: { status: 'Resolved' } })).status, 200);
  assert.equal((await t.call('PUT', '/api/hunter/notes/' + made.body.id, { token: admin, body: { status: 'Bogus' } })).status, 400);
  const resolved = await t.call('GET', '/api/hunter/notes?status=Resolved', { token: admin });
  assert.ok(resolved.body.rows.some((r) => r.id === made.body.id && r.resolved_by_name));
  assert.equal((await t.call('DELETE', '/api/hunter/notes/' + made.body.id, { token: sales })).status, 200); // its author
  assert.equal((await t.call('DELETE', '/api/hunter/notes/' + made.body.id, { token: admin })).status, 404);
});

