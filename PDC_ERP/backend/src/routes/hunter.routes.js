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
const { NICHES, CITIES, LOCALITIES, SIGNALS, computeScore, websiteChannelScore, instagramChannelScore, gmbChannelScore, estimateMarket } = require('../utils/hunterData');
const { searchGoogleMaps, huntSignal } = require('../utils/apifyHunt');
const { makeLimiter } = require('../utils/limiter');
const { lookupInstagram, igHandle } = require('../utils/igLookup');
// Store Instagram as a clean "@handle" whatever was pasted (URL, share link, plain name).
const cleanIg = (v) => (igHandle(v) ? '@' + igHandle(v) : String(v || '').trim());
const { cached, invalidate } = require('../utils/cache');
const jobs = require('../utils/jobs');

const router = express.Router();
const requireHunterAccess = requireAdminOrDept('Sales');

// Cached dashboard/market numbers are dropped after any write (POST/PUT/DELETE) in this module.
router.use('/hunter', (req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => invalidate('hunter:'));
  next();
});
const normalize = (v) => String(v || '').trim().toLowerCase();

const aiLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, limit: 30, message: 'Too many AI requests this hour. Try again later.', prefix: 'hunter-ai' });

router.get('/hunter/config', requireHunterAccess, (req, res) => {
  res.json({ enabled: !!process.env.ANTHROPIC_API_KEY, hunts_enabled: !!process.env.APIFY_TOKEN, niches: NICHES });
});

function parseRow(r) {
  return { ...r, channels: JSON.parse(r.channels || '{}'), swot: JSON.parse(r.swot || '{}') };
}

const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// Fill missing Instagram followers / last post / frequency from Instagram itself when we can.
async function fillInstagram(b) {
  if (!b.instagram || (numOrNull(b.ig_followers) != null && numOrNull(b.ig_last_post_days) != null)) return b;
  const ig = await lookupInstagram(b.instagram);
  if (!ig) return b;
  return {
    ...b,
    ig_followers: numOrNull(b.ig_followers) ?? ig.followers,
    ig_last_post_days: numOrNull(b.ig_last_post_days) ?? ig.last_post_days,
    ig_posting_frequency: b.ig_posting_frequency || ig.posting_frequency,
  };
}

