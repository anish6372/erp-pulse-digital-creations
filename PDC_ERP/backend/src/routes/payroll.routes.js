const express = require('express');
const { db } = require('../db');
const { now, today } = require('../utils/datetime');
const { audit } = require('../utils/audit');
const { requireAdmin } = require('../middleware/auth');
const { calcMonthly } = require('../utils/payroll');

const router = express.Router();

router.get('/payroll', requireAdmin, (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  const users = db.prepare('SELECT * FROM users WHERE active=1 ORDER BY name').all();
  const rows = users.map((x) => {
    const r = calcMonthly(x.id, month);
    const pay = db.prepare('SELECT status,paid_at,note FROM payroll_payments WHERE user_id=? AND month=?').get(x.id, month);
    r.payment_status = pay?.status || 'Pending';
    r.paid_at = pay?.paid_at || null;
    r.payment_note = pay?.note || '';
    r.name = x.name;
    return r;
  });
  const total = rows.reduce((a, b) => a + b.net_payable, 0);
  const gross = rows.reduce((a, b) => a + b.base_salary, 0);
  const ded = rows.reduce((a, b) => a + b.total_deductions, 0);
  const closure = db.prepare('SELECT month,closed_at FROM payroll_closures WHERE month=?').get(month);
  res.json({ month, closed: !!closure, closed_at: closure?.closed_at || null, rows, totals: { gross, net_payable: Math.round(total * 100) / 100, deductions: Math.round(ded * 100) / 100 } });
});

router.post('/payroll/close', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const month = String(b.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Valid month is required' });
  const existing = db.prepare('SELECT month FROM payroll_closures WHERE month=?').get(month);
  if (existing) return res.status(409).json({ error: 'Payroll month is already finalized' });
  db.prepare('INSERT INTO payroll_closures(month,closed_at,closed_by) VALUES(?,?,?)').run(month, now(), admin.id);
  audit(admin, 'CLOSE', 'payroll', null, month);
  res.json({ ok: true, month });
});

router.post('/payroll/reopen', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const month = String(b.month || '');
  db.prepare('DELETE FROM payroll_closures WHERE month=?').run(month);
  db.prepare("UPDATE payroll_payments SET status='Pending',paid_at=NULL WHERE month=?").run(month);
  audit(admin, 'REOPEN', 'payroll', null, month);
  res.json({ ok: true, month });
});

router.post('/payroll/payment', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const uid = Number(b.user_id);
  const month = b.month;
  const closed = db.prepare('SELECT month FROM payroll_closures WHERE month=?').get(month);
  if (b.status === 'Paid' && !closed) return res.status(400).json({ error: 'Finalize the payroll month before marking salary as Paid' });
  const statusVal = b.status === 'Paid' ? 'Paid' : 'Pending';
  db.prepare(
    `INSERT INTO payroll_payments(user_id,month,status,paid_at,note) VALUES(?,?,?,?,?) ON CONFLICT(user_id,month) DO UPDATE SET status=excluded.status,paid_at=excluded.paid_at,note=excluded.note`
  ).run(uid, month, statusVal, statusVal === 'Paid' ? now() : null, b.note || '');
  audit(admin, 'PAYMENT_' + statusVal, 'payroll', uid, `${month}:${statusVal}`);
  res.json({ ok: true });
});

router.post('/payroll/adjustment', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const r = db.prepare('INSERT INTO payroll_adjustments(user_id,month,amount,note,created_at) VALUES(?,?,?,?,?)').run(Number(b.user_id), b.month, Number(b.amount || 0), b.note || '', now());
  audit(admin, 'CREATE', 'payroll_adjustment', r.lastInsertRowid);
  res.status(201).json({ id: r.lastInsertRowid });
});

module.exports = router;
