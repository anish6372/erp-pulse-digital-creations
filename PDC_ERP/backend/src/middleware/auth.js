const { db } = require('../db');
const { hash } = require('../utils/crypto');
const { now } = require('../utils/datetime');

function userBySession(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const tokenHash = hash(auth.slice(7));
  const r = db
    .prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`)
    .get(tokenHash, now());
  return r || null;
}

function requireAuth(req, res, next) {
  const u = userBySession(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  req.user = u;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

// For a module that's Admin's by default, but also opened up to specific departments
// (e.g. Leads for Digital Marketing) - compared case-insensitively, since department is
// a free-typed field on each employee's record, not a fixed enum.
function requireAdminOrDept(...departments) {
  const allowed = departments.map((d) => d.toLowerCase());
  return function (req, res, next) {
    requireAuth(req, res, () => {
      if (req.user.role === 'Admin' || allowed.includes(String(req.user.department || '').toLowerCase())) return next();
      res.status(403).json({ error: 'Not authorized' });
    });
  };
}

module.exports = { userBySession, requireAuth, requireAdmin, requireAdminOrDept };
