const express = require('express');
const { db } = require('../db');
const { now, today } = require('../utils/datetime');
const { uid, canEncryptSecrets, encryptSecret, decryptSecret } = require('../utils/crypto');
const { audit } = require('../utils/audit');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// v22+ is needed for the `views` metric. Old versions are retired by Meta after ~2 years, so keep this current.
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

// One-time-use OAuth state tokens, held in memory only for the few minutes the
// popup is open. No DB table needed â€” these are meaningless once the flow ends.
const pendingOAuth = new Map();
function cleanupPending() {
  const t = Date.now();
  for (const [k, v] of pendingOAuth) if (v.expiresAt < t) pendingOAuth.delete(k);
}

function metaConfigured() {
  return !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_REDIRECT_URI);
}

async function graphGet(path, params) {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const msg = data?.error?.message || `Instagram API request failed (${r.status})`;
    throw new Error(msg);
  }
  return data;
}

// --- Connection status / disconnect ----------------------------------------

router.get('/instagram/status', requireAdmin, (req, res) => {
  const clientId = Number(req.query.client_id);
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  const row = db.prepare('SELECT ig_username, connected_at, last_synced_at FROM marketing_instagram_accounts WHERE client_id=?').get(clientId);
  res.json({
    configured: metaConfigured() && canEncryptSecrets(),
    connected: !!row,
    username: row?.ig_username || null,
    connected_at: row?.connected_at || null,
    last_synced_at: row?.last_synced_at || null,
  });
});

router.post('/instagram/disconnect', requireAdmin, (req, res) => {
  const admin = req.user;
  const clientId = Number((req.body || {}).client_id);
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  db.prepare('DELETE FROM marketing_instagram_accounts WHERE client_id=?').run(clientId);
  audit(admin, 'DELETE', 'instagram_account', clientId);
  res.json({ ok: true });
});

// --- Step 1: start the OAuth flow -------------------------------------------

router.get('/instagram/connect/start', requireAdmin, (req, res) => {
  if (!metaConfigured()) {
    return res.status(500).json({ error: 'Instagram integration is not configured yet. Set META_APP_ID, META_APP_SECRET and META_REDIRECT_URI in backend/.env â€” see .env.example.' });
  }
  if (!canEncryptSecrets()) {
    return res.status(500).json({ error: 'INSTAGRAM_TOKEN_KEY is not set in backend/.env â€” required before any Instagram account can be connected, so the access token can be encrypted at rest.' });
  }
  const clientId = Number(req.query.client_id);
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  const client = db.prepare('SELECT id FROM clients WHERE id=?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  cleanupPending();
  const nonce = uid();
  pendingOAuth.set(nonce, { clientId, adminId: req.user.id, expiresAt: Date.now() + 10 * 60 * 1000 });

  const scope = ['instagram_basic', 'instagram_manage_insights', 'pages_show_list', 'business_management'].join(',');
  const url = new URL('https://www.facebook.com/' + GRAPH_VERSION + '/dialog/oauth');
  url.searchParams.set('client_id', process.env.META_APP_ID);
  url.searchParams.set('redirect_uri', process.env.META_REDIRECT_URI);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', nonce);
  url.searchParams.set('response_type', 'code');

  res.json({ url: url.toString() });
});

// --- Step 2: Meta redirects the browser straight here (not our API client) -

router.get('/instagram/callback', async (req, res) => {
  const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
  const sendResult = (ok, message) => {
    // A tiny standalone page (not part of the SPA) that reports back to the
    // window that opened it, then closes itself â€” standard OAuth popup pattern.
    res.set('Content-Type', 'text/html').send(`<!doctype html><html><body style="font-family:sans-serif;padding:24px">
      <p>${ok ? 'Instagram connected. ' : 'Could not connect Instagram. '}${message || ''}</p>
      <script>
        if (window.opener) window.opener.postMessage({ source: 'pdc-instagram-oauth', ok: ${ok ? 'true' : 'false'}, message: ${JSON.stringify(message || '')} }, ${JSON.stringify(frontendOrigin)});
        setTimeout(() => window.close(), ${ok ? 1200 : 4000});
      </script>
    </body></html>`);
  };

  try {
    const { code, state, error_description } = req.query;
    if (error_description) return sendResult(false, String(error_description));

    cleanupPending();
    const pending = state && pendingOAuth.get(String(state));
    if (!pending) return sendResult(false, 'This connection link expired or was already used â€” click Connect Instagram again.');
    pendingOAuth.delete(String(state));

    // Exchange the auth code for a short-lived user token, then for a long-lived one (~60 days).
    const shortLived = await graphGet('oauth/access_token', {
      client_id: process.env.META_APP_ID,
      redirect_uri: process.env.META_REDIRECT_URI,
      client_secret: process.env.META_APP_SECRET,
      code,
    });
    const longLived = await graphGet('oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: shortLived.access_token,
    });

    // Find a Facebook Page the user manages that has an Instagram Business Account linked.
    const pages = await graphGet('me/accounts', { access_token: longLived.access_token });
    let found = null;
    for (const page of pages.data || []) {
      const pageInfo = await graphGet(page.id, { fields: 'instagram_business_account', access_token: page.access_token });
      if (pageInfo.instagram_business_account?.id) {
        found = { pageId: page.id, pageToken: page.access_token, igUserId: pageInfo.instagram_business_account.id };
        break;
      }
    }
    if (!found) return sendResult(false, "No Instagram Business/Creator account linked to any Facebook Page you manage. Link the client's Instagram to a Facebook Page first, then try again.");

    const igInfo = await graphGet(found.igUserId, { fields: 'username', access_token: found.pageToken });

    const ts = now();
    const expiresAt = longLived.expires_in ? new Date(Date.now() + Number(longLived.expires_in) * 1000).toISOString() : null;
    db.prepare(
      `INSERT INTO marketing_instagram_accounts(client_id, ig_user_id, ig_username, page_id, access_token, token_expires_at, connected_by, connected_at)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(client_id) DO UPDATE SET ig_user_id=excluded.ig_user_id, ig_username=excluded.ig_username, page_id=excluded.page_id,
         access_token=excluded.access_token, token_expires_at=excluded.token_expires_at, connected_by=excluded.connected_by, connected_at=excluded.connected_at`
    ).run(pending.clientId, found.igUserId, igInfo.username || '', found.pageId, encryptSecret(found.pageToken), expiresAt, pending.adminId, ts);

    audit({ id: pending.adminId }, 'CREATE', 'instagram_account', pending.clientId, igInfo.username || '');
    sendResult(true, `Connected @${igInfo.username || 'instagram'}.`);
  } catch (e) {
    sendResult(false, e.message || 'Unexpected error during Instagram connect.');
  }
});

