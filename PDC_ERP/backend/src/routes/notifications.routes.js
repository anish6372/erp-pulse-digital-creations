const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/notifications', requireAuth, (req, res) => {
  const u = req.user;
  const pending =
    u.role === 'Admin'
      ? db.prepare("SELECT l.id,l.leave_date,l.leave_type,l.reason,u.name FROM leave_requests l JOIN users u ON u.id=l.user_id WHERE l.status='Pending' ORDER BY l.requested_at DESC").all()
      : [];
  const rows = db.prepare('SELECT id,type,title,body,entity_type,entity_id,created_at,read_at FROM notifications WHERE recipient_id=? ORDER BY created_at DESC LIMIT 50').all(u.id);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE recipient_id=? AND read_at IS NULL').get(u.id).c;
  const unreadDirect = db.prepare('SELECT COUNT(*) c FROM messages WHERE receiver_id=? AND read_at IS NULL').get(u.id).c;
  const unreadGroup = db
    .prepare(
      `SELECT COALESCE(SUM(cnt),0) c FROM (
         SELECT (SELECT COUNT(*) FROM group_messages gm WHERE gm.group_id=m.group_id AND gm.id>COALESCE(r.last_read_message_id,0) AND gm.sender_id<>?) cnt
         FROM chat_group_members m LEFT JOIN group_message_reads r ON r.group_id=m.group_id AND r.user_id=m.user_id
         WHERE m.user_id=?
       )`
    )
    .get(u.id, u.id).c;
  const unreadMessages = unreadDirect + unreadGroup;
  res.json({ pending_leaves: pending, rows, unread_notifications: unread, unread_messages: unreadMessages, unread_total: unread });
});

router.put('/notifications/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL').run(now(), req.user.id);
  res.json({ ok: true });
});

router.put('/notifications/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const n = db.prepare('SELECT * FROM notifications WHERE id=? AND recipient_id=?').get(id, req.user.id);
  if (!n) return res.status(404).json({ error: 'Notification not found' });
  db.prepare('UPDATE notifications SET read_at=? WHERE id=?').run(now(), id);
  res.json({ ok: true });
});

module.exports = router;
