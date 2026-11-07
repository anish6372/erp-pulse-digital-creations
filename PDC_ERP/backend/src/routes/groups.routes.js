const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { notify } = require('../utils/notify');
const { requireAuth } = require('../middleware/auth');
const { getIO } = require('../realtime/io');

const router = express.Router();

function isMember(groupId, userId) {
  return !!db.prepare('SELECT 1 FROM chat_group_members WHERE group_id=? AND user_id=?').get(groupId, userId);
}

router.get('/chat/groups', requireAuth, (req, res) => {
  const u = req.user;
  const groups = db
    .prepare(
      `SELECT g.id, g.name, g.created_by, g.created_at
       FROM chat_groups g JOIN chat_group_members m ON m.group_id=g.id
       WHERE m.user_id=? ORDER BY g.created_at DESC`
    )
    .all(u.id);
  const out = groups.map((g) => {
    const members = db
      .prepare(`SELECT u.id, u.name, u.role FROM chat_group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY u.name`)
      .all(g.id);
    const lastMsg = db.prepare('SELECT body, created_at FROM group_messages WHERE group_id=? ORDER BY id DESC LIMIT 1').get(g.id);
    const readRow = db.prepare('SELECT last_read_message_id FROM group_message_reads WHERE group_id=? AND user_id=?').get(g.id, u.id);
    const lastReadId = readRow ? readRow.last_read_message_id : 0;
    const unread = db.prepare('SELECT COUNT(*) c FROM group_messages WHERE group_id=? AND id>? AND sender_id<>?').get(g.id, lastReadId, u.id).c;
    return { ...g, members, last_message: lastMsg?.body || '', last_message_at: lastMsg?.created_at || g.created_at, unread };
  });
  res.json({ groups: out });
});

router.post('/chat/groups', requireAuth, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  const memberIds = Array.isArray(b.member_ids) ? [...new Set(b.member_ids.map(Number).filter((x) => x && x !== u.id))] : [];
  if (memberIds.length === 0) return res.status(400).json({ error: 'Select at least one other member' });
  const validMembers = db
    .prepare(`SELECT id, name FROM users WHERE active=1 AND id IN (${memberIds.map(() => '?').join(',')})`)
    .all(...memberIds);
  if (validMembers.length === 0) return res.status(400).json({ error: 'No valid members selected' });

  const ts = now();
  const r = db.prepare('INSERT INTO chat_groups(name, created_by, created_at) VALUES(?,?,?)').run(name, u.id, ts);
  const groupId = Number(r.lastInsertRowid);
  const insMember = db.prepare('INSERT INTO chat_group_members(group_id, user_id, joined_at) VALUES(?,?,?)');
  insMember.run(groupId, u.id, ts);
  for (const m of validMembers) {
    insMember.run(groupId, m.id, ts);
    notify(m.id, 'group_added', 'Added to a group', `${u.name} added you to "${name}".`, 'chat_group', groupId, `group_added:${groupId}:${m.id}`);
  }
  const io = getIO();
  if (io) {
    for (const m of validMembers) io.to('user:' + m.id).emit('group:created', { id: groupId, name });
  }
  res.status(201).json({ id: groupId });
});

router.post('/chat/groups/:id/members', requireAuth, (req, res) => {
  const u = req.user;
  const groupId = Number(req.params.id);
  if (!isMember(groupId, u.id)) return res.status(403).json({ error: 'You are not a member of this group' });
  const group = db.prepare('SELECT * FROM chat_groups WHERE id=?').get(groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const b = req.body || {};
  const memberIds = Array.isArray(b.member_ids) ? [...new Set(b.member_ids.map(Number))] : [];
  const ts = now();
  const insMember = db.prepare('INSERT OR IGNORE INTO chat_group_members(group_id, user_id, joined_at) VALUES(?,?,?)');
  const added = [];
  for (const id of memberIds) {
    const target = db.prepare('SELECT id, name FROM users WHERE id=? AND active=1').get(id);
    if (!target || isMember(groupId, id)) continue;
    insMember.run(groupId, id, ts);
    notify(id, 'group_added', 'Added to a group', `${u.name} added you to "${group.name}".`, 'chat_group', groupId, `group_added:${groupId}:${id}`);
    added.push(target);
  }
  const io = getIO();
  if (io) for (const t of added) io.to('user:' + t.id).emit('group:created', { id: groupId, name: group.name });
  res.json({ ok: true, added: added.length });
});

router.get('/chat/groups/:id/messages', requireAuth, (req, res) => {
  const u = req.user;
  const groupId = Number(req.params.id);
  if (!isMember(groupId, u.id)) return res.status(403).json({ error: 'You are not a member of this group' });
  const group = db.prepare('SELECT * FROM chat_groups WHERE id=?').get(groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const members = db
    .prepare(`SELECT u.id, u.name, u.role FROM chat_group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY u.name`)
    .all(groupId);
  const messages = db
    .prepare(`SELECT gm.*, u.name sender_name FROM group_messages gm JOIN users u ON u.id=gm.sender_id WHERE gm.group_id=? ORDER BY gm.created_at`)
    .all(groupId);
  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  db.prepare(
    `INSERT INTO group_message_reads(group_id, user_id, last_read_message_id) VALUES(?,?,?)
     ON CONFLICT(group_id, user_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id`
  ).run(groupId, u.id, lastId);
  res.json({ group, members, messages });
});

router.post('/chat/groups/:id/messages', requireAuth, (req, res) => {
  const u = req.user;
  const groupId = Number(req.params.id);
  if (!isMember(groupId, u.id)) return res.status(403).json({ error: 'You are not a member of this group' });
  const body = String((req.body || {}).body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message empty' });
  const ts = now();
  const r = db.prepare('INSERT INTO group_messages(group_id, sender_id, body, created_at) VALUES(?,?,?,?)').run(groupId, u.id, body, ts);
  db.prepare(
    `INSERT INTO group_message_reads(group_id, user_id, last_read_message_id) VALUES(?,?,?)
     ON CONFLICT(group_id, user_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id`
  ).run(groupId, u.id, r.lastInsertRowid);

  const group = db.prepare('SELECT name FROM chat_groups WHERE id=?').get(groupId);
  const members = db.prepare('SELECT user_id FROM chat_group_members WHERE group_id=? AND user_id<>?').all(groupId, u.id);
  for (const m of members) notify(m.user_id, 'group_message', `New message in ${group.name}`, `${u.name}: ${body.slice(0, 100)}`, 'chat_group', groupId, `group_message:${r.lastInsertRowid}:${m.user_id}`);

  const payload = { id: r.lastInsertRowid, group_id: groupId, sender_id: u.id, sender_name: u.name, body, created_at: ts };
  const io = getIO();
  if (io) io.to('group:' + groupId).emit('group:message:new', payload);
  res.status(201).json({ id: r.lastInsertRowid });
});

module.exports = router;
