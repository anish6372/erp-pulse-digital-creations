const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { audit } = require('../utils/audit');
const { requireAdmin } = require('../middleware/auth');
const { analyzeWebsite } = require('../utils/websiteSignals');
const { generateProspectStrategy } = require('../utils/prospectAI');

const router = express.Router();

// Each report costs a real AI API call - limited separately from the general API traffic.
const analyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reports requested. Try again later.' },
});

router.get('/prospect/config', requireAdmin, (req, res) => {
  res.json({ enabled: !!process.env.ANTHROPIC_API_KEY });
});

router.get('/prospect', requireAdmin, (req, res) => {
  res.json({ rows: db.prepare('SELECT * FROM prospect_reports ORDER BY created_at DESC').all() });
});

router.post('/prospect/analyze', requireAdmin, analyzeLimiter, async (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const businessName = String(b.business_name || '').trim();
  if (!businessName) return res.status(400).json({ error: 'Business name is required' });
  if (!b.website_url && !b.instagram_handle) return res.status(400).json({ error: 'Give at least a website or an Instagram handle' });

  const websiteUrl = String(b.website_url || '').trim();
  const instagram = {
    handle: String(b.instagram_handle || '').trim(),
    followers: b.instagram_followers === '' || b.instagram_followers === undefined ? null : Number(b.instagram_followers),
    last_post: String(b.instagram_last_post || '').trim(),
    posting_frequency: String(b.instagram_posting_frequency || '').trim(),
    notes: String(b.instagram_notes || '').trim(),
  };

  const signals = await analyzeWebsite(websiteUrl);

  let swot;
  try {
    swot = await generateProspectStrategy({ business_name: businessName, website_url: websiteUrl, signals, instagram: instagram.handle ? instagram : null });
  } catch (e) {
    if (e.notConfigured) return res.status(503).json({ error: 'AI strategy generation is not configured' });
    return res.status(502).json({ error: e.message || 'Could not generate the strategy report' });
  }

  const ts = now();
  const r = db
    .prepare(
      `INSERT INTO prospect_reports(business_name,website_url,instagram_handle,instagram_followers,instagram_last_post,instagram_posting_frequency,instagram_notes,website_signals,swot,strategy,created_by,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      businessName,
      websiteUrl,
      instagram.handle,
      instagram.followers,
      instagram.last_post,
      instagram.posting_frequency,
      instagram.notes,
      JSON.stringify(signals),
      JSON.stringify({ strengths: swot.strengths || [], weaknesses: swot.weaknesses || [], opportunities: swot.opportunities || [], elevator_pitch: swot.elevator_pitch || '' }),
      swot.strategy || '',
      u.id,
      ts
    );
  audit(u, 'CREATE', 'prospect_report', r.lastInsertRowid, businessName);

  res.status(201).json({
    id: r.lastInsertRowid,
    business_name: businessName,
    website_url: websiteUrl,
    instagram,
    website_signals: signals,
    swot: { strengths: swot.strengths || [], weaknesses: swot.weaknesses || [], opportunities: swot.opportunities || [], elevator_pitch: swot.elevator_pitch || '' },
    strategy: swot.strategy || '',
    created_at: ts,
  });
});

router.delete('/prospect/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('SELECT id, business_name FROM prospect_reports WHERE id=?').get(id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM prospect_reports WHERE id=?').run(id);
  audit(req.user, 'DELETE', 'prospect_report', id, r.business_name);
  res.json({ ok: true });
});

module.exports = router;
