const { db } = require('../db');
const { now } = require('./datetime');

function notify(recipientId, type, title, body, entityType = '', entityId = null, dedupeKey = '') {
  const existing = dedupeKey
    ? db.prepare('SELECT id FROM notifications WHERE recipient_id=? AND dedupe_key=?').get(recipientId, dedupeKey)
    : null;
  if (existing) return existing.id;
  const r = db
    .prepare('INSERT INTO notifications(recipient_id,type,title,body,entity_type,entity_id,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(recipientId, type, title, body, entityType, entityId, dedupeKey, now());
  return r.lastInsertRowid;
}

function notifyAdmins(type, title, body, entityType = '', entityId = null, dedupeKey = '') {
  const admins = db.prepare("SELECT id FROM users WHERE role='Admin' AND active=1").all();
  for (const a of admins) notify(a.id, type, title, body, entityType, entityId, dedupeKey ? `${dedupeKey}:admin:${a.id}` : '');
}

module.exports = { notify, notifyAdmins };
