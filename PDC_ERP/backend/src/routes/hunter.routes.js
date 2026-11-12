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
const { NICHES, CITIES, SIGNALS, computeScore, websiteChannelScore, instagramChannelScore, gmbChannelScore, estimateMarket } = require('../utils/hunterData');
const { searchGoogleMaps, huntSignal } = require('../utils/apifyHunt');

const router = express.Router();
const requireHunterAccess = requireAdminOrDept('Sales');
const normalize = (v) => String(v || '').trim().toLowerCase();

const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many AI requests this hour. Try again later.' } });

router.get('/hunter/config', requireHunterAccess, (req, res) => {
  res.json({ enabled: !!process.env.ANTHROPIC_API_KEY, hunts_enabled: !!process.env.APIFY_TOKEN, niches: NICHES });
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

// Shared by manual "Add Lead" and an automatic Hunt run - audits, scores and inserts one
// business, returning its new id. Does not touch do-not-contact or AI drafting; callers
// that need those do them around this.
async function insertScoredLead(b, actorId) {
  const name = String(b.name || '').trim();
  const auditResult = await auditAndScore({
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
  const ts = now();
  const ins = db
    .prepare(
      `INSERT INTO hunter_leads(name,niche,city,website,instagram,linkedin,email,phone,contact_name,contact_role,signal_type,signal_title,signal_source,signal_at,gmb_rating,gmb_reviews,ig_followers,ig_last_post_days,ig_posting_frequency,channels,score,tier,status,owner_id,notes,created_by,created_at,updated_at,lat,lng)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
      b.signal_source || b.source_platform || '',
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
      actorId,
      b.notes || '',
      actorId,
      ts,
      ts,
      Number.isFinite(Number(b.lat)) && b.lat !== null && b.lat !== '' ? Number(b.lat) : null,
      Number.isFinite(Number(b.lng)) && b.lng !== null && b.lng !== '' ? Number(b.lng) : null
    );
  return ins.lastInsertRowid;
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

  let leadId;
  try {
    leadId = await insertScoredLead(b, u.id);
  } catch (e) {
    return res.status(500).json({ error: 'Could not audit this business: ' + e.message });
  }
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

// Bulk import: the browser parses a CSV and posts up to 50 rows. Each row is audited
// (website check), scored and, if AI drafting is configured, drafted - same as a single add.
const bulkLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many bulk imports this hour. Try again later.' } });
router.post('/hunter/leads/bulk', requireHunterAccess, bulkLimiter, async (req, res) => {
  const u = req.user;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || !rows.length) return res.status(400).json({ error: 'No rows to import' });
  if (rows.length > 50) return res.status(400).json({ error: 'Import up to 50 rows at a time' });
  const result = { added: 0, skipped: [], drafted: 0 };
  for (let i = 0; i < rows.length; i++) {
    const b = rows[i] || {};
    const name = String(b.name || '').trim();
    if (!name) { result.skipped.push({ row: i + 1, reason: 'missing name' }); continue; }
    if (!NICHES[b.niche]) b.niche = 'other';
    if (!SIGNALS[b.signal_type]) b.signal_type = 'manual';
    const dncHit = ['email', 'phone', 'instagram'].map((k) => normalize(b[k])).filter(Boolean).find((v) => db.prepare('SELECT 1 FROM do_not_contact WHERE value=?').get(v));
    if (dncHit) { result.skipped.push({ row: i + 1, name, reason: 'on the do-not-contact list' }); continue; }
    let leadId;
    try {
      leadId = await insertScoredLead(b, u.id);
    } catch (e) {
      result.skipped.push({ row: i + 1, name, reason: 'could not audit: ' + e.message });
      continue;
    }
    audit(u, 'CREATE', 'hunter_lead', leadId, name + ' (bulk import)');
    result.added++;
    if (process.env.ANTHROPIC_API_KEY) {
      try { await draftForLead(leadId, u); result.drafted++; } catch (e) { /* lead still saved */ }
    }
  }
  res.json(result);
});

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
  const { cities, niches } = leadBreakdown();
  res.json({ hot_leads: hot, drafts_to_approve: drafts, tasks_pending: tasksPending, approved_today: approvedToday, funnel, call_these_first: callThese, cities, niches });
});

// ---------- market (illustrative estimate, not live scraped data) ----------

// Real breakdown of the leads actually in this account - by city (for the map and the
// location table) and by niche - as opposed to the estimate above, which is a benchmark
// guess, not drawn from this data at all.
function leadBreakdown() {
  const leads = db.prepare('SELECT niche, city, score, tier FROM hunter_leads').all();
  const by = (keyFn) => {
    const groups = {};
    for (const l of leads) {
      const key = keyFn(l);
      if (!key) continue;
      (groups[key] = groups[key] || []).push(l);
    }
    return groups;
  };
  const stat = (rows) => ({
    lead_count: rows.length,
    avg_score: rows.length ? Math.round(rows.reduce((a, r) => a + r.score, 0) / rows.length) : null,
    hot: rows.filter((r) => r.tier === 'hot').length,
    warm: rows.filter((r) => r.tier === 'warm').length,
    parked: rows.filter((r) => r.tier === 'parked').length,
  });
  const byCity = by((l) => l.city);
  const byNiche = by((l) => l.niche);

  const cities = Object.entries(CITIES).map(([city, c]) => ({ city, priority: c.priority, lat: c.lat, lng: c.lng, ...stat(byCity[city] || []) }));
  const niches = Object.entries(NICHES).map(([key, n]) => ({ niche: key, niche_label: n.label, ...stat(byNiche[key] || []) }));
  return { cities, niches };
}

router.get('/hunter/market', requireHunterAccess, (req, res) => {
  const estimate = estimateMarket({ niche: req.query.niche || 'other', city: req.query.city || '', months: req.query.months });
  const { cities, niches } = leadBreakdown();
  const cityMeta = CITIES[req.query.city];
  const points = cityMeta
    ? db.prepare('SELECT id,name,niche,score,tier,gmb_reviews,lat,lng FROM hunter_leads WHERE city=?').all(req.query.city)
    : [];
  res.json({ estimate, cities, niches, center: cityMeta ? { lat: cityMeta.lat, lng: cityMeta.lng } : null, points, note: 'Illustrative estimate from category benchmarks, not live scraped market data. City and niche breakdowns below are your real leads.' });
});

// ---------- hunts (automatic discovery via Apify's Google Maps actor) ----------

const huntLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many hunt runs this hour. Try again later.' } });

router.get('/hunter/hunts', requireHunterAccess, (req, res) => {
  res.json({ rows: db.prepare('SELECT h.*, u.name created_by_name FROM hunter_hunts h LEFT JOIN users u ON u.id=h.created_by ORDER BY h.created_at DESC').all() });
});

router.post('/hunter/hunts', requireHunterAccess, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const city = String(b.city || '').trim();
  if (!city) return res.status(400).json({ error: 'A location is required' });
  const ts = now();
  const r = db.prepare('INSERT INTO hunter_hunts(niche,city,active,created_by,created_at) VALUES (?,?,1,?,?)').run(b.niche || 'other', city, u.id, ts);
  audit(u, 'CREATE', 'hunter_hunt', r.lastInsertRowid, `${b.niche || 'other'} in ${city}`);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/hunter/hunts/:id', requireHunterAccess, (req, res) => {
  const id = Number(req.params.id);
  const hunt = db.prepare('SELECT * FROM hunter_hunts WHERE id=?').get(id);
  if (!hunt) return res.status(404).json({ error: 'Not found' });
  const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : hunt.active;
  db.prepare('UPDATE hunter_hunts SET active=? WHERE id=?').run(active, id);
  res.json({ ok: true });
});

router.delete('/hunter/hunts/:id', requireHunterAccess, (req, res) => {
  const id = Number(req.params.id);
  const hunt = db.prepare('SELECT * FROM hunter_hunts WHERE id=?').get(id);
  if (!hunt) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM hunter_hunts WHERE id=?').run(id);
  audit(req.user, 'DELETE', 'hunter_hunt', id, `${hunt.niche} in ${hunt.city}`);
  res.json({ ok: true });
});

router.post('/hunter/hunts/:id/run', requireHunterAccess, huntLimiter, async (req, res) => {
  if (!process.env.APIFY_TOKEN) return res.status(400).json({ error: 'Automatic lead discovery is not configured on this server (no Apify token set)' });
  const u = req.user;
  const hunt = db.prepare('SELECT * FROM hunter_hunts WHERE id=?').get(Number(req.params.id));
  if (!hunt) return res.status(404).json({ error: 'Not found' });

  let places;
  try {
    places = await searchGoogleMaps({ searchTerm: NICHES[hunt.niche]?.label || hunt.niche, location: hunt.city, maxResults: 20 });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  let kept = 0;
  for (const p of places) {
    if (!p.name) continue;
    const dup = db.prepare('SELECT 1 FROM hunter_leads WHERE LOWER(name)=? AND city=?').get(p.name.toLowerCase(), hunt.city);
    if (dup) continue;
    const dncHit = [p.phone].map(normalize).filter(Boolean).find((v) => db.prepare('SELECT 1 FROM do_not_contact WHERE value=?').get(v));
    if (dncHit) continue;
    const sig = huntSignal(p);
    if (!sig.keep) continue;

    let leadId;
    try {
      leadId = await insertScoredLead(
        {
          name: p.name,
          niche: hunt.niche,
          city: hunt.city,
          website: p.website,
          phone: p.phone,
          gmb_rating: p.rating,
          gmb_reviews: p.reviews,
          signal_type: sig.signal_type,
          signal_title: sig.signal_title,
          signal_source: 'Google Maps (Apify hunt)',
          lat: p.lat,
          lng: p.lng,
        },
        u.id
      );
    } catch (e) {
      continue; // one bad website fetch shouldn't fail the whole hunt run
    }
    audit(u, 'CREATE', 'hunter_lead', leadId, `${p.name} (from hunt #${hunt.id})`);
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        await draftForLead(leadId, u);
      } catch (e) {
        /* lead is still saved and scored even if the AI draft step fails */
      }
    }
    kept++;
  }

  db.prepare('UPDATE hunter_hunts SET last_run_at=?, kept_count=?, found_count=? WHERE id=?').run(now(), kept, places.length, hunt.id);
  audit(u, 'UPDATE', 'hunter_hunt', hunt.id, `Run: kept ${kept} of ${places.length} found`);
  res.json({ found: places.length, kept });
});

module.exports = router;
