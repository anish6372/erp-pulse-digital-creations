// Pure-logic tests: lead scoring, market estimate, search-query building, cache, job queue.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pdc-unit-'));
delete process.env.REDIS_URL;

const { computeScore, estimateMarket } = require('../src/utils/hunterData');
const { toFtsQuery } = require('../src/utils/contentAI');
const { cached, invalidate } = require('../src/utils/cache');
const jobs = require('../src/utils/jobs');

const NOW = new Date().toISOString();
const weak = { website: { score: 1 }, instagram: { score: 1 }, gmb: { score: 1 } };

test('scoring: a fresh, reachable lead with weak online presence is hot', () => {
  const r = computeScore({ niche: 'dental', city: 'Bangalore', channels: weak, signalAt: NOW, signalType: 'agency_request', contacts: { email: 'a@b.co', instagram: '@x' } });
  assert.ok(r.score >= 70, `score ${r.score}`);
  assert.equal(r.tier, 'hot');
});

test('scoring: no signal and no contact details is parked', () => {
  const r = computeScore({ niche: 'other', city: 'London', channels: {}, signalAt: null, signalType: 'manual', contacts: {} });
  assert.equal(r.tier, 'parked');
  assert.ok(r.score >= 0 && r.score <= 100);
});

test('scoring: a high score is not "hot" when the lead cannot be reached', () => {
  const r = computeScore({ niche: 'dental', city: 'Bangalore', channels: weak, signalAt: NOW, signalType: 'agency_request', contacts: {} });
  assert.notEqual(r.tier, 'hot'); // hot needs a reach score of at least 45
});

test('scoring: an older signal is worth less than a fresh one', () => {
  const old = new Date(Date.now() - 45 * 86400000).toISOString();
  const fresh = computeScore({ niche: 'dental', city: 'Pune', channels: weak, signalAt: NOW, signalType: 'new_opening', contacts: { email: 'a@b.co' } });
  const stale = computeScore({ niche: 'dental', city: 'Pune', channels: weak, signalAt: old, signalType: 'new_opening', contacts: { email: 'a@b.co' } });
  assert.ok(fresh.intent > stale.intent);
});

test('market estimate: Bangalore is weighted above Dubai and projects scale with the period', () => {
  const blr = estimateMarket({ niche: 'dental', city: 'Bangalore', months: 2 });
  const dxb = estimateMarket({ niche: 'dental', city: 'Dubai', months: 2 });
  assert.ok(blr.monthly_spend_estimate > dxb.monthly_spend_estimate);
  const six = estimateMarket({ niche: 'dental', city: 'Bangalore', months: 6 });
  assert.equal(six.projects_estimate, blr.projects_estimate * 3);
});

test('search query: punctuation becomes plain OR-ed, de-duplicated words (safe for FTS5)', () => {
  assert.equal(toFtsQuery('Iced coffee!! summer (special) coffee'), '"iced" OR "coffee" OR "summer" OR "special"');
});

test('search query: empty or too-short input gives an empty query', () => {
  assert.equal(toFtsQuery(''), '');
  assert.equal(toFtsQuery('a to I'), '');
});

test('search query: capped at 12 words', () => {
  const q = toFtsQuery(Array.from({ length: 30 }, (_, i) => 'word' + i).join(' '));
  assert.equal(q.split(' OR ').length, 12);
});

test('cache: computes once, then serves from cache until invalidated', async () => {
  let calls = 0;
  const compute = () => ++calls;
  assert.equal(await cached('t:a', 60, compute), 1);
  assert.equal(await cached('t:a', 60, compute), 1);
  await invalidate('t:');
  assert.equal(await cached('t:a', 60, compute), 2);
});

test('job queue: runs a job in the background and reports progress and result', async () => {
  jobs.register('unit-ok', async (data, { progress }) => {
    await progress({ done: 1, total: 2, message: 'half' });
    return { doubled: data.n * 2 };
  });
  const id = await jobs.enqueue('unit-ok', { n: 21, userId: 1 });
  let j;
  for (let i = 0; i < 50; i++) {
    j = await jobs.getJob(id);
    if (j.state === 'completed') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(j.state, 'completed');
  assert.deepEqual(j.result, { doubled: 42 });
  assert.equal(j.progress.message, 'half');
});

test('job queue: a throwing job ends as failed with its message', async () => {
  jobs.register('unit-fail', async () => {
    throw new Error('boom');
  });
  const id = await jobs.enqueue('unit-fail', {});
  let j;
  for (let i = 0; i < 50; i++) {
    j = await jobs.getJob(id);
    if (j.state === 'failed') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(j.state, 'failed');
  assert.equal(j.error, 'boom');
});

test('job queue: unknown job names are rejected', async () => {
  await assert.rejects(() => jobs.enqueue('does-not-exist', {}), /Unknown job/);
});
