const express = require('express');
const { makeLimiter } = require('../utils/limiter');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { uid } = require('../utils/crypto');
const { audit } = require('../utils/audit');
const { notify, notifyAdmins } = require('../utils/notify');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// A reel moves left to right. "Client review" is the hand-off to the cafe owner, who answers through a private link.
const STAGES = ['Idea', 'Script', 'Shoot', 'Edit', 'Client review', 'Approved', 'Posted'];
const KINDS = ['Reel', 'Post', 'Carousel', 'Story'];

const itemSelect = `SELECT i.*, c.name client_name, c.short_name client_short, u.name assignee_name, creator.role creator_role
  FROM content_items i JOIN clients c ON c.id=i.client_id LEFT JOIN users u ON u.id=i.assignee_id LEFT JOIN users creator ON creator.id=i.created_by`;

// ---------- internal (signed-in) ----------

router.get('/content', requireAuth, (req, res) => {
  const u = req.user;
  const clientId = Number(req.query.client_id) || 0;
  const where = [];
  const args = [];
  if (u.role !== 'Admin') {
    // An employee only sees their own content (assigned to them or created by them) -
    // except anything an Admin created, which is visible to everyone, same as the Admin's
    // own view of the whole board.
    where.push("(i.assignee_id=? OR i.created_by=? OR creator.role='Admin')");
    args.push(u.id, u.id);
  }
  if (clientId) {
    where.push('i.client_id=?');
    args.push(clientId);
  }
  const rows = db.prepare(`${itemSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE WHEN i.scheduled_date='' THEN 1 ELSE 0 END, i.scheduled_date, i.id`).all(...args);
  res.json({ items: rows, stages: STAGES, kinds: KINDS });
});

