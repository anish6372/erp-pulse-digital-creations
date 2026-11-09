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
      String(b.name || '').trim(),
      String(b.employee_code || '').trim(),
      passwordHash(b.password || 'Welcome@2026'),
      b.role || 'Employee',
      b.department || '',
      b.designation || '',
      b.joining_date || today(),
      b.employment_type || 'Full Time',
      String(b.phone || '').trim(),
      String(b.email || '').trim(),
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
  // Changing the role away from Admin on the last active Admin account would lock everyone
  // out of admin functions with no way back in through the UI - same guard as deleting one.
  if (existing.role === 'Admin' && b.role && b.role !== 'Admin') {
    const otherActiveAdmins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='Admin' AND active=1 AND id<>?").get(id).c;
    if (otherActiveAdmins === 0) return res.status(400).json({ error: 'At least one active Admin must remain - promote someone else first' });
  }
  let ph = existing.password_hash;
  if (b.password) ph = passwordHash(String(b.password));
  const trimmed = ['name', 'employee_code', 'email', 'phone'];
  trimmed.forEach((k) => {
    if (typeof b[k] === 'string') b[k] = b[k].trim();
  });
  const fields = ['name', 'employee_code', 'role', 'department', 'designation', 'joining_date', 'employment_type', 'phone', 'email', 'monthly_salary', 'monthly_target_tasks', 'monthly_target_hours', 'active', 'manager_id'];
  const vals = fields.map((k) => (b[k] !== undefined ? b[k] : existing[k]));
  const sql = `UPDATE users SET ${fields.map((k) => k + '=?').join(',')},password_hash=?,updated_at=? WHERE id=?`;
  db.prepare(sql).run(...vals, ph, now(), id);
  audit(admin, 'UPDATE', 'user', id, JSON.stringify({ salary: b.monthly_salary }));
  res.json({ ok: true });
});

router.delete('/users/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (id === admin.id) return res.status(400).json({ error: "You can't remove your own account" });
  if (existing.role === 'Admin') {
    const otherActiveAdmins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='Admin' AND active=1 AND id<>?").get(id).c;
    if (otherActiveAdmins === 0) return res.status(400).json({ error: 'At least one active Admin must remain' });
  }
  // Soft delete: employees are referenced by tasks, payroll, leave requests, attendance and audit
  // logs, so deactivating (not erasing the row) preserves that history instead of breaking it.
  db.prepare('UPDATE users SET active=0, updated_at=? WHERE id=?').run(now(), id);
  audit(admin, 'DEACTIVATE', 'user', id, existing.employee_code);
  res.json({ ok: true });
});

module.exports = router;
