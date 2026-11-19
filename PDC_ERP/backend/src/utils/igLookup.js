// Looks up a public Instagram Business/Creator account's follower count and latest post date
// through Meta's Business Discovery API, using an Instagram account already connected on the
// Social page. Personal (non-business) accounts can't be looked up this way - Meta doesn't allow it.
const { db } = require('../db');
const { decryptSecret } = require('./crypto');

const GRAPH_BASE = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}`;

/** "@name", "name" or an instagram.com URL -> "name" (or '' if it doesn't look like a handle). */
function igHandle(value) {
  let v = String(value || '').trim();
  if (!v) return '';
  if (/instagram\.com/i.test(v)) v = v.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
  v = v.replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(v) ? v : '';
}

/** A connected account to ask with: { igUserId, token }, or null if none is connected. */
function lookupAccount() {
  const rows = db.prepare('SELECT ig_user_id, access_token FROM marketing_instagram_accounts ORDER BY connected_at DESC').all();
  for (const r of rows) {
    try {
      return { igUserId: r.ig_user_id, token: decryptSecret(r.access_token) };
    } catch (e) {
      /* stored with an old key - try the next one */
    }
  }
  return null;
}

/**
 * Returns { followers, last_post_days, posting_frequency } or null when it can't be looked up
 * (no connected account, not a business/creator account, private, or not found).
 */
async function lookupInstagram(handleValue) {
  const handle = igHandle(handleValue);
  if (!handle) return null;
  const acct = lookupAccount();
  if (!acct) return null;
  const url = new URL(`${GRAPH_BASE}/${acct.igUserId}`);
  url.searchParams.set('fields', `business_discovery.username(${handle}){followers_count,media_count,media.limit(10){timestamp}}`);
  url.searchParams.set('access_token', acct.token);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const d = await res.json();
    const bd = d && d.business_discovery;
    if (!res.ok || !bd) return null;
    const stamps = ((bd.media && bd.media.data) || []).map((m) => Date.parse(m.timestamp)).filter(Number.isFinite).sort((a, b) => b - a);
    const dayMs = 86400000;
    const lastPostDays = stamps.length ? Math.max(0, Math.floor((Date.now() - stamps[0]) / dayMs)) : null;
    let freq = '';
    if (stamps.length >= 2) {
      const spanDays = Math.max(1, (stamps[0] - stamps[stamps.length - 1]) / dayMs);
      const perWeek = ((stamps.length - 1) / spanDays) * 7;
      freq = perWeek >= 5 ? 'Daily' : perWeek >= 2 ? 'A few times a week' : perWeek >= 0.8 ? 'Weekly' : perWeek >= 0.25 ? 'A few times a month' : 'Rarely';
    }
    return { followers: bd.followers_count ?? null, last_post_days: lastPostDays, posting_frequency: freq };
  } catch (e) {
    return null;
  }
}

module.exports = { igHandle, lookupInstagram };
