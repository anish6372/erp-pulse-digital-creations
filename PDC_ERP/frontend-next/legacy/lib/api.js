import { state } from './state.js';

export async function api(path, opt = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opt.headers || {}) };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const r = await fetch(path, { ...opt, headers });
  let d = {};
  try {
    d = await r.json();
  } catch (e) {
    /* empty body */
  }
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Start a background job (the POST returns 202 + a job id) and wait for it, reporting
// progress. Resolves with the job's result; rejects with the job's error message.
export async function runJob(path, body, onProgress) {
  const { job_id } = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
  let failures = 0;
  for (;;) {
    await sleep(1200);
    let j;
    try {
      j = await api('/api/hunter/jobs/' + encodeURIComponent(job_id));
      failures = 0;
    } catch (e) {
      if (++failures >= 5) throw e; // tolerate a brief network blip, not a dead job
      continue;
    }
    if (onProgress && j.progress) onProgress(j.progress);
    if (j.state === 'completed') return j.result;
    if (j.state === 'failed') throw new Error(j.error || 'Job failed');
  }
}
