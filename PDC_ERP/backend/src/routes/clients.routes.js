const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { audit } = require('../utils/audit');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/clients', requireAuth, (req, res) => {
  res.json({ clients: db.prepare('SELECT * FROM clients ORDER BY name').all() });
});

router.post('/clients', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const r = db
    .prepare('INSERT INTO clients(name,short_name,address,business_type,contact_person,phone,email,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(
      String(b.name || '').trim(),
      String(b.short_name || '').trim(),
      String(b.address || '').trim(),
      String(b.business_type || '').trim(),
      String(b.contact_person || '').trim(),
      String(b.phone || '').trim(),
      String(b.email || '').trim(),
      now()
    );
  audit(admin, 'CREATE', 'client', r.lastInsertRowid, b.name);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/clients/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM clients WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const fields = ['name', 'short_name', 'address', 'business_type', 'contact_person', 'phone', 'email'];
  const vals = fields.map((k) => (b[k] !== undefined ? String(b[k]).trim() : existing[k]));
  const active = b.active !== undefined ? (b.active === 0 || b.active === false ? 0 : 1) : existing.active;
  db.prepare(`UPDATE clients SET ${fields.map((k) => k + '=?').join(',')},active=? WHERE id=?`).run(...vals, active, id);
  audit(admin, 'UPDATE', 'client', id);
  res.json({ ok: true });
});

router.delete('/clients/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM clients WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  // Soft delete: clients are referenced by tasks, work reports and marketing data,
  // so deactivating (not erasing the row) preserves that history instead of breaking it.
  db.prepare('UPDATE clients SET active=0 WHERE id=?').run(id);
  audit(admin, 'DEACTIVATE', 'client', id, existing.name);
  res.json({ ok: true });
});

module.exports = router;
