// Client Hunter: scored prospect pipeline, AI-drafted outreach that a person must approve,
// a manual task list for non-email channels, and an illustrative market-sizing estimate.
// Admin and Sales department only, same access as the existing Leads page. Drafting and
// sending go through the do-not-contact list built for the Compliance module.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { audit } = require('../utils/audit');
const { requireAuth, requireAdminOrDept } = require('../middleware/auth');
const { analyzeWebsite } = require('../utils/websiteSignals');
const { generateHunterReport } = require('../utils/prospectAI');
const { NICHES, computeScore, websiteChannelScore, instagramChannelScore, gmbChannelScore, estimateMarket } = require('../utils/hunterData');

const router = express.Router();
const requireHunterAccess = requireAdminOrDept('Sales');
const normalize = (v) => String(v || '').trim().toLowerCase();

const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many AI requests this hour. Try again later.' } });

router.get('/hunter/config', requireHunterAccess, (req, res) => {
  res.json({ enabled: !!process.env.ANTHROPIC_API_KEY, niches: NICHES });
});

function parseRow(r) {
  return { ...r, channels: JSON.parse(r.channels || '{}'), swot: JSON.parse(r.swot || '{}') };
}

async function auditAndScore({ niche, city, website, ig_followers, ig_last_post_days, ig_posting_frequency, gmb_rating, gmb_reviews, email, instagram, linkedin, phone, signal_type, signal_at }) {
  const siteSignals = website ? await analyzeWebsite(website) : null;
  const channels = {
    website: websiteChannelScore(siteSignals),
    instagram: instagramChannelScore({ followers: ig_followers, lastPostDays: ig_last_post_days, postingFrequency: ig_posting_frequency }),
    gmb: gmbChannelScore({ rating: gmb_rating, reviews: gmb_reviews }),
  };
  const scored = computeScore({ niche, city, channels, signalAt: signal_at, signalType: signal_type, contacts: { email, instagram, linkedin, phone } });
  return { channels, siteSignals, ...scored };
}

router.get('/hunter/leads', requireHunterAccess, (req, res) => {
  const { q, tier, niche, status } = req.query;
  let rows = db.prepare('SELECT * FROM hunter_leads ORDER BY score DESC, created_at DESC').all().map(parseRow);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((r) => [r.name, r.city, r.contact_name].some((v) => String(v || '').toLowerCase().includes(needle)));
  }
  if (tier) rows = rows.filter((r) => r.tier === tier);
  if (niche) rows = rows.filter((r) => r.niche === niche);
  if (status) rows = rows.filter((r) => r.status === status);
  res.json({ rows });
});