async function auditAndScore({ siteSignals: given, niche, city, website, ig_followers, ig_last_post_days, ig_posting_frequency, gmb_rating, gmb_reviews, email, instagram, linkedin, phone, signal_type, signal_at }) {
  const siteSignals = given !== undefined ? given : website ? await analyzeWebsite(website) : null;
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
  // Read the website once: it scores the site and, when no handle was given, gives us the
  // business's own Instagram link so followers / last post can be looked up too.
  const siteSignals = b.website ? await analyzeWebsite(b.website) : null;
  if (!b.instagram && siteSignals && siteSignals.instagram_handle) b = { ...b, instagram: siteSignals.instagram_handle };
  if (b.instagram) b = { ...b, instagram: cleanIg(b.instagram) };
  b = await fillInstagram(b);
  const auditResult = await auditAndScore({
    siteSignals,
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
      numOrNull(b.ig_followers),
      numOrNull(b.ig_last_post_days),
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
  db.prepare('UPDATE hunter_leads SET updated_by=?, current_agency=?, budget=?, services_needed=? WHERE id=?').run(
    actorId, String(b.current_agency || '').trim(), numOrNull(b.budget), String(b.services_needed || '').trim(), ins.lastInsertRowid);
  return ins.lastInsertRowid;
}

router.get('/hunter/leads', requireHunterAccess, (req, res) => {
  const { q, tier, niche, status } = req.query;
  let rows = db.prepare('SELECT l.*, u.name updated_by_name FROM hunter_leads l LEFT JOIN users u ON u.id=COALESCE(l.updated_by,l.created_by) ORDER BY l.score DESC, l.created_at DESC').all().map(parseRow);
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
  db.prepare('UPDATE hunter_leads SET swot=?,elevator_pitch=?,updated_at=?,updated_by=? WHERE id=?').run(
    JSON.stringify({ strengths: report.strengths, weaknesses: report.weaknesses, opportunities: report.opportunities }),
    report.elevator_pitch || '',
    now(),
    actor && actor.id ? actor.id : null,
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

// ---------- background jobs (BullMQ when Redis is available, in-process otherwise) ----------
// A job's handler gets plain JSON data plus { progress }, and returns a result object.
// The routes below only validate, enqueue and return 202 + a job id; the browser polls
// GET /hunter/jobs/:id. Heavy work no longer holds an HTTP request open.

const actorOf = (id) => db.prepare('SELECT id,name,role FROM users WHERE id=?').get(id) || { id };

async function bulkImportJob({ rows, userId }, { progress }) {
  const u = actorOf(userId);
  const result = { added: 0, skipped: [], drafted: 0 };
  for (let i = 0; i < rows.length; i++) {
    await progress({ done: i, total: rows.length, message: `Auditing row ${i + 1} of ${rows.length}` });
    const b = rows[i] || {};
    const name = String(b.name || '').trim();
    if (!name) { result.skipped.push({ row: i + 1, reason: 'missing name' }); continue; }
    if (!NICHES[b.niche]) b.niche = 'other';
    if (!SIGNALS[b.signal_type]) b.signal_type = 'manual';
    const dncHit = ['email', 'phone', 'instagram'].map((k) => normalize(b[k])).filter(Boolean).find((v) => db.prepare('SELECT 1 FROM do_not_contact WHERE value=?').get(v));
    if (dncHit) { result.skipped.push({ row: i + 1, name, reason: 'on the do-not-contact list' }); continue; }
    // Also keeps a job that BullMQ re-runs after a restart from importing the same rows twice.
    if (db.prepare('SELECT 1 FROM hunter_leads WHERE LOWER(name)=? AND city=?').get(name.toLowerCase(), b.city || '')) { result.skipped.push({ row: i + 1, name, reason: 'already in your leads' }); continue; }
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
  await progress({ done: rows.length, total: rows.length, message: 'Done' });
  await invalidate('hunter:');
  return result;
}
jobs.register('bulk-import', bulkImportJob);

// Bulk import: the browser parses a CSV and posts up to 200 rows; they are processed in the
// background (website audit + score + optional AI draft per row).
const bulkLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, limit: 40, message: 'Too many bulk imports this hour. Try again later.', prefix: 'hunter-bulk' });
router.post('/hunter/leads/bulk', requireHunterAccess, bulkLimiter, async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || !rows.length) return res.status(400).json({ error: 'No rows to import' });
  if (rows.length > 200) return res.status(400).json({ error: 'Import up to 200 rows at a time' });
  res.status(202).json({ job_id: await jobs.enqueue('bulk-import', { rows, userId: req.user.id }) });
});

// Looks up coordinates for leads that have none, using OpenStreetMap's free Nominatim
// geocoder (business name + city only). Small businesses are often missing from it, so a
// miss is normal; each lead is tried once. Runs as a background job because Nominatim
// allows about one request per second.
const haversineKm = (a, b) => {
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

async function locateJob({ city }, { progress }) {
  const meta = CITIES[city];
  if (!meta) throw new Error('Unknown city');
  const rows = db.prepare('SELECT id,name FROM hunter_leads WHERE city=? AND lat IS NULL AND geo_tried=0 LIMIT 40').all(city);
  let located = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    await progress({ done: i, total: rows.length, message: `Looking up ${r.name}` });
    let hit = null;
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(r.name + ', ' + city);
      const resp = await fetch(url, { headers: { 'User-Agent': 'erp-lead-locator/1.0' } });
      const arr = resp.ok ? await resp.json() : [];
      if (arr[0]) {
        const p = { lat: Number(arr[0].lat), lng: Number(arr[0].lon) };
        if (Number.isFinite(p.lat) && Number.isFinite(p.lng) && haversineKm(meta, p) <= 40) hit = p;
      }
    } catch (e) { /* treat as a miss */ }
    if (hit) { db.prepare('UPDATE hunter_leads SET lat=?, lng=?, geo_tried=1 WHERE id=?').run(hit.lat, hit.lng, r.id); located++; }
    else db.prepare('UPDATE hunter_leads SET geo_tried=1 WHERE id=?').run(r.id);
    await new Promise((ok) => setTimeout(ok, 1100));
  }
  await invalidate('hunter:');
  const remaining = db.prepare('SELECT COUNT(*) c FROM hunter_leads WHERE city=? AND lat IS NULL AND geo_tried=0').get(city).c;
  return { tried: rows.length, located, remaining };
}
jobs.register('locate', locateJob);

// Looks up Instagram followers / last post for leads that have a handle (up to 40 per click),
// then re-scores them. Leads whose account is personal or private stay as they are.
async function refreshInstagramLeads(limit = 40) {
  const rows = db.prepare("SELECT * FROM hunter_leads WHERE instagram<>'' ORDER BY (ig_followers IS NULL) DESC, updated_at ASC LIMIT ?").all(limit);
  let updated = 0;
  let failed = 0;
  for (const lead of rows) {
    const clean = cleanIg(lead.instagram);
    if (clean !== lead.instagram) db.prepare('UPDATE hunter_leads SET instagram=? WHERE id=?').run(clean, lead.id);
    const ig = await lookupInstagram(clean);
    if (!ig) { failed++; continue; }
    const merged = { ...lead, ig_followers: ig.followers ?? lead.ig_followers, ig_last_post_days: ig.last_post_days ?? lead.ig_last_post_days, ig_posting_frequency: ig.posting_frequency || lead.ig_posting_frequency };
    const scored = await auditAndScore({ ...merged, siteSignals: null, signal_at: lead.signal_at, signal_type: lead.signal_type });
    const channels = { ...JSON.parse(lead.channels || '{}'), instagram: scored.channels.instagram };
    db.prepare('UPDATE hunter_leads SET ig_followers=?, ig_last_post_days=?, ig_posting_frequency=?, channels=? WHERE id=?').run(
      merged.ig_followers ?? null, merged.ig_last_post_days ?? null, merged.ig_posting_frequency || '', JSON.stringify(channels), lead.id);
    updated++;
  }
  if (rows.length) await invalidate('hunter:');
  return { checked: rows.length, updated, failed, connected: !!db.prepare('SELECT 1 FROM marketing_instagram_accounts LIMIT 1').get() };
}

// Looks up Instagram followers / last post for leads that have a handle (up to 40 per click).
// Free: it goes through Meta's official API with the account connected on the Social page.
router.post('/hunter/leads/refresh-instagram', requireHunterAccess, async (req, res) => {
  res.json(await refreshInstagramLeads(40));
});

// Keep the numbers current on their own: every 6 hours, refresh the 40 stalest leads.
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => refreshInstagramLeads(40).catch(() => {}), 6 * 60 * 60 * 1000).unref();
}

