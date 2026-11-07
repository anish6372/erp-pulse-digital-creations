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
