const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { audit } = require('../utils/audit');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Sales pipeline for cafes / restaurants the agency is pitching. Admin-only: it holds prospect contact details and deal values.
const STAGES = ['New', 'Contacted', 'Pitched', 'Proposal sent', 'Won', 'Lost'];
const TYPES = ['Cafe', 'Restaurant', 'Bakery', 'Cloud kitchen', 'Bar / Pub', 'Other'];

const leadSelect = `SELECT l.*, u.name owner_name, p.name package_name
  FROM leads l LEFT JOIN users u ON u.id=l.owner_id LEFT JOIN packages p ON p.id=l.package_id`;

function logActivity(leadId, userId, kind, text) {
  db.prepare('INSERT INTO lead_activities(lead_id,user_id,kind,text,created_at) VALUES(?,?,?,?,?)').run(leadId, userId || null, kind, text, now());
}

router.get('/leads', requireAdmin, (req, res) => {
  res.json({
    leads: db.prepare(`${leadSelect} ORDER BY l.updated_at DESC`).all(),
    packages: db.prepare('SELECT * FROM packages WHERE active=1 ORDER BY price').all(),
    stages: STAGES,
    types: TYPES,
  });
});

router.post('/leads', requireAdmin, (req, res) => {
  const b = req.body || {};
  const name = String(b.business_name || '').trim();
  if (!name) return res.status(400).json({ error: 'Business name is required' });
  const stage = STAGES.includes(b.stage) ? b.stage : 'New';
  const ts = now();
  const r = db
    .prepare(
      `INSERT INTO leads(business_name,business_type,contact_name,phone,email,area,source,stage,package_id,monthly_value,next_follow_up,owner_id,notes,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      name,
      TYPES.includes(b.business_type) ? b.business_type : 'Cafe',
      b.contact_name || '',
      b.phone || '',
      b.email || '',
      b.area || '',
      b.source || '',
      stage,
      b.package_id ? Number(b.package_id) : null,
      Math.max(0, Number(b.monthly_value || 0)),
      b.next_follow_up || '',
      b.owner_id ? Number(b.owner_id) : req.user.id,
      b.notes || '',
      ts,
      ts
    );
  logActivity(r.lastInsertRowid, req.user.id, 'stage', `Lead created in "${stage}"`);
  audit(req.user, 'CREATE', 'lead', r.lastInsertRowid, name);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/leads/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const e = db.prepare('SELECT * FROM leads WHERE id=?').get(id);
  if (!e) return res.status(404).json({ error: 'Lead not found' });
  const b = req.body || {};
  const stage = b.stage === undefined ? e.stage : b.stage;
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Unknown stage' });
  if (stage === 'Lost' && !(b.lost_reason ?? e.lost_reason)) return res.status(400).json({ error: 'Add a reason before marking a lead as lost' });
  db.prepare(
    `UPDATE leads SET business_name=?,business_type=?,contact_name=?,phone=?,email=?,area=?,source=?,stage=?,package_id=?,monthly_value=?,next_follow_up=?,owner_id=?,notes=?,lost_reason=?,updated_at=? WHERE id=?`
  ).run(
    b.business_name ?? e.business_name,
    TYPES.includes(b.business_type) ? b.business_type : e.business_type,
    b.contact_name ?? e.contact_name,
    b.phone ?? e.phone,
    b.email ?? e.email,
    b.area ?? e.area,
    b.source ?? e.source,
    stage,
    b.package_id === undefined ? e.package_id : b.package_id ? Number(b.package_id) : null,
    b.monthly_value === undefined ? e.monthly_value : Math.max(0, Number(b.monthly_value || 0)),
    b.next_follow_up ?? e.next_follow_up,
    b.owner_id === undefined ? e.owner_id : b.owner_id ? Number(b.owner_id) : null,
    b.notes ?? e.notes,
    b.lost_reason ?? e.lost_reason,
    now(),
    id
  );
  if (stage !== e.stage) logActivity(id, req.user.id, 'stage', `Moved from "${e.stage}" to "${stage}"`);
  audit(req.user, 'UPDATE', 'lead', id, stage !== e.stage ? `${e.stage} -> ${stage}` : '');
  res.json({ ok: true });
});

router.delete('/leads/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM leads WHERE id=?').run(id);
  audit(req.user, 'DELETE', 'lead', id);
  res.json({ ok: true });
});

router.get('/leads/:id/activities', requireAdmin, (req, res) => {
  const rows = db
    .prepare('SELECT a.*, u.name user_name FROM lead_activities a LEFT JOIN users u ON u.id=a.user_id WHERE a.lead_id=? ORDER BY a.id DESC')
    .all(Number(req.params.id));
  res.json({ rows });
});

router.post('/leads/:id/activities', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const text = String(b.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Write something first' });
  if (!db.prepare('SELECT id FROM leads WHERE id=?').get(id)) return res.status(404).json({ error: 'Lead not found' });
  const kind = ['note', 'call', 'whatsapp', 'meeting', 'email'].includes(b.kind) ? b.kind : 'note';
  logActivity(id, req.user.id, kind, text.slice(0, 1000));
  db.prepare('UPDATE leads SET updated_at=? WHERE id=?').run(now(), id);
  res.status(201).json({ ok: true });
});

// A won lead becomes a real client, so tasks, content and reports can start straight away.
router.post('/leads/:id/convert', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const l = db.prepare('SELECT * FROM leads WHERE id=?').get(id);
  if (!l) return res.status(404).json({ error: 'Lead not found' });
  if (l.converted_client_id) return res.status(409).json({ error: 'This lead is already a client' });
  const words = l.business_name.trim().split(/\s+/);
  const short = (words.length > 1 ? words.map((w) => w[0]).join('') : l.business_name.slice(0, 3)).toUpperCase().slice(0, 6);
  const c = db.prepare('INSERT INTO clients(name,short_name,active,created_at) VALUES(?,?,1,?)').run(l.business_name, short, now());
  db.prepare("UPDATE leads SET stage='Won', converted_client_id=?, updated_at=? WHERE id=?").run(c.lastInsertRowid, now(), id);
  logActivity(id, req.user.id, 'stage', 'Converted to a client');
  audit(req.user, 'CONVERT', 'lead', id, l.business_name);
  res.json({ ok: true, client_id: c.lastInsertRowid });
});

// --- Packages the sales team can offer ---

router.post('/packages', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Package name is required' });
  const r = db
    .prepare('INSERT INTO packages(name,reels_per_month,price,description) VALUES(?,?,?,?)')
    .run(String(b.name).trim(), Number(b.reels_per_month || 0), Math.max(0, Number(b.price || 0)), b.description || '');
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/packages/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const e = db.prepare('SELECT * FROM packages WHERE id=?').get(id);
  if (!e) return res.status(404).json({ error: 'Package not found' });
  const b = req.body || {};
  db.prepare('UPDATE packages SET name=?,reels_per_month=?,price=?,description=?,active=? WHERE id=?').run(
    b.name ?? e.name,
    Number(b.reels_per_month ?? e.reels_per_month),
    Math.max(0, Number(b.price ?? e.price)),
    b.description ?? e.description,
    b.active === undefined ? e.active : b.active ? 1 : 0,
    id
  );
  res.json({ ok: true });
});

module.exports = router;