router.post('/hunter/leads/locate', requireHunterAccess, async (req, res) => {
  const city = String(req.body?.city || '');
  if (!CITIES[city]) return res.status(400).json({ error: 'Pick a city first' });
  res.status(202).json({ job_id: await jobs.enqueue('locate', { city, userId: req.user.id }) });
});

// Poll a job's progress. Only the person who started it (or an admin) can see it.
router.get('/hunter/jobs/:id', requireHunterAccess, async (req, res) => {
  const job = await jobs.getJob(String(req.params.id));
  if (!job) return res.status(404).json({ error: 'Job not found (it may have expired)' });
  if (req.user.role !== 'Admin' && job.user_id !== req.user.id) return res.status(403).json({ error: 'Not your job' });
  res.json({ id: job.id, name: job.name, state: job.state, progress: job.progress, result: job.result, error: job.error });
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
  const current_agency = b.current_agency !== undefined ? String(b.current_agency || '').trim() : row.current_agency || '';
  const budget = b.budget !== undefined ? numOrNull(b.budget) : row.budget;
  const services_needed = b.services_needed !== undefined ? String(b.services_needed || '').trim() : row.services_needed || '';
  db.prepare('UPDATE hunter_leads SET status=?,owner_id=?,notes=?,current_agency=?,budget=?,services_needed=?,updated_at=?,updated_by=? WHERE id=?').run(
    status, owner_id, notes, current_agency, budget, services_needed, now(), req.user.id, id);
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
  db.prepare("UPDATE hunter_leads SET status=CASE WHEN status IN ('new','audited') THEN 'outreach' ELSE status END, updated_at=?, updated_by=? WHERE id=?").run(now(), req.user.id, t.lead_id);
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
    db.prepare("UPDATE hunter_leads SET status='disqualified', updated_at=?, updated_by=? WHERE id=?").run(now(), req.user.id, t.lead_id);
  } else if (outcome === 'interested') {
    db.prepare("UPDATE hunter_leads SET status='replied', updated_at=?, updated_by=? WHERE id=?").run(now(), req.user.id, t.lead_id);
  }
  audit(req.user, 'UPDATE', 'hunter_touch', id, `Outcome: ${outcome}`);
  res.json({ ok: true });
});

