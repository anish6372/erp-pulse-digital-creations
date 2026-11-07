const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/deliverables', requireAuth, (req, res) => {
  const u = req.user;
  const isAdmin = u.role === 'Admin';

  const tasks = isAdmin
    ? db
        .prepare(
          `SELECT t.id, t.title, t.description, t.completed_at, t.due_date, t.priority, t.category,
                  u.id assignee_id, u.name assignee_name,
                  c.id client_id, c.name client_name, c.short_name client_short
           FROM tasks t
           JOIN users u ON u.id = t.assignee_id
           LEFT JOIN clients c ON c.id = t.client_id
           WHERE t.status='Done'
           ORDER BY t.completed_at DESC, t.due_date DESC`
        )
        .all()
    : db
        .prepare(
          `SELECT t.id, t.title, t.description, t.completed_at, t.due_date, t.priority, t.category,
                  u.id assignee_id, u.name assignee_name,
                  c.id client_id, c.name client_name, c.short_name client_short
           FROM tasks t
           JOIN users u ON u.id = t.assignee_id
           LEFT JOIN clients c ON c.id = t.client_id
           WHERE t.status='Done' AND t.assignee_id=?
           ORDER BY t.completed_at DESC, t.due_date DESC`
        )
        .all(u.id);

  const taskIds = tasks.map((t) => t.id);
  const reportsByTask = new Map();
  if (taskIds.length) {
    const reports = db
      .prepare(
        `SELECT id, task_id, work_date, work_text, hours, work_drive_link, poster_drive_link, attachment_path, attachment_name, created_at
         FROM work_reports WHERE task_id IN (${taskIds.map(() => '?').join(',')})
         ORDER BY created_at DESC`
      )
      .all(...taskIds);
    for (const r of reports) {
      if (!reportsByTask.has(r.task_id)) reportsByTask.set(r.task_id, []);
      reportsByTask.get(r.task_id).push(r);
    }
  }

  const out = tasks.map((t) => ({ ...t, reports: reportsByTask.get(t.id) || [] }));
  res.json({ tasks: out });
});

module.exports = router;