// --- Step 3: sync real data into marketing_reels / audience / reach tables --

const DEMO_METRICS = [
  { metric: 'reached_audience_demographics', audience: 'reached', extra: { timeframe: 'last_30_days' } },
  { metric: 'follower_demographics', audience: 'followers', extra: {} },
];
const DEMO_BREAKDOWNS = ['country', 'city', 'age', 'gender'];
const GENDER_LABELS = { F: 'Female', M: 'Male', U: 'Unknown' };
let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch (e) {
  /* older ICU: show raw codes */
}

function demoLabel(breakdown, raw) {
  if (breakdown === 'gender') return GENDER_LABELS[raw] || raw;
  if (breakdown === 'country') {
    try {
      return (regionNames && regionNames.of(raw)) || raw;
    } catch (e) {
      return raw;
    }
  }
  return raw;
}

function postTypeOf(item) {
  if (item.media_product_type === 'REELS') return 'Reel';
  if (item.media_type === 'CAROUSEL_ALBUM') return 'Carousel';
  if (item.media_type === 'VIDEO') return 'Video';
  return 'Image';
}

// Meta rejects the whole request if any one metric is invalid for that post type or API version,
// so try the richest set first and fall back to simpler ones.
const POST_METRIC_SETS = [
  'reach,views,saved,shares,total_interactions',
  'reach,plays,saved,shares,total_interactions',
  'reach,saved,shares,total_interactions',
  'reach',
];
async function postInsights(id, token) {
  for (const metric of POST_METRIC_SETS) {
    try {
      const d = await graphGet(`${id}/insights`, { metric, access_token: token });
      const out = {};
      for (const m of d.data || []) out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
      return out;
    } catch (e) {
      /* try the next set */
    }
  }
  return {};
}