// ---------- dashboard ----------

router.get('/hunter/dashboard', requireHunterAccess, async (req, res) => {
  res.json(await cached('hunter:dashboard', 15, computeDashboard));
});

function computeDashboard() {
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
  return { hot_leads: hot, drafts_to_approve: drafts, tasks_pending: tasksPending, approved_today: approvedToday, funnel, call_these_first: callThese, cities, niches };
}

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

// When the team hasn't entered a budget or needs for a lead, fill in estimates so the Market
// table is useful straight away: budget = typical monthly spend for that niche in that city,
// needs = the gaps the audit found (no website, quiet Instagram, few Google reviews).
function suggestedNeeds(p) {
  const ch = JSON.parse(p.channels || '{}');
  const out = [];
  if (!p.website || (ch.website && ch.website.score != null && ch.website.score <= 2)) out.push('Website');
  if (!p.instagram) out.push('Instagram setup');
  else if (ch.instagram && ch.instagram.score != null && ch.instagram.score <= 2) out.push('Regular posts & reels');
  if (p.gmb_reviews == null || p.gmb_reviews < 20 || (p.gmb_rating != null && p.gmb_rating < 4)) out.push('Google reviews & profile');
  return out.join(', ') || 'Ads & growth';
}
function withEstimates(p) {
  const est = estimateMarket({ niche: p.niche, city: p.city || '' });
  const { channels, website, instagram, gmb_rating, ...rest } = p;
  return { ...rest, budget_estimate: p.budget == null ? est.avg_project_value_estimate : null, services_suggested: p.services_needed ? '' : suggestedNeeds(p) };
}

router.get('/hunter/market', requireHunterAccess, async (req, res) => {
  const estimate = estimateMarket({ niche: req.query.niche || 'other', city: req.query.city || '', months: req.query.months });
  const { cities, niches } = await cached('hunter:breakdown', 15, leadBreakdown);
  const cityMeta = CITIES[req.query.city];
  const points = cityMeta
    ? db.prepare('SELECT id,name,niche,city,score,tier,gmb_reviews,gmb_rating,website,instagram,channels,lat,lng,current_agency,budget,services_needed FROM hunter_leads WHERE city=?').all(req.query.city).map(withEstimates)
    : [];
  res.json({ estimate, cities, niches, center: cityMeta ? { lat: cityMeta.lat, lng: cityMeta.lng } : null, points, localities: Object.entries(LOCALITIES[req.query.city] || {}).map(([name, [lat, lng]]) => ({ name, lat, lng })), unlocated: cityMeta ? db.prepare('SELECT COUNT(*) c FROM hunter_leads WHERE city=? AND lat IS NULL AND geo_tried=0').get(req.query.city).c : 0, note: 'Illustrative estimate from category benchmarks, not live scraped market data. City and niche breakdowns below are your real leads.' });
});

// ---------- hunts (automatic discovery via Apify's Google Maps actor) ----------

const huntLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, limit: 15, message: 'Too many hunt runs this hour. Try again later.', prefix: 'hunter-hunt' });

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

async function huntRunJob({ huntId, userId }, { progress }) {
  const u = actorOf(userId);
  const hunt = db.prepare('SELECT * FROM hunter_hunts WHERE id=?').get(huntId);
  if (!hunt) throw new Error('Hunt not found');
  await progress({ done: 0, total: 0, message: 'Searching Google Maps…' });
  const places = await searchGoogleMaps({ searchTerm: NICHES[hunt.niche]?.label || hunt.niche, location: hunt.city, maxResults: 20 });

  let kept = 0;
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    await progress({ done: i, total: places.length, message: `Checking ${p.name || 'result'} (${i + 1} of ${places.length})` });
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
  await progress({ done: places.length, total: places.length, message: 'Done' });
  await invalidate('hunter:');
  return { found: places.length, kept };
}
jobs.register('hunt-run', huntRunJob);

