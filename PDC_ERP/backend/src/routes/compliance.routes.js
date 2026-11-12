const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { audit } = require('../utils/audit');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const normalize = (v) => String(v || '').trim().toLowerCase();

// ---------- do-not-contact list ----------

router.get('/compliance/dnc', requireAdmin, (req, res) => {
  res.json({ rows: db.prepare('SELECT d.*, u.name added_by_name FROM do_not_contact d LEFT JOIN users u ON u.id=d.added_by ORDER BY d.created_at DESC').all() });
});

const DNC_TYPES = ['email', 'phone', 'domain', 'instagram'];

router.post('/compliance/dnc', requireAdmin, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const type = DNC_TYPES.includes(b.type) ? b.type : 'email';
  const value = normalize(b.value);
  if (!value) return res.status(400).json({ error: 'A value is required' });
  const ts = now();
  try {
    const r = db.prepare('INSERT INTO do_not_contact(type,value,reason,added_by,created_at) VALUES(?,?,?,?,?)').run(type, value, String(b.reason || '').slice(0, 300), u.id, ts);
    audit(u, 'CREATE', 'do_not_contact', r.lastInsertRowid, value);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Already on the list' });
  }
});

router.delete('/compliance/dnc/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('SELECT * FROM do_not_contact WHERE id=?').get(id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM do_not_contact WHERE id=?').run(id);
  audit(req.user, 'DELETE', 'do_not_contact', id, r.value);
  res.json({ ok: true });
});

// Checked before reaching out to someone new - a lead/prospect form can call this to warn
// the salesperson before they ever send a first message.
router.get('/compliance/dnc/check', requireAdmin, (req, res) => {
  const value = normalize(req.query.value);
  if (!value) return res.json({ blocked: false });
  const hit = db.prepare('SELECT * FROM do_not_contact WHERE value=?').get(value);
  res.json({ blocked: !!hit, reason: hit?.reason || null });
});

// ---------- DPDP / GDPR data requests ----------

function collectRecords(contact) {
  const leads = db.prepare('SELECT id,business_name,contact_name,phone,email,stage,notes,created_at FROM leads WHERE LOWER(phone)=? OR LOWER(email)=?').all(contact, contact);
  const candidates = db.prepare('SELECT id,name,phone,email,stage,notes,created_at FROM candidates WHERE LOWER(phone)=? OR LOWER(email)=?').all(contact, contact);
  return { leads, candidates };
}

router.get('/compliance/data-requests', requireAdmin, (req, res) => {
  res.json({ rows: db.prepare('SELECT d.*, u.name requested_by_name FROM data_requests d LEFT JOIN users u ON u.id=d.requested_by ORDER BY d.created_at DESC').all() });
});

router.post('/compliance/data-requests', requireAdmin, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const kind = b.kind === 'delete' ? 'delete' : 'access';
  const contact = normalize(b.contact_value);
  if (!contact) return res.status(400).json({ error: 'A phone or email is required' });

  const found = collectRecords(contact);
  let result = found;

  if (kind === 'delete') {
    // Anonymizes the personal-data fields only - the business record (which stage a deal
    // reached, what was discussed) stays for legitimate business history, the actual
    // contact details don't.
    const redacted = { ...result };
    for (const l of found.leads) {
      db.prepare("UPDATE leads SET contact_name='[removed]', phone='', email='' WHERE id=?").run(l.id);
    }
    for (const c of found.candidates) {
      db.prepare("UPDATE candidates SET name='[removed]', phone='', email='' WHERE id=?").run(c.id);
    }
    result = redacted;
  }

  const ts = now();
  const r = db
    .prepare('INSERT INTO data_requests(kind,contact_value,status,result,requested_by,created_at) VALUES(?,?,?,?,?,?)')
    .run(kind, contact, 'Fulfilled', JSON.stringify(result), u.id, ts);
  audit(u, kind === 'delete' ? 'DELETE' : 'ACCESS', 'data_request', r.lastInsertRowid, contact);
  res.status(201).json({ id: r.lastInsertRowid, kind, contact_value: contact, result, created_at: ts });
});

// ---------- activity / audit trail ----------

router.get('/compliance/activity', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.id, l.action, l.entity_type, l.entity_id, l.meta, l.created_at, u.name actor
       FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id
       WHERE l.entity_type IN ('lead','candidate','do_not_contact','data_request','prospect_report','client')
       ORDER BY l.id DESC LIMIT 150`
    )
    .all();
  res.json({ rows });
});

module.exports = router;
