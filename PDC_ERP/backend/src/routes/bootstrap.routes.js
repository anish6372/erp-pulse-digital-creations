const express = require('express');
const { db, defaultSettings, getSetting } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/bootstrap', requireAuth, (req, res) => {
  const u = req.user;
  const users =
    u.role === 'Admin'
      ? db
          .prepare(
            'SELECT id,name,employee_code,role,department,designation,joining_date,employment_type,manager_id,phone,email,monthly_salary,monthly_target_tasks,monthly_target_hours,active FROM users ORDER BY name'
          )
          .all()
      : db.prepare('SELECT id,name,employee_code,role,department,designation,active FROM users WHERE active=1 ORDER BY name').all();
  const clients = db.prepare('SELECT * FROM clients ORDER BY name').all();
  const tasks =
    u.role === 'Admin'
      ? db
          .prepare(
            `SELECT t.*,u.name assignee_name,c.short_name client_short FROM tasks t JOIN users u ON u.id=t.assignee_id LEFT JOIN clients c ON c.id=t.client_id ORDER BY CASE t.status WHEN 'Blocked' THEN 1 WHEN 'In Progress' THEN 2 WHEN 'Not Started' THEN 3 ELSE 4 END,t.due_date`
          )
          .all()
      : db
          .prepare(
            `SELECT t.*,u.name assignee_name,c.short_name client_short FROM tasks t JOIN users u ON u.id=t.assignee_id LEFT JOIN clients c ON c.id=t.client_id WHERE t.assignee_id=? ORDER BY CASE t.status WHEN 'Blocked' THEN 1 WHEN 'In Progress' THEN 2 WHEN 'Not Started' THEN 3 ELSE 4 END,t.due_date`
          )
          .all(u.id);
  const leaves =
    u.role === 'Admin'
      ? db
          .prepare(
            `SELECT l.*,u.name user_name,u.employee_code FROM leave_requests l JOIN users u ON u.id=l.user_id ORDER BY CASE l.status WHEN 'Pending' THEN 1 ELSE 2 END,l.leave_date DESC`
          )
          .all()
      : db.prepare(`SELECT * FROM leave_requests WHERE user_id=? ORDER BY requested_at DESC`).all(u.id);
  const reports =
    u.role === 'Admin'
      ? db
          .prepare(
            `SELECT w.*,u.name user_name,t.title task_title,c.short_name client_short FROM work_reports w JOIN users u ON u.id=w.user_id LEFT JOIN tasks t ON t.id=w.task_id LEFT JOIN clients c ON c.id=w.client_id ORDER BY w.work_date DESC,w.created_at DESC LIMIT 200`
          )
          .all()
      : db
          .prepare(
            `SELECT w.*,t.title task_title,c.short_name client_short FROM work_reports w LEFT JOIN tasks t ON t.id=w.task_id LEFT JOIN clients c ON c.id=w.client_id WHERE w.user_id=? ORDER BY w.work_date DESC,w.created_at DESC LIMIT 100`
          )
          .all(u.id);
  const chats = db
    .prepare(`SELECT m.*,s.name sender_name,r.name receiver_name FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id WHERE m.sender_id=? OR m.receiver_id=? ORDER BY m.created_at DESC LIMIT 300`)
    .all(u.id, u.id);
  res.json({
    user: { id: u.id, name: u.name, employee_code: u.employee_code, role: u.role, department: u.department, designation: u.designation },
    users,
    clients,
    tasks,
    leaves,
    reports,
    chats,
    settings: Object.fromEntries(Object.keys(defaultSettings).map((k) => [k, getSetting(k, defaultSettings[k])])),
  });
});

module.exports = router;
