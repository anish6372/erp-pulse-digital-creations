const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { audit } = require('../utils/audit');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m));
const prevMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

function postTotals(clientId, month) {
  const posts = db.prepare('SELECT * FROM marketing_reels WHERE client_id=? AND substr(posted_at,1,7)=? ORDER BY reach DESC').all(clientId, month);
  const sum = (k) => posts.reduce((a, p) => a + (p[k] || 0), 0);
  const interactions = sum('likes') + sum('comments') + sum('shares') + sum('saves');
  return {
    posts,
    count: posts.length,
    reach: sum('reach'),
    views: sum('plays'),
    likes: sum('likes'),
    comments: sum('comments'),
    shares: sum('shares'),
    saves: sum('saves'),
    interactions,
    rate: sum('reach') ? Math.round((interactions / sum('reach')) * 1000) / 10 : 0,
  };
}

// Everything a cafe owner wants to see for one month, assembled from the Social, Content and Task data.
router.get('/client-report', requireAdmin, (req, res) => {
  const clientId = Number(req.query.client_id);
  const month = String(req.query.month || '');
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  if (!isMonth(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const client = db.prepare('SELECT id,name,short_name FROM clients WHERE id=?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const cur = postTotals(clientId, month);
  const prev = postTotals(clientId, prevMonth(month));

  const reachDaily = db.prepare('SELECT day, reach FROM marketing_reach_daily WHERE client_id=? AND substr(day,1,7)=? ORDER BY day').all(clientId, month);
  const growth = db.prepare('SELECT month, followers FROM marketing_growth WHERE client_id=? AND month IN (?,?) ORDER BY month').all(clientId, prevMonth(month), month);
  const followersNow = growth.find((g) => g.month === month)?.followers ?? null;
  const followersBefore = growth.find((g) => g.month === prevMonth(month))?.followers ?? null;

  const audience = {};
  // Prefer "people reached" (synced from Instagram); fall back to follower data, which is what hand-entered figures are.
  const pickAudience = db.prepare(
    'SELECT label, percentage FROM marketing_audience_geo WHERE client_id=? AND scope=? AND audience=? ORDER BY snapshot_date DESC, percentage DESC LIMIT 4'
  );
  for (const scope of ['country', 'city', 'age', 'gender']) {
    const reached = pickAudience.all(clientId, scope, 'reached');
    audience[scope] = reached.length ? reached : pickAudience.all(clientId, scope, 'followers');
  }

  const delivery = db
    .prepare("SELECT stage, COUNT(*) n FROM content_items WHERE client_id=? AND substr(scheduled_date,1,7)=? GROUP BY stage")
    .all(clientId, month);
  const tasksDone = db.prepare("SELECT COUNT(*) n FROM tasks WHERE client_id=? AND status='Done' AND substr(completed_at,1,7)=?").get(clientId, month).n;
  const outcome = db.prepare('SELECT * FROM client_outcomes WHERE client_id=? AND month=?').get(clientId, month) || { offer_redemptions: 0, new_customers: 0, notes: '' };

  res.json({
    client,
    month,
    totals: { ...cur, posts: undefined },
    previous: { reach: prev.reach, views: prev.views, interactions: prev.interactions, count: prev.count },
    bestPosts: cur.posts.slice(0, 3).map((p) => ({ title: p.title, reel_url: p.reel_url, posted_at: p.posted_at, reach: p.reach, post_type: p.post_type })),
    reachDaily,
    followers: { now: followersNow, before: followersBefore },
    audience,
    delivery: { byStage: delivery, tasksDone },
    outcome,
  });
});

// The business-side numbers only the cafe knows (offer redemptions, new walk-ins), entered once a month.
router.put('/client-outcomes', requireAdmin, (req, res) => {
  const b = req.body || {};
  const clientId = Number(b.client_id);
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  if (!isMonth(b.month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  db.prepare(
    `INSERT INTO client_outcomes(client_id,month,offer_redemptions,new_customers,notes,updated_at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(client_id,month) DO UPDATE SET offer_redemptions=excluded.offer_redemptions,new_customers=excluded.new_customers,notes=excluded.notes,updated_at=excluded.updated_at`
  ).run(clientId, b.month, n(b.offer_redemptions), n(b.new_customers), String(b.notes || '').slice(0, 500), now());
  audit(req.user, 'UPSERT', 'client_outcome', clientId, b.month);
  res.json({ ok: true });
});

module.exports = router;
