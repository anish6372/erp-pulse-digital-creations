const express = require('express');
const { db } = require('../db');
const { today } = require('../utils/datetime');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/admin/team-status', requireAdmin, (req, res) => {
  const d = today();
  const rows = db
    .prepare(
      `SELECT u.id, a.status AS attendance_status, a.first_login,
              CASE WHEN ws.id IS NOT NULL THEN 1 ELSE 0 END AS working
       FROM users u
       LEFT JOIN attendance_days a ON a.user_id = u.id AND a.date = ?
       LEFT JOIN work_sessions ws ON ws.user_id = u.id AND ws.ended_at IS NULL
       WHERE u.active = 1 AND u.role <> 'Admin'
       ORDER BY u.name`
    )
    .all(d);
  res.json({ rows });
});

router.get('/admin/dashboard', requireAdmin, (req, res) => {
  const d = today();
  const active = db.prepare("SELECT COUNT(*) c FROM users WHERE active=1 AND role<>'Admin'").get().c;
  const present = db
    .prepare("SELECT COUNT(*) c FROM attendance_days a JOIN users u ON u.id=a.user_id WHERE a.date=? AND a.status IN ('Present','Late / Half Day','Half Day') AND u.role<>'Admin'")
    .get(d).c;
  const open = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status<>'Done'").get().c;
  const done = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='Done' AND updated_at LIKE ?").get(d + '%').c;
  const pending = db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status='Pending'").get().c;
  const unread = db.prepare('SELECT COUNT(*) c FROM messages WHERE receiver_id=? AND read_at IS NULL').get(req.user.id).c;
  res.json({ active, present, absent: Math.max(0, active - present), open_tasks: open, completed_today: done, pending_leaves: pending, unread_chat: unread });
});

// Aggregates for the admin dashboard: month-over-month trends, a 30-day task series,
// lead pipeline, recent activity and a performer leaderboard.
router.get('/admin/overview', requireAdmin, (req, res) => {
  const d = today();
  const month = d.slice(0, 7);
  const prevDate = new Date(d + 'T00:00:00Z');
  prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
  const prev = prevDate.toISOString().slice(0, 7);
  const one = (sql, ...args) => db.prepare(sql).get(...args).c || 0;

  const monthStats = (m) => ({
    created: one('SELECT COUNT(*) c FROM tasks WHERE created_at LIKE ?', m + '%'),
    completed: one("SELECT COUNT(*) c FROM tasks WHERE status='Done' AND completed_at LIKE ?", m + '%'),
    hours: one('SELECT COALESCE(SUM(hours),0) c FROM work_reports WHERE work_date LIKE ?', m + '%'),
    reports: one('SELECT COUNT(*) c FROM work_reports WHERE work_date LIKE ?', m + '%'),
    leads: one('SELECT COUNT(*) c FROM leads WHERE created_at LIKE ?', m + '%'),
    won_value: one("SELECT COALESCE(SUM(monthly_value),0) c FROM leads WHERE stage='Won' AND updated_at LIKE ?", m + '%'),
  });

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const x = new Date(d + 'T00:00:00Z');
    x.setUTCDate(x.getUTCDate() - i);
    days.push(x.toISOString().slice(0, 10));
  }
  const series = days.map((day) => ({
    date: day,
    created: one('SELECT COUNT(*) c FROM tasks WHERE created_at LIKE ?', day + '%'),
    completed: one("SELECT COUNT(*) c FROM tasks WHERE status='Done' AND completed_at LIKE ?", day + '%'),
  }));

  const leadStages = db.prepare('SELECT stage, COUNT(*) n, COALESCE(SUM(monthly_value),0) value FROM leads GROUP BY stage').all();
  const attendance = db
    .prepare("SELECT a.status, COUNT(*) n FROM attendance_days a JOIN users u ON u.id=a.user_id WHERE a.date=? AND u.role<>'Admin' GROUP BY a.status")
    .all(d);
  const activity = db
    .prepare(
      `SELECT l.action, l.entity_type, l.meta, l.created_at, u.name actor FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id
       WHERE l.entity_type<>'session' AND l.action NOT LIKE '%FAILED%' ORDER BY l.id DESC LIMIT 8`
    )
    .all();
  const performers = db
    .prepare(
      `SELECT u.id, u.name, u.designation,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status='Done' AND t.completed_at LIKE ?1) done,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status<>'Done') open,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status='Done' AND t.completed_at LIKE ?1 AND t.completed_at<=t.due_date) on_time,
        (SELECT COALESCE(SUM(hours),0) FROM work_reports w WHERE w.user_id=u.id AND w.work_date LIKE ?1) hours
       FROM users u WHERE u.active=1 AND u.role<>'Admin' ORDER BY done DESC, hours DESC LIMIT 6`
    )
    .all(month + '%');

  res.json({
    month: monthStats(month),
    prev_month: monthStats(prev),
    overdue: one("SELECT COUNT(*) c FROM tasks WHERE status<>'Done' AND due_date<?", d),
    due_today: one("SELECT COUNT(*) c FROM tasks WHERE status<>'Done' AND due_date=?", d),
    series,
    lead_stages: leadStages,
    attendance,
    activity,
    performers,
  });
});

module.exports = router;
