// Frontend unit tests: spreadsheet date parsing, content-plan CSV reading and small DOM helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toIsoDate } from '../src/lib/dates.js';
import { readContentSheet, TEMPLATE_CSV } from '../src/lib/sheet.js';
import { esc, downloadUrl, fileLabel, externalUrl, initials } from '../src/lib/dom.js';

test('dates: ISO text passes through', () => {
  assert.equal(toIsoDate('2026-12-01'), '2026-12-01');
  assert.equal(toIsoDate('2026/12/1'), '2026-12-01');
});

test('dates: slash dates are read day-first (Indian convention)', () => {
  assert.equal(toIsoDate('03/12/2026'), '2026-12-03');
  assert.equal(toIsoDate('3-12-26'), '2026-12-03');
});

test('dates: day-month-name and month-name-day text', () => {
  assert.equal(toIsoDate('5 Dec 2026'), '2026-12-05');
  assert.equal(toIsoDate('5th December 2026'), '2026-12-05');
  assert.equal(toIsoDate('Dec 5, 2026'), '2026-12-05');
});

test('dates: Date objects from Excel cells use the UTC day (no timezone shift)', () => {
  assert.equal(toIsoDate(new Date(Date.UTC(2026, 11, 1))), '2026-12-01');
});

test('dates: Excel serial numbers', () => {
  assert.equal(toIsoDate(46357), '2026-12-01'); // 1 Dec 2026
});

test('dates: impossible or unreadable values give an empty string', () => {
  assert.equal(toIsoDate('2026-13-45'), '');
  assert.equal(toIsoDate('31/02/2026'), '');
  assert.equal(toIsoDate('not a date'), '');
  assert.equal(toIsoDate(''), '');
  assert.equal(toIsoDate(null), '');
  assert.equal(toIsoDate(12), '');
});

const file = (text, name = 'plan.csv') => new File([text], name, { type: 'text/csv' });

test('content sheet: reads the template and understands loose header names', async () => {
  const r = await readContentSheet(file('Post Date,Topic,Type,Brief\n01/12/2026,Cold coffee pour,reel,Steam rising\n'));
  assert.equal(r.items.length, 1);
  assert.deepEqual({ ...r.items[0] }, { title: 'Cold coffee pour', date: '2026-12-01', kind: 'reel', caption: '', script: 'Steam rising', link: '', stage: '' });
  assert.equal(r.hasDate, true);
});

test('content sheet: the downloadable template round-trips', async () => {
  const r = await readContentSheet(file(TEMPLATE_CSV));
  assert.equal(r.items.length, 2);
  assert.equal(r.items[1].kind, 'Carousel');
  assert.equal(r.problems.length, 0);
});

test('content sheet: quoted commas stay inside one cell', async () => {
  const r = await readContentSheet(file('Date,Title\n2026-12-01,"Brunch, but make it pretty"\n'));
  assert.equal(r.items[0].title, 'Brunch, but make it pretty');
});

test('content sheet: unreadable dates are reported, blank rows ignored', async () => {
  const r = await readContentSheet(file('Date,Title\nsoonish,Idea A\n,\n2026-12-02,Idea B\n'));
  assert.equal(r.items.length, 2);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /Row 2/);
});

test('content sheet: a file without a title column or without rows is rejected with a helpful message', async () => {
  await assert.rejects(() => readContentSheet(file('Date,Colour\n2026-12-01,red\n')), /title column/i);
  await assert.rejects(() => readContentSheet(file('Date,Title\n')), /no data rows/i);
  await assert.rejects(() => readContentSheet(file('x', 'plan.xls')), /\(\.xlsx\) or CSV/i);
});

test('dom helpers: esc escapes HTML so user text cannot inject markup', () => {
  assert.equal(esc('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  assert.equal(esc(null), '');
});

test('dom helpers: uploaded files get a download link and a clean display name', () => {
  assert.equal(downloadUrl('/uploads/1794499957637_e72f0e03_Poster.png'), '/uploads/1794499957637_e72f0e03_Poster.png?download=1');
  assert.equal(downloadUrl('https://drive.google.com/x'), 'https://drive.google.com/x'); // external links are left alone
  assert.equal(fileLabel('/uploads/1794499957637_e72f0e03_Poster.png'), 'Poster.png');
});

test('dom helpers: links without a scheme get https:// so they open instead of 404ing', () => {
  assert.equal(externalUrl('drive.google.com/abc'), 'https://drive.google.com/abc');
  assert.equal(externalUrl('https://x.test'), 'https://x.test');
  assert.equal(initials('Anish Kumar Panda'), 'AK');
});
