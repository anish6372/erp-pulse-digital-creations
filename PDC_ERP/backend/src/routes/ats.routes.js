const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { audit } = require('../utils/audit');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/ats', requireAdmin, (req, res) => {
  res.json({ rows: db.prepare('SELECT * FROM candidates ORDER BY updated_at DESC').all() });
});

router.post('/ats', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const r = db
    .prepare(`INSERT INTO candidates(name,position,phone,email,source,stage,interview_date,resume_link,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.name, b.position, b.phone || '', b.email || '', b.source || '', b.stage || 'Applied', b.interview_date || '', b.resume_link || '', b.notes || '', now(), now());
  audit(admin, 'CREATE', 'candidate', r.lastInsertRowid, b.name);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/ats/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  const b = req.body || {};
  const e = db.prepare('SELECT * FROM candidates WHERE id=?').get(id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE candidates SET name=?,position=?,phone=?,email=?,source=?,stage=?,interview_date=?,resume_link=?,notes=?,updated_at=? WHERE id=?`).run(
    b.name ?? e.name,
    b.position ?? e.position,
    b.phone ?? e.phone,
    b.email ?? e.email,
    b.source ?? e.source,
    b.stage ?? e.stage,
    b.interview_date ?? e.interview_date,
    b.resume_link ?? e.resume_link,
    b.notes ?? e.notes,
    now(),
    id
  );
  audit(admin, 'UPDATE', 'candidate', id);
  res.json({ ok: true });
});

module.exports = router;
