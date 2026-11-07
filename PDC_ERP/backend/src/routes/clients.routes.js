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
  const r = db.prepare('INSERT INTO clients(name,short_name,created_at) VALUES(?,?,?)').run(b.name, b.short_name, now());
  audit(admin, 'CREATE', 'client', r.lastInsertRowid, b.name);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/clients/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  const b = req.body || {};
  db.prepare('UPDATE clients SET name=?,short_name=?,active=? WHERE id=?').run(b.name, b.short_name, b.active === 0 ? 0 : 1, id);
  audit(admin, 'UPDATE', 'client', id);
  res.json({ ok: true });
});

module.exports = router;
