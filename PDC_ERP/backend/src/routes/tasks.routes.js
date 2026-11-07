const express = require('express');
const { db } = require('../db');
const { now, today } = require('../utils/datetime');
const { notify, notifyAdmins } = require('../utils/notify');
const { audit } = require('../utils/audit');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/tasks', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const assigneeId = Number(b.assignee_id);
  const assignee = db.prepare('SELECT id,name FROM users WHERE id=? AND active=1').get(assigneeId);
  if (!assignee) return res.status(400).json({ error: 'Invalid assignee' });
  const r = db
    .prepare(`INSERT INTO tasks(title,description,assignee_id,client_id,priority,category,status,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(b.title, b.description || '', assigneeId, b.client_id ? Number(b.client_id) : null, b.priority || 'Medium', b.category || 'Other', b.status || 'Not Started', b.due_date, now(), now());
  notify(assigneeId, 'task_assigned', 'New task assigned', `You have been assigned: ${b.title}`, 'task', Number(r.lastInsertRowid), `task_assigned:${r.lastInsertRowid}:${assigneeId}`);
  audit(admin, 'CREATE', 'task', r.lastInsertRowid, b.title);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/tasks/:id', requireAuth, (req, res) => {
  const u = req.user;
  const id = Number(req.params.id);
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  if (u.role !== 'Admin' && existing.assignee_id !== u.id) return res.status(403).json({ error: 'Forbidden' });
  const status = b.status ?? existing.status;
  const nextAssignee = Number(b.assignee_id ?? existing.assignee_id);
  const completed = status === 'Done' ? existing.completed_at || today() : null;
  db.prepare(`UPDATE tasks SET title=?,description=?,assignee_id=?,client_id=?,priority=?,category=?,status=?,due_date=?,updated_at=?,completed_at=? WHERE id=?`).run(
    b.title ?? existing.title,
    b.description ?? existing.description,
    nextAssignee,
    b.client_id === null ? null : Number(b.client_id ?? existing.client_id),
    b.priority ?? existing.priority,
    b.category ?? existing.category,
    status,
    b.due_date ?? existing.due_date,
    now(),
    completed,
    id
  );
  if (u.role === 'Admin' && nextAssignee !== existing.assignee_id)
    notify(nextAssignee, 'task_assigned', 'Task reassigned', `You have been assigned: ${b.title ?? existing.title}`, 'task', id, `task_reassigned:${id}:${nextAssignee}:${Date.now()}`);
  if (status !== existing.status && status !== 'Done' && nextAssignee === existing.assignee_id && u.role === 'Admin')
    notify(nextAssignee, 'task_status', 'Task updated', `${b.title ?? existing.title} is now ${status}.`, 'task', id, `task_status:${id}:${status}:${today()}`);
  if (status === 'Done' && existing.status !== 'Done') {
    notifyAdmins('task_done', 'Work completed', `${existing.title} was marked Done by ${u.name}.`, 'task', id, `task_done:${id}:${today()}`);
    if (u.role === 'Admin') notify(nextAssignee, 'task_done', 'Work marked done', `${existing.title} was marked Done by Admin.`, 'task', id, `task_done_employee:${id}:${today()}`);
  }
  audit(u, 'UPDATE', 'task', id, status);
  res.json({ ok: true });
});

router.delete('/tasks/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM tasks WHERE id=?').run(id);
  audit(req.user, 'DELETE', 'task', id);
  res.json({ ok: true });
});

module.exports = router;