router.post('/content', requireAuth, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const clientId = Number(b.client_id);
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (!clientId || !db.prepare('SELECT id FROM clients WHERE id=?').get(clientId)) return res.status(400).json({ error: 'Choose a client' });
  const stage = STAGES.includes(b.stage) ? b.stage : 'Idea';
  if (u.role !== 'Admin' && stage === 'Approved') return res.status(403).json({ error: 'Only the client or an admin can approve content' });
  const ts = now();
  const r = db
    .prepare(
      `INSERT INTO content_items(client_id,title,kind,stage,scheduled_date,assignee_id,script,caption,media_link,created_by,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      clientId,
      title,
      KINDS.includes(b.kind) ? b.kind : 'Reel',
      stage,
      b.scheduled_date || '',
      u.role === 'Admin' ? (b.assignee_id ? Number(b.assignee_id) : null) : u.id,
      b.script || '',
      b.caption || '',
      b.media_link || '',
      u.id,
      ts,
      ts
    );
  audit(u, 'CREATE', 'content_item', r.lastInsertRowid, title);
  res.status(201).json({ id: r.lastInsertRowid });
});

// ---------- AI assistant (captions, scripts, monthly ideas) ----------
// Generates drafts only - the browser shows them for a person to edit and save.
const { generateCaption, generateScript, generateIdeas } = require('../utils/contentAI');
const { usageSummary, isConfigured } = require('../utils/llm');
const aiLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, limit: 60, message: 'Too many AI requests this hour. Try again later.', prefix: 'content-ai' });

function aiItemFromBody(b) {
  const clientId = Number(b.client_id);
  const title = String(b.title || '').trim();
  if (!clientId) throw Object.assign(new Error('Choose a client first'), { status: 400 });
  if (!title) throw Object.assign(new Error('Add a title first so the AI knows what to write about'), { status: 400 });
  return { client_id: clientId, title, kind: KINDS.includes(b.kind) ? b.kind : 'Reel', script: String(b.script || ''), caption: String(b.caption || '') };
}
const aiFail = (res, e) => res.status(e.status || 500).json({ error: e.message || 'AI request failed' });

router.get('/content/ai/status', requireAuth, (req, res) => {
  res.json({ enabled: isConfigured(), ...(req.user.role === 'Admin' ? { usage: usageSummary() } : {}) });
});

router.post('/content/ai/caption', requireAuth, aiLimiter, async (req, res) => {
  try {
    res.json(await generateCaption({ item: aiItemFromBody(req.body || {}), userId: req.user.id }));
  } catch (e) {
    aiFail(res, e);
  }
});

router.post('/content/ai/script', requireAuth, aiLimiter, async (req, res) => {
  try {
    res.json(await generateScript({ item: aiItemFromBody(req.body || {}), userId: req.user.id }));
  } catch (e) {
    aiFail(res, e);
  }
});

router.post('/content/ai/ideas', requireAuth, aiLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const clientId = Number(b.client_id);
    if (!clientId) return res.status(400).json({ error: 'Choose a client first' });
    const month = /^\d{4}-\d{2}$/.test(b.month || '') ? b.month : now().slice(0, 7);
    const count = Math.min(Math.max(Number(b.count) || 8, 1), 15);
    res.json(await generateIdeas({ clientId, month, count, theme: String(b.theme || '').slice(0, 200), userId: req.user.id }));
  } catch (e) {
    aiFail(res, e);
  }
});

router.put('/content/:id', requireAuth, (req, res) => {
  const u = req.user;
  const id = Number(req.params.id);
  const e = db.prepare('SELECT * FROM content_items WHERE id=?').get(id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  if (u.role !== 'Admin' && e.assignee_id !== u.id && e.created_by !== u.id) return res.status(403).json({ error: 'This item is not assigned to you' });
  const b = req.body || {};
  const stage = b.stage === undefined ? e.stage : b.stage;
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Unknown stage' });
  if (u.role !== 'Admin' && stage === 'Approved' && e.stage !== 'Approved') return res.status(403).json({ error: 'Only the client or an admin can approve content' });
  db.prepare(
    `UPDATE content_items SET client_id=?,title=?,kind=?,stage=?,scheduled_date=?,assignee_id=?,script=?,caption=?,media_link=?,updated_at=? WHERE id=?`
  ).run(
    u.role === 'Admin' && b.client_id ? Number(b.client_id) : e.client_id,
    b.title ?? e.title,
    KINDS.includes(b.kind) ? b.kind : e.kind,
    stage,
    b.scheduled_date ?? e.scheduled_date,
    u.role === 'Admin' && b.assignee_id !== undefined ? (b.assignee_id ? Number(b.assignee_id) : null) : e.assignee_id,
    b.script ?? e.script,
    b.caption ?? e.caption,
    b.media_link ?? e.media_link,
    now(),
    id
  );
  if (stage === 'Client review' && e.stage !== 'Client review') notifyAdmins('content_review', 'Sent for client review', `"${e.title}" is waiting for the client's answer.`, 'content_item', id);
  audit(u, 'UPDATE', 'content_item', id, stage !== e.stage ? `${e.stage} -> ${stage}` : '');
  res.json({ ok: true });
});

router.delete('/content/:id', requireAuth, (req, res) => {
  const u = req.user;
  const id = Number(req.params.id);
  const item = db.prepare('SELECT * FROM content_items WHERE id=?').get(id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (u.role !== 'Admin' && item.created_by !== u.id) return res.status(403).json({ error: 'Only an Admin or the person who created this can delete it' });
  db.prepare('DELETE FROM content_items WHERE id=?').run(id);
  audit(u, 'DELETE', 'content_item', id, item.title);
  res.json({ ok: true });
});

// The private link a cafe owner uses to approve or comment. One stable link per client.
function reviewUrl(token) {
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/#/review/${token}`;
}

router.get('/content/review-link/:clientId', requireAdmin, (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!db.prepare('SELECT id FROM clients WHERE id=?').get(clientId)) return res.status(404).json({ error: 'Client not found' });
  let row = db.prepare('SELECT * FROM client_review_links WHERE client_id=?').get(clientId);
  if (!row) {
    db.prepare('INSERT INTO client_review_links(client_id,token,created_at) VALUES(?,?,?)').run(clientId, uid(), now());
    row = db.prepare('SELECT * FROM client_review_links WHERE client_id=?').get(clientId);
  }
  res.json({ url: reviewUrl(row.token), last_viewed_at: row.last_viewed_at });
});