router.post('/hunter/hunts/:id/run', requireHunterAccess, huntLimiter, async (req, res) => {
  if (!process.env.APIFY_TOKEN) return res.status(400).json({ error: 'Automatic lead discovery is not configured on this server (no Apify token set)' });
  const hunt = db.prepare('SELECT * FROM hunter_hunts WHERE id=?').get(Number(req.params.id));
  if (!hunt) return res.status(404).json({ error: 'Not found' });
  res.status(202).json({ job_id: await jobs.enqueue('hunt-run', { huntId: hunt.id, userId: req.user.id }) });
});

// --- Notes: the team's log of things the AI got wrong, tracked until someone fixes them ---
const NOTE_KINDS = ['Wrong data', 'Bad AI draft', 'Wrong score', 'Wrong market estimate', 'Other'];
const clip = (v, n) => String(v || '').trim().slice(0, n);

router.get('/hunter/notes', requireHunterAccess, (req, res) => {
  const where = [];
  const args = [];
  if (['Open', 'Resolved'].includes(req.query.status)) {
    where.push('n.status=?');
    args.push(req.query.status);
  }
  const rows = db
    .prepare(
      `SELECT n.*, l.name lead_name, u.name created_by_name, r.name resolved_by_name FROM hunter_notes n
       LEFT JOIN hunter_leads l ON l.id=n.lead_id LEFT JOIN users u ON u.id=n.created_by LEFT JOIN users r ON r.id=n.resolved_by
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (n.status='Open') DESC, n.created_at DESC`
    )
    .all(...args);
  res.json({ rows, kinds: NOTE_KINDS });
});

router.post('/hunter/notes', requireHunterAccess, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const note = clip(b.note, 2000);
  if (!note) return res.status(400).json({ error: 'Write what the AI got wrong' });
  const kind = NOTE_KINDS.includes(b.kind) ? b.kind : 'Other';
  const leadId = b.lead_id ? Number(b.lead_id) : null;
  if (leadId && !db.prepare('SELECT id FROM hunter_leads WHERE id=?').get(leadId)) return res.status(400).json({ error: 'That lead no longer exists' });
  const r = db
    .prepare('INSERT INTO hunter_notes(lead_id,kind,note,ai_said,should_be,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(leadId, kind, note, clip(b.ai_said, 2000), clip(b.should_be, 2000), 'Open', u.id, now());
  audit(u, 'CREATE', 'hunter_note', r.lastInsertRowid, kind);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/hunter/notes/:id', requireHunterAccess, (req, res) => {
  const u = req.user;
  const id = Number(req.params.id);
  const n = db.prepare('SELECT * FROM hunter_notes WHERE id=?').get(id);
  if (!n) return res.status(404).json({ error: 'Not found' });
  const st = req.body?.status;
  if (!['Open', 'Resolved'].includes(st)) return res.status(400).json({ error: 'Status must be Open or Resolved' });
  db.prepare('UPDATE hunter_notes SET status=?, resolved_by=?, resolved_at=? WHERE id=?').run(st, st === 'Resolved' ? u.id : null, st === 'Resolved' ? now() : null, id);
  audit(u, 'UPDATE', 'hunter_note', id, st);
  res.json({ ok: true });
});

router.delete('/hunter/notes/:id', requireHunterAccess, (req, res) => {
  const u = req.user;
  const id = Number(req.params.id);
  const n = db.prepare('SELECT * FROM hunter_notes WHERE id=?').get(id);
  if (!n) return res.status(404).json({ error: 'Not found' });
  if (u.role !== 'Admin' && n.created_by !== u.id) return res.status(403).json({ error: 'Only the person who wrote a note, or an Admin, can delete it' });
  db.prepare('DELETE FROM hunter_notes WHERE id=?').run(id);
  audit(u, 'DELETE', 'hunter_note', id, n.kind);
  res.json({ ok: true });
});

