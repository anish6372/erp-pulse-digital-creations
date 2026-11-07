const express = require('express');
const { db } = require('../db');
const { now, today } = require('../utils/datetime');
const { notifyAdmins } = require('../utils/notify');
const { audit } = require('../utils/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/reports', requireAuth, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  if (!String(b.work_text || '').trim()) return res.status(400).json({ error: 'Work description is required' });
  const hours = Number(b.hours || 0);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) return res.status(400).json({ error: 'Hours must be between 0 and 24' });
  if (u.role !== 'Admin' && b.user_id && Number(b.user_id) !== u.id) return res.status(403).json({ error: 'Forbidden' });
  const uid2 = u.role === 'Admin' && b.user_id ? Number(b.user_id) : u.id;
  let task = null;
  if (b.task_id) {
    task = db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(b.task_id));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (u.role !== 'Admin' && task.assignee_id !== u.id) return res.status(403).json({ error: 'Task is not assigned to you' });
  }
  const r = db
    .prepare(
      `INSERT INTO work_reports(user_id,task_id,client_id,work_date,work_text,hours,work_drive_link,poster_drive_link,attachment_path,attachment_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(uid2, b.task_id ? Number(b.task_id) : null, b.client_id ? Number(b.client_id) : null, b.work_date || today(), b.work_text.trim(), hours, b.work_drive_link || '', b.poster_drive_link || '', b.attachment_path || '', b.attachment_name || '', now(), now());
  if (b.task_id && b.mark_done) {
    db.prepare("UPDATE tasks SET status='Done',completed_at=?,updated_at=? WHERE id=?").run(today(), now(), Number(b.task_id));
    notifyAdmins('task_done', 'Work completed', `${u.name} submitted work and marked "${task.title}" as Done.`, 'task', Number(b.task_id), `task_done:${b.task_id}:${today()}`);
  }
  notifyAdmins('work_submitted', 'New work submitted', `${u.name} submitted a daily work report${task ? ' for ' + task.title : ''}.`, 'work_report', Number(r.lastInsertRowid), `work_submitted:${r.lastInsertRowid}`);
  audit(u, 'SUBMIT', 'work_report', r.lastInsertRowid, b.work_text.trim().slice(0, 80) || '');
  res.status(201).json({ id: r.lastInsertRowid });
});

module.exports = router;
