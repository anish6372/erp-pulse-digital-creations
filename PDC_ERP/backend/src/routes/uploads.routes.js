const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { audit } = require('../utils/audit');
const { requireAuth } = require('../middleware/auth');

const UPLOADS = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.mp4', '.mov', '.zip']);
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'video/mp4',
  'video/quicktime',
  'application/zip',
]);

const router = express.Router();

router.post('/uploads', requireAuth, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || 'file');
  const data = String(b.data || '');
  if (!data.startsWith('data:')) return res.status(400).json({ error: 'Invalid file payload' });
  const m = data.match(/^data:([^;]+);base64,(.*)$/s);
  if (!m) return res.status(400).json({ error: 'Invalid data URL' });
  const mime = m[1];
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_MIME.has(mime) || !ALLOWED_EXT.has(ext)) return res.status(400).json({ error: 'File type not allowed' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 10 * 1024 * 1024) return res.status(400).json({ error: 'File too large (10 MB max)' });
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safe}`;
  fs.writeFileSync(path.join(UPLOADS, filename), buf);
  audit(req.user, 'UPLOAD', 'file', null, name);
  res.status(201).json({ name, url: `/uploads/${filename}` });
});

module.exports = { router, UPLOADS };
