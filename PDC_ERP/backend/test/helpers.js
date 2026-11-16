// Shared test harness. Every test file runs in its own process (node --test), so each one gets
// a fresh throw-away SQLite database and uploads folder, the real Express app on a random port,
// and - when `ai` is true - a fake Anthropic server so no test ever calls the real API.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

function startMockAnthropic() {
  const state = { requests: [], mode: 'json' };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body);
      state.requests.push({ system: j.system, user: j.messages[0].content });
      let out;
      if (j.system.includes('"ideas"')) out = { ideas: [{ title: 'Monsoon latte pour', kind: 'Reel', hook: 'Rain on glass', why: 'Seasonal' }, { title: 'Barista Q&A', kind: 'Nope', hook: 'Ask us', why: '' }] };
      else if (j.system.includes('"shots"')) out = { hook: 'Steam rises', script: 'Pour, swirl, sip.', shots: ['Close-up pour', 'Cup on table'], on_screen_text: ['Cold brew season'] };
      else out = { caption: 'Cold brew season is here', hashtags: ['#coldbrew', 'cafelife'], cta: 'Visit this weekend' };
      let text = JSON.stringify(out);
      if (state.mode === 'fenced') text = '```json\n' + text + '\n```';
      if (state.mode === 'garbage') text = 'Sorry, I cannot help with that.';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 33 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}/v1/messages` })));
}

async function startServer({ ai = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdc-test-'));
  process.env.DATA_DIR = path.join(dir, 'data');
  process.env.UPLOADS_DIR = path.join(dir, 'uploads');
  process.env.NODE_ENV = 'test';
  delete process.env.REDIS_URL; // tests cover the in-process fallback paths
  delete process.env.APIFY_TOKEN;
  delete process.env.AI_MONTHLY_TOKEN_CAP;

  let mock = null;
  if (ai) {
    mock = await startMockAnthropic();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_URL = mock.url;
  } else {
    delete process.env.ANTHROPIC_API_KEY;
  }

  const { createApp } = require('../src/app');
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, url, { token, body, raw } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (raw) return res;
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* empty body */
    }
    return { status: res.status, body: data };
  }

  const login = async (user, pass) => (await call('POST', '/api/login', { body: { user_id: user, password: pass } })).body?.token;
  const admin = () => login('admin', 'Pdc@2026'); // seeded accounts
  const sales = () => login('priya', 'Priya@2026'); // department: Sales
  const employee = () => login('sidhant', 'Sidhant@2026'); // department: Production

  async function waitForJob(token, id, tries = 60) {
    for (let i = 0; i < tries; i++) {
      const r = await call('GET', '/api/hunter/jobs/' + id, { token });
      if (r.body && (r.body.state === 'completed' || r.body.state === 'failed')) return r.body;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error('job did not finish');
  }

  async function stop() {
    // Close everything so the test process can end on its own (no process.exit, which would
    // cut off the reporting of the last test).
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    if (mock) {
      mock.server.closeAllConnections?.();
      await new Promise((r) => mock.server.close(r));
    }
    try {
      await require('../src/utils/jobs').closeJobs();
    } catch (e) {
      /* no queue in these tests */
    }
  }

  return { base, call, login, admin, sales, employee, waitForJob, mock, stop };
}

module.exports = { startServer };
