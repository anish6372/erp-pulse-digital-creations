// File uploads and the download-vs-open behaviour used by Deliverables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let t, token, url;
test.before(async () => {
  t = await startServer();
  token = await t.admin();
});
test.after(async () => t.stop());

test('uploading needs a login', async () => {
  assert.equal((await t.call('POST', '/api/uploads', { body: { name: 'a.png', data: PNG } })).status, 401);
});

test('an image uploads and is stored under a unique name', async () => {
  const r = await t.call('POST', '/api/uploads', { token, body: { name: 'Summer Poster v2.png', data: PNG } });
  assert.equal(r.status, 201);
  assert.match(r.body.url, /^\/uploads\/\d+_[0-9a-f]{8}_Summer_Poster_v2\.png$/);
  url = r.body.url;
});

test('disallowed file types are refused', async () => {
  const r = await t.call('POST', '/api/uploads', { token, body: { name: 'run.exe', data: 'data:application/x-msdownload;base64,AAAA' } });
  assert.equal(r.status, 400);
});

test('opening the file normally shows it inline (no forced download)', async () => {
  const res = await t.call('GET', url, { raw: true });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('content-disposition'), null);
});

test('?download=1 forces a download that keeps the original file name', async () => {
  const res = await t.call('GET', url + '?download=1', { raw: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="Summer_Poster_v2\.png"/);
});

test('download links cannot escape the uploads folder and missing files are 404', async () => {
  assert.equal((await t.call('GET', '/uploads/..%2F..%2Fsrc%2Fapp.js?download=1', { raw: true })).status, 404);
  assert.equal((await t.call('GET', '/uploads/nope.png?download=1', { raw: true })).status, 404);
});
