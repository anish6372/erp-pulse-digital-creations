const express = require('express');
const { db } = require('../db');
const { now, today } = require('../utils/datetime');
const { audit } = require('../utils/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/work/toggle', requireAuth, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const isOn = !!b.on;
  if (isOn && b.task_id && u.role !== 'Admin') {
    const owned = db.prepare('SELECT id FROM tasks WHERE id=? AND assignee_id=?').get(Number(b.task_id), u.id);
    if (!owned) return res.status(403).json({ error: 'Task is not assigned to you' });
  }
  const open = db.prepare('SELECT * FROM work_sessions WHERE user_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(u.id);
  if (isOn) {
    if (open) return res.status(400).json({ error: 'Work session already ON' });
    db.prepare('INSERT INTO work_sessions(user_id,task_id,started_at) VALUES(?,?,?)').run(u.id, b.task_id || null, now());
    audit(u, 'WORK_ON', 'work_session', null, String(b.task_id || ''));
    return res.json({ ok: true, status: 'ON' });
  }
  if (!open) return res.status(400).json({ error: 'No active work session' });
  db.prepare('UPDATE work_sessions SET ended_at=? WHERE id=?').run(now(), open.id);
  audit(u, 'WORK_OFF', 'work_session', open.id);
  res.json({ ok: true, status: 'OFF' });
});

router.get('/work/status', requireAuth, (req, res) => {
  const u = req.user;
  const target = u.role === 'Admin' && req.query.user_id ? Number(req.query.user_id) : u.id;
  const open = db.prepare(`SELECT ws.*,t.title task_title FROM work_sessions ws LEFT JOIN tasks t ON t.id=ws.task_id WHERE ws.user_id=? AND ws.ended_at IS NULL ORDER BY ws.started_at DESC LIMIT 1`).get(target);
  res.json({ on: !!open, session: open || null });
});

router.get('/work/time', requireAuth, (req, res) => {
  const u = req.user;
  const month = req.query.month || today().slice(0, 7);
  const target = u.role === 'Admin' ? (req.query.user_id ? Number(req.query.user_id) : null) : u.id;
  const q = target
    ? db.prepare(`SELECT user_id,COALESCE(SUM((julianday(COALESCE(ended_at,datetime('now')))-julianday(started_at))*24),0) h FROM work_sessions WHERE user_id=? AND substr(started_at,1,7)=? GROUP BY user_id`)
    : db.prepare(`SELECT user_id,COALESCE(SUM((julianday(COALESCE(ended_at,datetime('now')))-julianday(started_at))*24),0) h FROM work_sessions WHERE substr(started_at,1,7)=? GROUP BY user_id`);
  res.json({ month, data: target ? q.all(target, month) : q.all(month) });
});

module.exports = router;
