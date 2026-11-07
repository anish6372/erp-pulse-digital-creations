const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/datetime');
const { notify } = require('../utils/notify');
const { audit } = require('../utils/audit');
const { sendMail } = require('../utils/mailer');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function meetingEmailHtml({ title, description, hostName, scheduledAt, durationMinutes, link, cancelled }) {
  const when = new Date(scheduledAt).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
  if (cancelled) {
    return `<div style="font-family:Arial,sans-serif;max-width:480px">
      <h2 style="margin:0 0 8px">Meeting cancelled</h2>
      <p><b>${title}</b>, originally scheduled for ${when}, has been cancelled by ${hostName}.</p>
    </div>`;
  }
  return `<div style="font-family:Arial,sans-serif;max-width:480px">
    <h2 style="margin:0 0 8px">${title}</h2>
    <p style="color:#555">${description || 'No description provided.'}</p>
    <p><b>When:</b> ${when} (${durationMinutes} min)<br/><b>Host:</b> ${hostName}</p>
    <p style="margin-top:16px"><a href="${link}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Join meeting</a></p>
    <p style="color:#888;font-size:12px">${link}</p>
  </div>`;
}

function emailsFor(userIds) {
  if (!userIds.length) return [];
  const rows = db.prepare(`SELECT email FROM users WHERE id IN (${userIds.map(() => '?').join(',')}) AND email<>''`).all(...userIds);
  return rows.map((r) => r.email);
}

router.get('/meetings', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.*, u.name host_name FROM meetings m JOIN users u ON u.id=m.created_by
       WHERE m.status<>'Cancelled' ORDER BY m.scheduled_at ASC`
    )
    .all();
  res.json({ meetings: rows });
});

router.post('/meetings', requireAdmin, (req, res) => {
  const admin = req.user;
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const link = String(b.meeting_link || '').trim();
  const scheduledAt = String(b.scheduled_at || '').trim();
  if (!title) return res.status(400).json({ error: 'Meeting title is required' });
  if (!/^https?:\/\//i.test(link)) return res.status(400).json({ error: 'A valid meeting link (https://...) is required' });
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) return res.status(400).json({ error: 'A valid date/time is required' });
  const duration = Math.max(5, Number(b.duration_minutes || 30));
  const ts = now();
  const r = db
    .prepare('INSERT INTO meetings(title,description,meeting_link,scheduled_at,duration_minutes,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(title, b.description || '', link, scheduledAt, duration, 'Scheduled', admin.id, ts, ts);
  const meetingId = Number(r.lastInsertRowid);

  const others = db.prepare('SELECT id FROM users WHERE active=1 AND id<>?').all(admin.id);
  for (const o of others)
    notify(
      o.id,
      'meeting_scheduled',
      'New meeting scheduled',
      `${admin.name} scheduled "${title}" for ${new Date(scheduledAt).toLocaleString('en-IN')}.`,
      'meeting',
      meetingId,
      `meeting_scheduled:${meetingId}:${o.id}`
    );
  audit(admin, 'CREATE', 'meeting', meetingId, title);

  const recipients = emailsFor(others.map((o) => o.id));
  sendMail({
    to: recipients,
    subject: `New meeting: ${title}`,
    html: meetingEmailHtml({ title, description: b.description, hostName: admin.name, scheduledAt, durationMinutes: duration, link }),
  });

  res.status(201).json({ id: meetingId });
});

router.put('/meetings/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM meetings WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Meeting not found' });
  const b = req.body || {};
  if (b.meeting_link && !/^https?:\/\//i.test(String(b.meeting_link))) return res.status(400).json({ error: 'A valid meeting link (https://...) is required' });
  if (b.scheduled_at && Number.isNaN(Date.parse(b.scheduled_at))) return res.status(400).json({ error: 'A valid date/time is required' });
  db.prepare('UPDATE meetings SET title=?,description=?,meeting_link=?,scheduled_at=?,duration_minutes=?,status=?,updated_at=? WHERE id=?').run(
    b.title ?? existing.title,
    b.description ?? existing.description,
    b.meeting_link ?? existing.meeting_link,
    b.scheduled_at ?? existing.scheduled_at,
    b.duration_minutes ?? existing.duration_minutes,
    b.status ?? existing.status,
    now(),
    id
  );
  if (b.status === 'Cancelled' && existing.status !== 'Cancelled') {
    const others = db.prepare('SELECT id FROM users WHERE active=1 AND id<>?').all(admin.id);
    for (const o of others) notify(o.id, 'meeting_cancelled', 'Meeting cancelled', `"${existing.title}" has been cancelled.`, 'meeting', id, `meeting_cancelled:${id}:${o.id}`);
    const recipients = emailsFor(others.map((o) => o.id));
    sendMail({
      to: recipients,
      subject: `Cancelled: ${existing.title}`,
      html: meetingEmailHtml({ title: existing.title, hostName: admin.name, scheduledAt: existing.scheduled_at, cancelled: true }),
    });
  }
  audit(admin, 'UPDATE', 'meeting', id);
  res.json({ ok: true });
});

router.delete('/meetings/:id', requireAdmin, (req, res) => {
  const admin = req.user;
  const id = Number(req.params.id);
  db.prepare('DELETE FROM meetings WHERE id=?').run(id);
  audit(admin, 'DELETE', 'meeting', id);
  res.json({ ok: true });
});

module.exports = router;