router.post('/instagram/sync', requireAdmin, async (req, res) => {
  const admin = req.user;
  const clientId = Number((req.body || {}).client_id);
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  const account = db.prepare('SELECT * FROM marketing_instagram_accounts WHERE client_id=?').get(clientId);
  if (!account) return res.status(404).json({ error: 'This client is not connected to Instagram yet.' });

  let token;
  try {
    token = decryptSecret(account.access_token);
  } catch (e) {
    return res.status(500).json({ error: 'Could not decrypt the stored Instagram token — INSTAGRAM_TOKEN_KEY may have changed since this account was connected. Reconnect it.' });
  }

  const warnings = [];
  try {
    // 1) Every recent post — reels, images, videos and carousels — with its own reach.
    const media = await graphGet(`${account.ig_user_id}/media`, {
      fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count',
      limit: 50,
      access_token: token,
    });

    const upsertPost = db.prepare(
      `INSERT INTO marketing_reels(client_id,title,reel_url,posted_at,reach,plays,likes,comments,shares,saves,created_by,created_at,updated_at,source,ig_media_id,post_type)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(client_id, ig_media_id) DO UPDATE SET title=excluded.title, reel_url=excluded.reel_url, reach=excluded.reach, plays=excluded.plays,
         likes=excluded.likes, comments=excluded.comments, shares=excluded.shares, saves=excluded.saves, post_type=excluded.post_type, updated_at=excluded.updated_at`
    );

    let synced = 0;
    for (const item of media.data || []) {
      const insights = await postInsights(item.id, token);
      const ts = now();
      upsertPost.run(
        clientId,
        (item.caption || 'Untitled post').slice(0, 140),
        item.permalink || '',
        item.timestamp ? item.timestamp.slice(0, 10) : today(),
        Number(insights.reach || 0),
        Number(insights.views ?? insights.plays ?? 0),
        Number(item.like_count || 0),
        Number(item.comments_count || 0),
        Number(insights.shares || 0),
        Number(insights.saved || 0),
        admin.id,
        ts,
        ts,
        'instagram',
        item.id,
        postTypeOf(item)
      );
      synced++;
    }

    // 2) Current follower count -> this month's row in the growth chart.
    try {
      const me = await graphGet(account.ig_user_id, { fields: 'followers_count', access_token: token });
      if (Number.isFinite(me.followers_count)) {
        db.prepare(
          `INSERT INTO marketing_growth(client_id,month,followers,created_at) VALUES(?,?,?,?)
           ON CONFLICT(client_id,month) DO UPDATE SET followers=excluded.followers`
        ).run(clientId, today().slice(0, 7), me.followers_count, now());
      }
    } catch (e) {
      warnings.push('Follower count: ' + e.message);
    }

    // 3) Account reach per day for the last 30 days -> the "how it reached" line graph.
    let reachDays = 0;
    try {
      const until = Math.floor(Date.now() / 1000);
      const since = until - 29 * 86400;
      const d = await graphGet(`${account.ig_user_id}/insights`, { metric: 'reach', period: 'day', since, until, access_token: token });
      const up = db.prepare(
        `INSERT INTO marketing_reach_daily(client_id,day,reach) VALUES(?,?,?)
         ON CONFLICT(client_id,day) DO UPDATE SET reach=excluded.reach`
      );
      for (const v of d.data?.[0]?.values || []) {
        if (!v.end_time) continue;
        up.run(clientId, v.end_time.slice(0, 10), Number(v.value || 0));
        reachDays++;
      }
    } catch (e) {
      warnings.push('Daily reach: ' + e.message);
    }

    // 4) Who it reached / who follows: country, city, age, gender (account level — Meta gives no per-post demographics).
    const demoRows = [];
    for (const { metric, audience, extra } of DEMO_METRICS) {
      for (const breakdown of DEMO_BREAKDOWNS) {
        try {
          const d = await graphGet(`${account.ig_user_id}/insights`, {
            metric,
            period: 'lifetime',
            metric_type: 'total_value',
            breakdown,
            ...extra,
            access_token: token,
          });
          const results = d.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
          const total = results.reduce((a, b) => a + (b.value || 0), 0) || 1;
          const keep = breakdown === 'city' || breakdown === 'country' ? 10 : results.length;
          results
            .slice()
            .sort((a, b) => (b.value || 0) - (a.value || 0))
            .slice(0, keep)
            .forEach((b) => {
              const raw = (b.dimension_values || [])[0];
              if (!raw) return;
              demoRows.push([audience, breakdown, demoLabel(breakdown, raw), Math.round((b.value / total) * 1000) / 10]);
            });
        } catch (e) {
          warnings.push(`${audience} ${breakdown}: ${e.message}`);
        }
      }
    }
    if (demoRows.length) {
      db.prepare("DELETE FROM marketing_audience_geo WHERE client_id=? AND source='instagram'").run(clientId);
      const insertGeo = db.prepare('INSERT INTO marketing_audience_geo(client_id,snapshot_date,scope,label,percentage,created_at,source,audience) VALUES(?,?,?,?,?,?,?,?)');
      const d = today();
      for (const [audience, scope, label, pct] of demoRows) insertGeo.run(clientId, d, scope, label, pct, now(), 'instagram', audience);
    }

    db.prepare('UPDATE marketing_instagram_accounts SET last_synced_at=? WHERE client_id=?').run(now(), clientId);
    audit(admin, 'SYNC', 'instagram_account', clientId, `${synced} posts, ${reachDays} reach days, ${demoRows.length} audience rows`);
    res.json({ ok: true, posts_synced: synced, reach_days: reachDays, audience_rows: demoRows.length, warnings: warnings.slice(0, 6) });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Instagram sync failed' });
  }
});

module.exports = router;