// ---------------- prospect reports (approved leads) ----------------
// A lead marked "Approved" gets a pitch report: what they already have, what's missing,
// what Pulse can do about each gap, a likely budget, and how to open the conversation.
// Built from the lead's own audit data, so it costs nothing and works without AI.
function buildProspectReport(lead) {
  const ch = typeof lead.channels === 'string' ? JSON.parse(lead.channels || '{}') : lead.channels || {};
  const swot = typeof lead.swot === 'string' ? JSON.parse(lead.swot || '{}') : lead.swot || {};
  const est = estimateMarket({ niche: lead.niche, city: lead.city || '' });
  const has = [];
  const missing = [];
  const offers = [];
  const add = (service, why, priority) => offers.push({ service, why, priority });

  // Website
  if (!lead.website) {
    missing.push('No website');
    add('Website design + local SEO', 'Customers searching for them online land on nothing they control.', 'High');
  } else if (ch.website && ch.website.score != null && ch.website.score <= 2) {
    missing.push('Weak website' + (ch.website.evidence && ch.website.evidence.length ? ` (${ch.website.evidence.slice(0, 2).join(', ')})` : ''));
    add('Website refresh (mobile-friendly, fast, clear contact)', 'Their site exists but loses visitors.', 'Medium');
  } else has.push('A working website');

  // Instagram
  const followers = lead.ig_followers;
  const lastPost = lead.ig_last_post_days;
  if (!lead.instagram) {
    missing.push('No Instagram');
    add('Instagram setup + content calendar', 'Their customers are on Instagram and they are not.', 'High');
  } else {
    if (lastPost != null && lastPost > 14) {
      missing.push(`Instagram quiet - last post ${lastPost} days ago`);
      add('Monthly content retainer (reels + posts)', `Nothing posted for ${lastPost} days; the account looks inactive to new customers.`, 'High');
    } else if (lastPost != null) has.push(`Active Instagram (posted ${lastPost === 0 ? 'today' : lastPost + ' days ago'})`);
    if (followers != null && followers < 1000) {
      missing.push(`Small Instagram audience (${followers} followers)`);
      add('Instagram growth + local ads', 'Small audience - targeted ads in their area grow it quickly.', 'Medium');
    } else if (followers != null) has.push(`${Number(followers).toLocaleString('en-IN')} Instagram followers`);
  }

  // Google
  if (lead.gmb_reviews == null) {
    missing.push('Google Business profile not found / not checked');
    add('Google Business Profile setup', 'Most local searches start on Google Maps.', 'High');
  } else if (lead.gmb_reviews < 20 || (lead.gmb_rating != null && lead.gmb_rating < 4)) {
    missing.push(`Few Google reviews (${lead.gmb_reviews}${lead.gmb_rating != null ? ', ' + lead.gmb_rating + '★' : ''})`);
    add('Google review drive + profile optimisation', 'Competitors nearby with more reviews rank above them.', 'High');
  } else has.push(`${lead.gmb_reviews} Google reviews${lead.gmb_rating != null ? ' at ' + lead.gmb_rating + '★' : ''}`);

  if (!offers.length) add('Performance ads (Meta + Google)', 'Their basics are in place - ads turn that into more walk-ins and orders.', 'Medium');

  const budget = lead.budget != null ? lead.budget : est.avg_project_value_estimate;
  const firstGap = missing[0] ? missing[0].toLowerCase() : 'room to grow online';
  const who = lead.contact_name ? lead.contact_name.split(' ')[0] : 'there';
  const pitch =
    lead.elevator_pitch ||
    `Hi ${who}, I'm from Pulse Digital Creations. We looked at ${lead.name} online and noticed ${firstGap}. We help ${(NICHES[lead.niche]?.label || 'local businesses').toLowerCase()} in ${lead.city || 'your area'} fix exactly this - could I show you a quick plan?`;

  const talking = [
    ...(swot.weaknesses || []).slice(0, 3),
    ...(swot.opportunities || []).slice(0, 3),
    lead.current_agency ? `They currently work with ${lead.current_agency} - ask what they are happy and unhappy with, and show what that agency is missing (${missing.slice(0, 2).join(', ') || 'results'}).` : 'Ask who handles their marketing today - if nobody, they are an easy first client.',
    lead.signal_title ? `Why now: ${lead.signal_title}` : '',
  ].filter(Boolean);

  return {
    has,
    missing,
    offers: offers.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'High' ? -1 : 1)),
    budget,
    budget_is_estimate: lead.budget == null,
    services_needed: lead.services_needed || offers.map((o) => o.service).join(', '),
    pitch,
    talking_points: talking,
    strengths: swot.strengths || [],
  };
}

router.get('/hunter/prospects', requireHunterAccess, (req, res) => {
  const rows = db
    .prepare("SELECT l.*, u.name updated_by_name FROM hunter_leads l LEFT JOIN users u ON u.id=COALESCE(l.updated_by,l.created_by) WHERE l.status='approved' ORDER BY l.updated_at DESC")
    .all()
    .map(parseRow)
    .map((l) => ({ ...l, report: buildProspectReport(l) }));
  res.json({ rows });
});