router.get('/hunter/leads/:id', requireHunterAccess, (req, res) => {
  const row = db.prepare('SELECT * FROM hunter_leads WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  const touches = db.prepare('SELECT t.*, u.name approved_by_name FROM hunter_touches t LEFT JOIN users u ON u.id=t.approved_by WHERE t.lead_id=? ORDER BY t.created_at').all(row.id);
  res.json({ lead: parseRow(row), touches });
});

router.post('/hunter/leads', requireHunterAccess, aiLimiter, async (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Business name is required' });
  const dncHit = ['email', 'phone', 'instagram'].map((k) => normalize(b[k])).filter(Boolean).find((v) => db.prepare('SELECT 1 FROM do_not_contact WHERE value=?').get(v));
  if (dncHit) return res.status(409).json({ error: 'This contact is on the do-not-contact list' });

  let auditResult;
  try {
    auditResult = await auditAndScore({
      niche: b.niche,
      city: b.city,
      website: b.website,
      ig_followers: b.ig_followers,
      ig_last_post_days: b.ig_last_post_days,
      ig_posting_frequency: b.ig_posting_frequency,
      gmb_rating: b.gmb_rating,
      gmb_reviews: b.gmb_reviews,
      email: b.email,
      instagram: b.instagram,
      linkedin: b.linkedin,
      phone: b.phone,
      signal_type: b.signal_type || 'manual',
      signal_at: b.signal_at || now(),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Could not audit this business: ' + e.message });
  }

  const ts = now();
  const ins = db
    .prepare(
      `INSERT INTO hunter_leads(name,niche,city,website,instagram,linkedin,email,phone,contact_name,contact_role,signal_type,signal_title,signal_source,signal_at,gmb_rating,gmb_reviews,ig_followers,ig_last_post_days,ig_posting_frequency,channels,score,tier,status,owner_id,notes,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      name,
      b.niche || 'other',
      b.city || '',
      b.website || '',
      b.instagram || '',
      b.linkedin || '',
      b.email || '',
      b.phone || '',
      b.contact_name || '',
      b.contact_role || '',
      b.signal_type || 'manual',
      b.signal_title || '',
      b.signal_source || '',
      b.signal_at || ts,
      b.gmb_rating || null,
      b.gmb_reviews || null,
      b.ig_followers || null,
      b.ig_last_post_days || null,
      b.ig_posting_frequency || '',
      JSON.stringify(auditResult.channels),
      auditResult.score,
      auditResult.tier,
      'audited',
      u.id,
      b.notes || '',
      u.id,
      ts,
      ts
    );
  const leadId = ins.lastInsertRowid;
  audit(u, 'CREATE', 'hunter_lead', leadId, name);

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      await draftForLead(leadId, u);
    } catch (e) {
      /* lead is still saved and scored even if the AI draft step fails */
    }
  }
  const row = db.prepare('SELECT * FROM hunter_leads WHERE id=?').get(leadId);
  res.status(201).json({ lead: parseRow(row) });
});

async function draftForLead(leadId, actor) {
  const lead = db.prepare('SELECT * FROM hunter_leads WHERE id=?').get(leadId);
  if (!lead) throw new Error('Lead not found');
  const contacts = { email: lead.email, instagram: lead.instagram, linkedin: lead.linkedin, phone: lead.phone };
  const report = await generateHunterReport({
    business_name: lead.name,
    niche_label: NICHES[lead.niche]?.label,
    city: lead.city,
    website_url: lead.website,
    signal: { title: lead.signal_title, source: lead.signal_source },
    channels: JSON.parse(lead.channels || '{}'),
    contacts,
  });
  db.prepare('UPDATE hunter_leads SET swot=?,elevator_pitch=?,updated_at=? WHERE id=?').run(
    JSON.stringify({ strengths: report.strengths, weaknesses: report.weaknesses, opportunities: report.opportunities }),
    report.elevator_pitch || '',
    now(),
    leadId
  );
  const ts = now();
  for (const d of report.drafts || []) {
    const to = d.channel === 'email' ? lead.email : d.channel === 'instagram' ? lead.instagram : d.channel === 'linkedin' ? lead.linkedin : lead.phone;
    if (!to) continue;
    db.prepare('INSERT INTO hunter_touches(lead_id,channel,subject,body,to_value,status,created_at) VALUES (?,?,?,?,?,?,?)').run(leadId, d.channel, d.subject || '', d.body || '', to, 'draft', ts);
  }
  if (actor) audit(actor, 'UPDATE', 'hunter_lead', leadId, 'AI draft generated');
}

router.post('/hunter/leads/:id/draft', requireHunterAccess, aiLimiter, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'AI drafting is not configured on this server' });
  try {
    await draftForLead(Number(req.params.id), req.user);
    const row = db.prepare('SELECT * FROM hunter_leads WHERE id=?').get(Number(req.params.id));
    res.json({ lead: parseRow(row) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not draft outreach for this lead' });
  }
});

router.put('/hunter/leads/:id', requireHunterAccess, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM hunter_leads WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const status = b.status || row.status;
  const owner_id = b.owner_id !== undefined ? b.owner_id : row.owner_id;
  const notes = b.notes !== undefined ? b.notes : row.notes;
  db.prepare('UPDATE hunter_leads SET status=?,owner_id=?,notes=?,updated_at=? WHERE id=?').run(status, owner_id, notes, now(), id);
  audit(req.user, 'UPDATE', 'hunter_lead', id, `status -> ${status}`);
  res.json({ ok: true });
});

router.delete('/hunter/leads/:id', requireHunterAccess, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM hunter_leads WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM hunter_leads WHERE id=?').run(id);
  audit(req.user, 'DELETE', 'hunter_lead', id, row.name);
  res.json({ ok: true });
});

// ---------- approvals / tasks ----------

router.get('/hunter/touches', requireHunterAccess, (req, res) => {
  const status = req.query.status;
  let rows = db
    .prepare(
      `SELECT t.*, l.name lead_name, l.tier lead_tier, l.niche lead_niche, u.name approved_by_name
       FROM hunter_touches t JOIN hunter_leads l ON l.id=t.lead_id LEFT JOIN users u ON u.id=t.approved_by
       ORDER BY t.created_at DESC`
    )
    .all();
  if (status) rows = rows.filter((r) => r.status === status);
  res.json({ rows });
});

router.put('/hunter/touches/:id/approve', requireHunterAccess, (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM hunter_touches WHERE id=?').get(id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (db.prepare('SELECT 1 FROM do_not_contact WHERE value=?').get(normalize(t.to_value))) return res.status(409).json({ error: 'This contact is on the do-not-contact list' });
  const b = req.body || {};
  const subject = b.subject !== undefined ? b.subject : t.subject;
  const body = b.body !== undefined ? b.body : t.body;
  db.prepare('UPDATE hunter_touches SET subject=?,body=?,status=?,approved_by=?,approved_at=? WHERE id=?').run(subject, body, 'approved', req.user.id, now(), id);
  db.prepare("UPDATE hunter_leads SET status=CASE WHEN status IN ('new','audited') THEN 'outreach' ELSE status END, updated_at=? WHERE id=?").run(now(), t.lead_id);
  audit(req.user, 'UPDATE', 'hunter_touch', id, 'Approved');
  res.json({ ok: true });
});

router.put('/hunter/touches/:id/reject', requireHunterAccess, (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM hunter_touches WHERE id=?').get(id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE hunter_touches SET status='rejected' WHERE id=?").run(id);
  audit(req.user, 'UPDATE', 'hunter_touch', id, 'Rejected');
  res.json({ ok: true });
});

router.put('/hunter/touches/:id/outcome', requireHunterAccess, (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM hunter_touches WHERE id=?').get(id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const outcome = ['interested', 'not_now', 'asked_to_stop'].includes(req.body?.outcome) ? req.body.outcome : 'not_now';
  const note = String(req.body?.note || '').slice(0, 300);
  db.prepare('UPDATE hunter_touches SET outcome=?,outcome_note=? WHERE id=?').run(outcome, note, id);
  if (outcome === 'asked_to_stop') {
    const value = normalize(t.to_value);
    if (value) {
      try {
        db.prepare('INSERT INTO do_not_contact(type,value,reason,added_by,created_at) VALUES(?,?,?,?,?)').run(
          t.channel === 'call' ? 'phone' : t.channel === 'email' ? 'email' : t.channel,
          value,
          'Asked to stop (Client Hunter)',
          req.user.id,
          now()
        );
      } catch (e) {
        /* already on the list */
      }
    }
    db.prepare("UPDATE hunter_leads SET status='disqualified', updated_at=? WHERE id=?").run(now(), t.lead_id);
  } else if (outcome === 'interested') {
    db.prepare("UPDATE hunter_leads SET status='replied', updated_at=? WHERE id=?").run(now(), t.lead_id);
  }
  audit(req.user, 'UPDATE', 'hunter_touch', id, `Outcome: ${outcome}`);
  res.json({ ok: true });
});

// ---------- dashboard ----------

router.get('/hunter/dashboard', requireHunterAccess, (req, res) => {
  const leads = db.prepare('SELECT * FROM hunter_leads').all().map(parseRow);
  const funnel = ['new', 'audited', 'outreach', 'replied', 'meeting', 'won'].map((s) => ({ status: s, count: leads.filter((l) => l.status === s).length }));
  const hot = leads.filter((l) => l.tier === 'hot' && !['won', 'lost', 'disqualified'].includes(l.status)).length;
  const drafts = db.prepare("SELECT COUNT(*) c FROM hunter_touches WHERE status='draft'").get().c;
  const tasksPending = db.prepare("SELECT COUNT(*) c FROM hunter_touches WHERE status='approved' AND outcome=''").get().c;
  const approvedToday = db.prepare("SELECT COUNT(*) c FROM hunter_touches WHERE status='approved' AND date(approved_at)=date('now')").get().c;
  const callThese = leads
    .filter((l) => !['won', 'lost', 'disqualified'].includes(l.status))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  res.json({ hot_leads: hot, drafts_to_approve: drafts, tasks_pending: tasksPending, approved_today: approvedToday, funnel, call_these_first: callThese });
});

// ---------- market (illustrative estimate, not live scraped data) ----------

router.get('/hunter/market', requireHunterAccess, (req, res) => {
  const estimate = estimateMarket({ niche: req.query.niche || 'other', city: req.query.city || '', months: req.query.months });
  res.json({ estimate, note: 'Illustrative estimate from category benchmarks, not live scraped market data.' });
});

module.exports = router;
