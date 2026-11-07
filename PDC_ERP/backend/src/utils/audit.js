const { db } = require('../db');
const { now } = require('./datetime');

function audit(actor, action, type, id, meta = '') {
  db.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,meta,created_at) VALUES(?,?,?,?,?,?)').run(
    actor?.id || null,
    action,
    type,
    id,
    meta,
    now()
  );
}

module.exports = { audit };
