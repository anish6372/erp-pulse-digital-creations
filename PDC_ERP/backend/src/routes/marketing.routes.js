const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { audit } = require('../utils/audit');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Every route here is Admin-only — this module exposes client marketing performance
// data, not something any employee login should be able to read.

// --- Reels performance -----------------------------------------------------

router.get('/marketing/reels', requireAdmin, (req, res) => {
  const clientId = Number(req.query.client_id);
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  const rows = db.prepare('SELECT * FROM marketing_reels WHERE client_id=? ORDER BY posted_at DESC').all(clientId);
  res.json({ reels: rows });
});

router.post('/marketing/reels', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const clientId = Number(b.client_id);
  const title = String(b.title || '').trim();
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (!b.posted_at) return res.status(400).json({ error: 'Posted date is required' });
  const ts = now();
  const r = db
    .prepare(
      `INSERT INTO marketing_reels(client_id,title,reel_url,posted_at,reach,plays,likes,comments,shares,saves,created_by,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      clientId,
      title,
      b.reel_url || '',
      b.posted_at,
      Number(b.reach || 0),
      Number(b.plays || 0),
      Number(b.likes || 0),
      Number(b.comments || 0),
      Number(b.shares || 0),
      Number(b.saves || 0),
      admin.id,
      ts,
      ts
    );
  audit(admin, 'CREATE', 'marketing_reel', r.lastInsertRowid, title);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/marketing/reels/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM marketing_reels WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Reel not found' });
  const b = req.body || {};
  db.prepare(
    `UPDATE marketing_reels SET title=?,reel_url=?,posted_at=?,reach=?,plays=?,likes=?,comments=?,shares=?,saves=?,updated_at=? WHERE id=?`
  ).run(
    b.title ?? existing.title,
    b.reel_url ?? existing.reel_url,
    b.posted_at ?? existing.posted_at,
    Number(b.reach ?? existing.reach),
    Number(b.plays ?? existing.plays),
    Number(b.likes ?? existing.likes),
    Number(b.comments ?? existing.comments),
    Number(b.shares ?? existing.shares),
    Number(b.saves ?? existing.saves),
    now(),
    id
  );
  audit(admin, 'UPDATE', 'marketing_reel', id);
  res.json({ ok: true });
});

router.delete('/marketing/reels/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  db.prepare('DELETE FROM marketing_reels WHERE id=?').run(id);
  audit(admin, 'DELETE', 'marketing_reel', id);
  res.json({ ok: true });
});

// --- Account reach per day (filled by the Instagram sync) -------------------

router.get('/marketing/reach', requireAdmin, (req, res) => {
  const clientId = Number(req.query.client_id);
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  const rows = db.prepare('SELECT day, reach FROM marketing_reach_daily WHERE client_id=? ORDER BY day ASC').all(clientId);
  res.json({ rows });
});

// --- Audience breakdowns (country / city / age / gender) ---------------------

router.get('/marketing/audience', requireAdmin, (req, res) => {
  const clientId = Number(req.query.client_id);
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  const rows = db.prepare('SELECT * FROM marketing_audience_geo WHERE client_id=? ORDER BY snapshot_date DESC, percentage DESC').all(clientId);
  res.json({ rows });
});

router.post('/marketing/audience', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const clientId = Number(b.client_id);
  const scope = String(b.scope || '').toLowerCase();
  const label = String(b.label || '').trim();
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  if (!['city', 'country', 'age', 'gender'].includes(scope)) return res.status(400).json({ error: "scope must be 'city', 'country', 'age' or 'gender'" });
  if (!label) return res.status(400).json({ error: 'Location name is required' });
  const pct = Number(b.percentage);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'Percentage must be between 0 and 100' });
  const r = db
    .prepare('INSERT INTO marketing_audience_geo(client_id,snapshot_date,scope,label,percentage,created_at) VALUES(?,?,?,?,?,?)')
    .run(clientId, b.snapshot_date || now().slice(0, 10), scope, label, pct, now());
  audit(admin, 'CREATE', 'marketing_audience_geo', r.lastInsertRowid, `${scope}:${label}`);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.delete('/marketing/audience/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  db.prepare('DELETE FROM marketing_audience_geo WHERE id=?').run(id);
  audit(admin, 'DELETE', 'marketing_audience_geo', id);
  res.json({ ok: true });
});

// --- Follower growth (monthly) ---------------------------------------------

router.get('/marketing/growth', requireAdmin, (req, res) => {
  const clientId = Number(req.query.client_id);
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  const rows = db.prepare('SELECT * FROM marketing_growth WHERE client_id=? ORDER BY month ASC').all(clientId);
  res.json({ rows });
});

router.post('/marketing/growth', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const clientId = Number(b.client_id);
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  if (!/^\d{4}-\d{2}$/.test(String(b.month || ''))) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const followers = Number(b.followers);
  if (!Number.isFinite(followers) || followers < 0) return res.status(400).json({ error: 'followers must be a non-negative number' });
  const r = db
    .prepare(
      `INSERT INTO marketing_growth(client_id,month,followers,created_at) VALUES(?,?,?,?)
       ON CONFLICT(client_id,month) DO UPDATE SET followers=excluded.followers`
    )
    .run(clientId, b.month, followers, now());
  audit(admin, 'UPSERT', 'marketing_growth', r.lastInsertRowid || 0, `${b.month}:${followers}`);
  res.status(201).json({ ok: true });
});

router.delete('/marketing/growth/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  db.prepare('DELETE FROM marketing_growth WHERE id=?').run(id);
  audit(admin, 'DELETE', 'marketing_growth', id);
  res.json({ ok: true });
});

module.exports = router;
