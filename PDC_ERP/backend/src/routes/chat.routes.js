const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { notify } = require('../utils/notify');
const { requireAuth } = require('../middleware/auth');
const { getIO } = require('../realtime/io');

const router = express.Router();

router.get('/chat/unread', requireAuth, (req, res) => {
  const u = req.user;
  const rows = db.prepare('SELECT sender_id, COUNT(*) c FROM messages WHERE receiver_id=? AND read_at IS NULL GROUP BY sender_id').all(u.id);
  const counts = {};
  rows.forEach((r) => (counts[r.sender_id] = r.c));
  res.json({ counts });
});

router.get('/chat', requireAuth, (req, res) => {
  const u = req.user;
  const withId = Number(req.query.with_id);
  if (!withId) return res.status(400).json({ error: 'with_id required' });
  const other = db.prepare('SELECT id,name,role FROM users WHERE id=?').get(withId);
  if (!other) return res.status(404).json({ error: 'User not found' });
  const msgs = db
    .prepare(`SELECT m.*,s.name sender_name,r.name receiver_name FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at`)
    .all(u.id, withId, withId, u.id);
  const ts = now();
  const r = db.prepare('UPDATE messages SET read_at=? WHERE sender_id=? AND receiver_id=? AND read_at IS NULL').run(ts, withId, u.id);
  // Tell the sender live, if they're online, so an already-open conversation on their
  // side flips from "Sent" to "Seen" without them needing to do anything - same as the
  // double-tick behavior in WhatsApp.
  if (r.changes > 0) {
    const io = getIO();
    if (io) io.to('user:' + withId).emit('messages:read', { by: u.id, at: ts });
  }
  res.json({ user: other, messages: msgs });
});

router.post('/chat', requireAuth, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const receiver = Number(b.receiver_id);
  const receiverRow = db.prepare('SELECT id, name FROM users WHERE id=? AND active=1').get(receiver);
  if (!receiverRow) return res.status(404).json({ error: 'Receiver not found' });
  const body = String(b.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message empty' });
  const ts = now();
  const r = db.prepare('INSERT INTO messages(sender_id,receiver_id,body,created_at) VALUES(?,?,?,?)').run(u.id, receiver, body, ts);
  // entity_id is the sender's user id, not the message id - that's what the notification
  // needs to carry to open the right conversation when clicked; the message id is still
  // unique per dedupe_key, which is all it was really needed for.
  notify(receiver, 'chat_message', `New message from ${u.name}`, body.slice(0, 120), 'user', u.id, `chat_message:${r.lastInsertRowid}`);
  const payload = { id: r.lastInsertRowid, sender_id: u.id, receiver_id: receiver, body, created_at: ts, read_at: null, sender_name: u.name, receiver_name: receiverRow.name };
  const io = getIO();
  if (io) io.to('user:' + receiver).to('user:' + u.id).emit('message:new', payload);
  res.status(201).json({ id: r.lastInsertRowid });
});

module.exports = router;
