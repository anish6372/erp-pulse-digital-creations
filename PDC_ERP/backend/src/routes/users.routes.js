const express = require('express');
const { db } = require('../db');
const { now, today } = require('../utils/datetime');
const { passwordHash } = require('../utils/crypto');
const { audit } = require('../utils/audit');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/users', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const r = db
    .prepare(
      `INSERT INTO users(name,employee_code,password_hash,role,department,designation,joining_date,employment_type,phone,email,monthly_salary,monthly_target_tasks,monthly_target_hours,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      b.name,
      b.employee_code,
      passwordHash(b.password || 'Welcome@2026'),
      b.role || 'Employee',
      b.department || '',
      b.designation || '',
      b.joining_date || today(),
      b.employment_type || 'Full Time',
      b.phone || '',
      b.email || '',
      b.monthly_salary || 0,
      b.monthly_target_tasks || 0,
      b.monthly_target_hours || 0,
      b.active === 0 ? 0 : 1,
      now(),
      now()
    );
  audit(admin, 'CREATE', 'user', r.lastInsertRowid, b.employee_code);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/users/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  let ph = existing.password_hash;
  if (b.password) ph = passwordHash(String(b.password));
  const fields = ['name', 'employee_code', 'role', 'department', 'designation', 'joining_date', 'employment_type', 'phone', 'email', 'monthly_salary', 'monthly_target_tasks', 'monthly_target_hours', 'active', 'manager_id'];
  const vals = fields.map((k) => (b[k] !== undefined ? b[k] : existing[k]));
  const sql = `UPDATE users SET ${fields.map((k) => k + '=?').join(',')},password_hash=?,updated_at=? WHERE id=?`;
  db.prepare(sql).run(...vals, ph, now(), id);
  audit(admin, 'UPDATE', 'user', id, JSON.stringify({ salary: b.monthly_salary }));
  res.json({ ok: true });
});

module.exports = router;
