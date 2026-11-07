const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { notify, notifyAdmins } = require('../utils/notify');
const { audit } = require('../utils/audit');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/leaves', requireAuth, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  if (!b.leave_date || !['Full Day', 'Half Day'].includes(b.leave_type) || !String(b.reason || '').trim())
    return res.status(400).json({ error: 'Date, type and reason are required' });
  const r = db.prepare(`INSERT INTO leave_requests(user_id,leave_date,leave_type,reason,status,requested_at) VALUES(?,?,?,?, 'Pending',?)`).run(u.id, b.leave_date, b.leave_type, b.reason.trim(), now());
  notifyAdmins('leave_request', 'New leave request', `${u.name} requested ${b.leave_type} for ${b.leave_date}.`, 'leave', Number(r.lastInsertRowid), `leave_request:${r.lastInsertRowid}`);
  audit(u, 'REQUEST', 'leave', r.lastInsertRowid, b.leave_type);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/leaves/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  const b = req.body || {};
  if (!['Approved', 'Rejected'].includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
  const lr = db.prepare('SELECT * FROM leave_requests WHERE id=?').get(id);
  if (!lr) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE leave_requests SET status=?,reviewed_at=? WHERE id=?').run(b.status, now(), id);
  if (b.status === 'Approved') {
    const prior = db.prepare('SELECT * FROM attendance_days WHERE user_id=? AND date=?').get(lr.user_id, lr.leave_date);
    const st = lr.leave_type === 'Half Day' ? 'Half Day' : 'Leave';
    if (prior) db.prepare('UPDATE attendance_days SET status=?,manual_note=? WHERE id=?').run(st, 'Approved leave', prior.id);
    else db.prepare('INSERT INTO attendance_days(user_id,date,status,first_login,manual_note) VALUES(?,?,?,NULL,?)').run(lr.user_id, lr.leave_date, st, 'Approved leave');
  }
  notify(lr.user_id, 'leave_decision', `Leave ${b.status.toLowerCase()}`, `Your ${lr.leave_type} request for ${lr.leave_date} was ${b.status.toLowerCase()}.`, 'leave', id, `leave_decision:${id}:${b.status}`);
  audit(admin, b.status.toUpperCase(), 'leave', id);
  res.json({ ok: true });
});

module.exports = router;
