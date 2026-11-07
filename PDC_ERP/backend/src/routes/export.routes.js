const express = require('express');
const { db } = require('../db');
const { now, today } = require('../utils/datetime');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/export', requireAdmin, (req, res) => {
  const payload = {
    exported_at: now(),
    users: db
      .prepare(
        'SELECT id,name,employee_code,role,department,designation,joining_date,employment_type,manager_id,phone,email,monthly_salary,monthly_target_tasks,monthly_target_hours,active,created_at,updated_at FROM users'
      )
      .all(),
    clients: db.prepare('SELECT * FROM clients').all(),
    tasks: db.prepare('SELECT * FROM tasks').all(),
    attendance: db.prepare('SELECT * FROM attendance_days').all(),
    login_sessions: db.prepare('SELECT * FROM login_sessions').all(),
    work_sessions: db.prepare('SELECT * FROM work_sessions').all(),
    work_reports: db.prepare('SELECT * FROM work_reports').all(),
    leave_requests: db.prepare('SELECT * FROM leave_requests').all(),
    payroll_adjustments: db.prepare('SELECT * FROM payroll_adjustments').all(),
    candidates: db.prepare('SELECT * FROM candidates').all(),
    messages: db.prepare('SELECT * FROM messages').all(),
  };
  res.setHeader('Content-Disposition', `attachment; filename="pdc_erp_backup_${today()}.json"`);
  res.json(payload);
});

module.exports = router;