// Replace the link if it was shared by mistake. The old one stops working at once.
router.post('/content/review-link/:clientId/regenerate', requireAdmin, (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!db.prepare('SELECT id FROM clients WHERE id=?').get(clientId)) return res.status(404).json({ error: 'Client not found' });
  db.prepare(
    `INSERT INTO client_review_links(client_id,token,created_at) VALUES(?,?,?)
     ON CONFLICT(client_id) DO UPDATE SET token=excluded.token, created_at=excluded.created_at, last_viewed_at=''`
  ).run(clientId, uid(), now());
  audit(req.user, 'REGENERATE', 'client_review_link', clientId);
  res.json({ url: reviewUrl(db.prepare('SELECT token FROM client_review_links WHERE client_id=?').get(clientId).token) });
});

// ---------- public (no login): the client's review page ----------

const publicLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 120, message: 'Too many requests. Please try again later.', prefix: 'content-publicLimiter' });

function linkFor(token) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(String(token))) return null;
  return db.prepare('SELECT l.*, c.name client_name FROM client_review_links l JOIN clients c ON c.id=l.client_id WHERE l.token=? AND c.active=1').get(token) || null;
}

router.get('/review/public/:token', publicLimiter, (req, res) => {
  const link = linkFor(req.params.token);
  if (!link) return res.status(404).json({ error: 'This review link is not valid any more.' });
  db.prepare('UPDATE client_review_links SET last_viewed_at=? WHERE client_id=?').run(now(), link.client_id);
  const items = db
    .prepare(
      `SELECT id,title,kind,scheduled_date,script,caption,media_link,stage,review_note,reviewed_by,reviewed_at
       FROM content_items WHERE client_id=? AND (stage='Client review' OR (stage IN ('Approved','Posted') AND updated_at>=?))
       ORDER BY CASE stage WHEN 'Client review' THEN 0 ELSE 1 END, scheduled_date, id`
    )
    .all(link.client_id, new Date(Date.now() - 45 * 864e5).toISOString());
  res.json({ client: link.client_name, items });
});

router.post('/review/public/:token/items/:id/decision', publicLimiter, (req, res) => {
  const link = linkFor(req.params.token);
  if (!link) return res.status(404).json({ error: 'This review link is not valid any more.' });
  const id = Number(req.params.id);
  const item = db.prepare('SELECT * FROM content_items WHERE id=? AND client_id=?').get(id, link.client_id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.stage !== 'Client review') return res.status(409).json({ error: 'This item is no longer waiting for review.' });
  const b = req.body || {};
  const who = String(b.reviewer_name || '').trim().slice(0, 80);
  const note = String(b.note || '').trim().slice(0, 800);
  if (!who) return res.status(400).json({ error: 'Please enter your name' });
  const approve = b.decision === 'approve';
  if (!approve && b.decision !== 'changes') return res.status(400).json({ error: 'Choose approve or request changes' });
  if (!approve && !note) return res.status(400).json({ error: 'Tell us what to change' });
  db.prepare('UPDATE content_items SET stage=?, review_note=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?').run(
    approve ? 'Approved' : 'Edit',
    note,
    who,
    now(),
    now(),
    id
  );
  const msg = approve ? `${who} approved "${item.title}" for ${link.client_name}.` : `${who} asked for changes on "${item.title}": ${note}`;
  notifyAdmins(approve ? 'content_approved' : 'content_changes', approve ? 'Client approved a reel' : 'Client asked for changes', msg, 'content_item', id);
  if (item.assignee_id) notify(item.assignee_id, approve ? 'content_approved' : 'content_changes', approve ? 'Client approved your work' : 'Client asked for changes', msg, 'content_item', id);
  audit(null, approve ? 'CLIENT_APPROVE' : 'CLIENT_CHANGES', 'content_item', id, who);
  res.json({ ok: true });
});

module.exports = router;
