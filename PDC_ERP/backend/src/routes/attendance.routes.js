const express = require('express');
const { db } = require('../db');
const { today } = require('../utils/datetime');
const { now } = require('../utils/datetime');
const { notify } = require('../utils/notify');
const { audit } = require('../utils/audit');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { calcMonthly } = require('../utils/payroll');

const router = express.Router();

// Actual hours worked that day, from real login/logout session timestamps - not the
// separate manual Work ON/OFF timer, which tracks task time and is a different, narrower
// thing. Sums every login session that started that day; an open session (still logged
// in, logout_at NULL) counts up to right now, so today's in-progress hours show live.
const dayHoursStmt = db.prepare(
  `SELECT COALESCE(SUM((julianday(COALESCE(logout_at, datetime('now'))) - julianday(login_at)) * 24), 0) h
   FROM login_sessions WHERE user_id=? AND date(login_at)=?`
);
// How many separate times they logged in that day - mainly so repeated logins caused by
// the 15-minute idle auto-logout are visible as a count, not hidden behind one first-login
// time as if they'd only logged in once.
const dayLoginCountStmt = db.prepare(`SELECT COUNT(*) c FROM login_sessions WHERE user_id=? AND date(login_at)=?`);

router.get('/attendance', requireAuth, (req, res) => {
  const u = req.user;
  const month = req.query.month || today().slice(0, 7);
  const target = u.role === 'Admin' ? (req.query.user_id ? Number(req.query.user_id) : null) : u.id;
  const users = target ? [db.prepare('SELECT * FROM users WHERE id=?').get(target)] : db.prepare('SELECT * FROM users WHERE active=1 ORDER BY name').all();
  const out = users.filter(Boolean).map((x) => ({
    user_id: x.id,
    name: x.name,
    employee_code: x.employee_code,
    rows: db
      .prepare('SELECT * FROM attendance_days WHERE user_id=? AND date LIKE ? ORDER BY date DESC')
      .all(x.id, month + '-%')
      .map((r) => ({ ...r, hours_logged: dayHoursStmt.get(x.id, r.date).h, login_count: dayLoginCountStmt.get(x.id, r.date).c })),
    summary: calcMonthly(x.id, month),
  }));
  res.json({ month, data: out });
});

// The actual list of that day's login/logout times, for the "how many times, and when"
// detail view - the day row only has room for a count.
router.get('/attendance/sessions', requireAuth, (req, res) => {
  const u = req.user;
  const date = String(req.query.date || '');
  const userId = Number(req.query.user_id) || u.id;
  if (u.role !== 'Admin' && userId !== u.id) return res.status(403).json({ error: 'Not authorized' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Valid date required' });
  const rows = db.prepare('SELECT login_at, logout_at FROM login_sessions WHERE user_id=? AND date(login_at)=? ORDER BY login_at').all(userId, date);
  res.json({ rows });
});

router.put('/attendance/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const r = db.prepare('SELECT * FROM attendance_days WHERE id=?').get(id);
  if (!r) return res.status(404).json({ error: 'Attendance record not found' });
  const allowed = ['Present', 'Absent', 'Leave', 'Half Day', 'Late / Half Day'];
  if (!allowed.includes(b.status)) return res.status(400).json({ error: 'Invalid attendance status' });
  db.prepare('UPDATE attendance_days SET status=?,manual_note=? WHERE id=?').run(b.status, b.manual_note || '', id);
  notify(r.user_id, 'attendance_update', 'Attendance updated', `Your attendance for ${r.date} was updated to ${b.status}.`, 'attendance', id, `attendance_update:${id}:${b.status}`);
  audit(req.user, 'UPDATE', 'attendance', id, b.status);
  res.json({ ok: true });
});

module.exports = router;