// ---------------- competitor agencies (Market tab) ----------------
const AGENCY_FIELDS = ['name', 'city', 'area', 'niches', 'clients', 'client_count', 'avg_fee', 'est_monthly_revenue', 'services', 'website', 'instagram', 'notes'];
const AGENCY_NUM = new Set(['client_count', 'avg_fee', 'est_monthly_revenue']);
function agencyValues(b, prev = {}) {
  const v = {};
  for (const f of AGENCY_FIELDS) {
    const x = b[f] !== undefined ? b[f] : prev[f];
    v[f] = AGENCY_NUM.has(f) ? numOrNull(x) : String(x ?? '').trim().slice(0, 2000);
  }
  // Monthly revenue: use what was entered, else clients x average fee.
  if (v.est_monthly_revenue == null && v.client_count != null && v.avg_fee != null) v.est_monthly_revenue = v.client_count * v.avg_fee;
  return v;
}

router.get('/hunter/agencies', requireHunterAccess, (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, u.name updated_by_name FROM hunter_agencies a LEFT JOIN users u ON u.id=COALESCE(a.updated_by,a.created_by)
       ${req.query.city ? 'WHERE a.city=?' : ''} ORDER BY COALESCE(a.est_monthly_revenue,0) DESC, a.name`
    )
    .all(...(req.query.city ? [req.query.city] : []));
  // Link to your own leads: how many of them say they work with this agency, and their budgets.
  const linked = db.prepare("SELECT LOWER(TRIM(current_agency)) k, COUNT(*) c, SUM(COALESCE(budget,0)) b, GROUP_CONCAT(name, ', ') names FROM hunter_leads WHERE TRIM(COALESCE(current_agency,''))<>'' GROUP BY k").all();
  const byKey = new Map(linked.map((x) => [x.k, x]));
  for (const r of rows) {
    const l = byKey.get(r.name.trim().toLowerCase());
    r.lead_clients = l ? l.c : 0;
    r.lead_clients_names = l ? l.names : '';
    r.lead_budget = l ? l.b : 0;
  }
  res.json({ rows });
});

router.post('/hunter/agencies', requireHunterAccess, (req, res) => {
  const v = agencyValues(req.body || {});
  if (!v.name) return res.status(400).json({ error: 'Agency name is required' });
  const ts = now();
  const r = db
    .prepare(`INSERT INTO hunter_agencies(${AGENCY_FIELDS.join(',')},created_by,updated_by,created_at,updated_at) VALUES(${AGENCY_FIELDS.map(() => '?').join(',')},?,?,?,?)`)
    .run(...AGENCY_FIELDS.map((f) => v[f]), req.user.id, req.user.id, ts, ts);
  audit(req.user, 'CREATE', 'hunter_agency', r.lastInsertRowid, v.name);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/hunter/agencies/:id', requireHunterAccess, (req, res) => {
  const id = Number(req.params.id);
  const prev = db.prepare('SELECT * FROM hunter_agencies WHERE id=?').get(id);
  if (!prev) return res.status(404).json({ error: 'Not found' });
  const b = { ...(req.body || {}) };
  // If clients/fee changed but revenue wasn't given, recompute it.
  if (b.est_monthly_revenue === undefined && (b.client_count !== undefined || b.avg_fee !== undefined)) b.est_monthly_revenue = null;
  const v = agencyValues(b, prev);
  if (!v.name) return res.status(400).json({ error: 'Agency name is required' });
  db.prepare(`UPDATE hunter_agencies SET ${AGENCY_FIELDS.map((f) => f + '=?').join(',')},updated_by=?,updated_at=? WHERE id=?`).run(...AGENCY_FIELDS.map((f) => v[f]), req.user.id, now(), id);
  audit(req.user, 'UPDATE', 'hunter_agency', id, v.name);
  res.json({ ok: true });
});

router.delete('/hunter/agencies/:id', requireHunterAccess, (req, res) => {
  const r = db.prepare('DELETE FROM hunter_agencies WHERE id=?').run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  audit(req.user, 'DELETE', 'hunter_agency', Number(req.params.id), '');
  res.json({ ok: true });
});

module.exports = router;
