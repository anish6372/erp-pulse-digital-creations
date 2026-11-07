const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, getSetting, setSetting } = require('../db');
const { uid, hash, passwordHash } = require('../utils/crypto');
const { now, today } = require('../utils/datetime');
const { audit } = require('../utils/audit');
const { notifyAdmins } = require('../utils/notify');
const { sendMail } = require('../utils/mailer');
const { isValidAadhaar } = require('../utils/aadhaar');
const { generateEmployeeCode } = require('../utils/employeeCode');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Identity documents live OUTSIDE /uploads (which is served publicly with no auth).
// They are only ever streamed back through the admin-only file endpoint below.
const PRIVATE_DIR = path.join(__dirname, '..', '..', 'private', 'onboarding');
fs.mkdirSync(PRIVATE_DIR, { recursive: true });

const COMPANY = 'Pulse Digital Creation';
const INVITE_DAYS = 7;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const OPEN_STATUSES = ['Invited', 'In Progress', 'Changes Requested'];

const FILE_COLUMNS = {
  aadhaar_front: 'aadhaar_front_path',
  aadhaar_back: 'aadhaar_back_path',
  selfie: 'selfie_path',
  signature: 'nda_signature_path',
};

const DEFAULT_NDA = `NON-DISCLOSURE AND CONFIDENTIALITY AGREEMENT

This Agreement is made on {{date}} between {{company}} ("the Company") and {{name}} ("the Employee"), who is joining as {{designation}}.

1. Confidential Information
"Confidential Information" means all non-public information the Employee receives or creates in the course of employment, including client lists, brand strategies, campaign plans, unpublished creative work, raw footage and project files, login credentials, pricing, financial and payroll data, and any information the Company holds about its clients or staff.

2. Obligations
The Employee shall (a) keep Confidential Information strictly confidential, (b) use it only to perform duties for the Company, (c) not copy, share, publish or post it - including on personal drives, social media or messaging apps - without written approval, and (d) follow the Company's access and security instructions.

3. Client Work and Intellectual Property
All work created for the Company or its clients during employment (including designs, videos, edits, scripts, captions and source files) belongs to the Company or the relevant client. The Employee will not reuse it for personal portfolio or third-party purposes without written permission.

4. Return of Materials
On request or when employment ends, the Employee shall return or permanently delete all Company and client material in their possession and confirm this in writing.

5. Duration
These obligations continue during employment and for three (3) years after it ends. Obligations regarding client data and trade secrets continue for as long as the information remains confidential.

6. Exceptions
This Agreement does not apply to information that is public through no fault of the Employee, or that the Employee is legally required to disclose (in which case the Company must be told promptly).

7. Remedies
The Employee understands that breach may cause serious harm to the Company and its clients, and that the Company may seek injunctive relief, damages and disciplinary action, in addition to any other remedy available in law.

8. Governing Law
This Agreement is governed by the laws of India.

By signing below, the Employee confirms they have read, understood and agree to this Agreement.`;

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// ---------- helpers ----------

function getNdaTemplate() {
  return getSetting('nda_template', '') || DEFAULT_NDA;
}

function renderNda(template, o) {
  const map = {
    name: o.full_name,
    company: COMPANY,
    designation: o.designation || 'a team member',
    date: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in map ? map[k] : m));
}

function newToken() {
  const token = uid();
  return { token, token_hash: hash(token), expires: new Date(Date.now() + INVITE_DAYS * 864e5).toISOString() };
}

function inviteLink(token) {
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/#/onboard/${token}`;
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sendInviteEmail(o, token) {
  if (!o.email) return;
  const link = inviteLink(token);
  sendMail({
    to: o.email,
    subject: `Welcome to ${COMPANY} - complete your onboarding`,
    text: `Hi ${o.full_name},\n\nWelcome to ${COMPANY}! Please complete your joining formalities (ID verification, selfie and NDA) here:\n${link}\n\nThis link is personal to you and expires on ${o.token_expires_at.slice(0, 10)}. Do not share it.\n`,
    html: `<p>Hi ${escHtml(o.full_name)},</p><p>Welcome to <b>${COMPANY}</b>! Please complete your joining formalities (ID verification, selfie and NDA):</p><p><a href="${link}">Start onboarding</a></p><p style="color:#667085;font-size:12px">This link is personal to you and expires on ${o.token_expires_at.slice(0, 10)}. Do not share it.</p>`,
  });
}

// Parses a data URL, checks it is really a JPEG/PNG (magic bytes, not just the claimed MIME) and size-limits it.
function decodeImage(dataUrl, label) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, `${label}: a JPEG or PNG image is required.`);
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(400, `${label} is too large (max 3 MB).`);
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.length > 8 && buf.subarray(1, 4).toString('ascii') === 'PNG';
  if (!isJpeg && !isPng) throw new HttpError(400, `${label} is not a valid image.`);
  return { buf, ext: isPng ? '.png' : '.jpg' };
}

function saveImage(onboardingId, kind, dataUrl, label) {
  const { buf, ext } = decodeImage(dataUrl, label);
  const dir = path.join(PRIVATE_DIR, String(onboardingId));
  fs.mkdirSync(dir, { recursive: true });
  const rel = path.join(String(onboardingId), `${kind}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  fs.writeFileSync(path.join(PRIVATE_DIR, rel), buf);
  return rel;
}

function removeFile(rel) {
  if (!rel) return;
  const full = path.resolve(PRIVATE_DIR, rel);
  if (!full.startsWith(PRIVATE_DIR + path.sep)) return;
  try {
    fs.unlinkSync(full);
  } catch (e) {
    /* already gone */
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function wrap(fn) {
  return (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  };
}

function checklist(o) {
  return {
    invited: true,
    opened: !!o.opened_at,
    details: !!(o.dob && o.address),
    aadhaar: !!(o.aadhaar_last4 && (o.aadhaar_front_path || o.status === 'Approved')),
    face: o.face_match === 1 ? 'match' : o.face_match === 0 ? 'review' : o.selfie_path ? 'review' : 'pending',
    nda: !!o.nda_signed_at,
    approved: o.status === 'Approved',
  };
}

// Never leaks token_hash or on-disk paths.
function publicShape(o) {
  return {
    id: o.id,
    full_name: o.full_name,
    email: o.email,
    phone: o.phone,
    department: o.department,
    designation: o.designation,
    joining_date: o.joining_date,
    employment_type: o.employment_type,
    monthly_salary: o.monthly_salary,
    status: o.status,
    dob: o.dob,
    address: o.address,
    emergency_name: o.emergency_name,
    emergency_phone: o.emergency_phone,
    aadhaar_masked: o.aadhaar_last4 ? `XXXX XXXX ${o.aadhaar_last4}` : '',
    has_aadhaar_front: !!o.aadhaar_front_path,
    has_aadhaar_back: !!o.aadhaar_back_path,
    has_selfie: !!o.selfie_path,
    has_signature: !!o.nda_signature_path,
    face_score: o.face_score,
    face_match: o.face_match,
    consent_at: o.consent_at,
    nda_signed_name: o.nda_signed_name,
    nda_signed_at: o.nda_signed_at,
    nda_text_hash: o.nda_text_hash,
    token_expires_at: o.token_expires_at,
    opened_at: o.opened_at,
    submitted_at: o.submitted_at,
    reviewed_at: o.reviewed_at,
    review_note: o.review_note,
    user_id: o.user_id,
    created_at: o.created_at,
    checklist: checklist(o),
  };
}

// ====================================================================
// PUBLIC (token) endpoints - used by the new joiner, no login required
// ====================================================================

function byToken(token) {
  const o = db.prepare('SELECT * FROM onboardings WHERE token_hash=?').get(hash(String(token || '')));
  if (!o) throw new HttpError(404, 'This onboarding link is not valid.');
  if (o.token_expires_at < now()) throw new HttpError(410, 'This onboarding link has expired. Please ask HR for a new one.');
  return o;
}

router.get(
  '/onboarding/public/:token',
  publicLimiter,
  wrap((req, res) => {
    const o = byToken(req.params.token);
    if (o.status === 'Invited') {
      db.prepare("UPDATE onboardings SET status='In Progress', opened_at=?, updated_at=? WHERE id=?").run(now(), now(), o.id);
      o.status = 'In Progress';
    }
    res.json({
      full_name: o.full_name,
      company: COMPANY,
      status: o.status,
      can_submit: OPEN_STATUSES.includes(o.status),
      note: o.status === 'Changes Requested' ? o.review_note : '',
      expires_at: o.token_expires_at,
      prefill: { phone: o.phone, email: o.email },
      nda_text: renderNda(getNdaTemplate(), o),
    });
  })
);

router.post(
  '/onboarding/public/:token/submit',
  publicLimiter,
  wrap((req, res) => {
    const o = byToken(req.params.token);
    if (!OPEN_STATUSES.includes(o.status)) throw new HttpError(409, 'This onboarding has already been submitted.');
    const b = req.body || {};

    const text = (v, max = 300) => String(v || '').trim().slice(0, max);
    const phone = text(b.phone, 20);
    const dob = text(b.dob, 10);
    const address = text(b.address, 500);
    const signedName = text(b.signed_name, 120);
    const aadhaar = String(b.aadhaar_number || '').replace(/[\s-]/g, '');

    if (b.consent !== true) throw new HttpError(400, 'Please give your consent to the processing of your ID documents.');
    if (!phone) throw new HttpError(400, 'Phone number is required.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob >= today()) throw new HttpError(400, 'A valid date of birth is required.');
    if (!address) throw new HttpError(400, 'Address is required.');
    if (!isValidAadhaar(aadhaar)) throw new HttpError(400, 'That Aadhaar number does not look valid. Please check the 12 digits.');
    if (!b.aadhaar_front) throw new HttpError(400, 'Please upload the front of your Aadhaar card.');
    if (!b.selfie) throw new HttpError(400, 'Please take a selfie.');
    if (b.nda_accepted !== true) throw new HttpError(400, 'You must accept the NDA to continue.');
    if (signedName.length < 2) throw new HttpError(400, 'Please type your full name to sign the NDA.');
    if (!b.signature) throw new HttpError(400, 'Please draw your signature.');

    // Validate everything before touching disk, so a bad payload leaves no orphan files.
    decodeImage(b.aadhaar_front, 'Aadhaar front');
    if (b.aadhaar_back) decodeImage(b.aadhaar_back, 'Aadhaar back');
    decodeImage(b.selfie, 'Selfie');
    decodeImage(b.signature, 'Signature');

    // On a re-submission after "Changes Requested", replace the earlier files.
    for (const col of Object.values(FILE_COLUMNS)) removeFile(o[col]);

    const front = saveImage(o.id, 'aadhaar_front', b.aadhaar_front, 'Aadhaar front');
    const back = b.aadhaar_back ? saveImage(o.id, 'aadhaar_back', b.aadhaar_back, 'Aadhaar back') : '';
    const selfie = saveImage(o.id, 'selfie', b.selfie, 'Selfie');
    const sig = saveImage(o.id, 'signature', b.signature, 'Signature');

    const ndaText = renderNda(getNdaTemplate(), o);
    const score = Number.isFinite(Number(b.face_score)) ? Number(b.face_score) : null;
    const t = now();

    db.prepare(
      `UPDATE onboardings SET status='Submitted', phone=?, dob=?, address=?, emergency_name=?, emergency_phone=?,
        aadhaar_last4=?, aadhaar_front_path=?, aadhaar_back_path=?, selfie_path=?, face_score=?, face_match=?, consent_at=?,
        nda_text=?, nda_text_hash=?, nda_signed_name=?, nda_signature_path=?, nda_signed_at=?, nda_ip=?, nda_user_agent=?,
        submitted_at=?, review_note='', updated_at=? WHERE id=?`
    ).run(
      phone,
      dob,
      address,
      text(b.emergency_name, 120),
      text(b.emergency_phone, 20),
      aadhaar.slice(-4), // the full number is deliberately never stored
      front,
      back,
      selfie,
      score,
      score === null ? null : b.face_match ? 1 : 0,
      t,
      ndaText,
      crypto.createHash('sha256').update(ndaText).digest('hex'),
      signedName,
      sig,
      t,
      String(req.ip || ''),
      String(req.headers['user-agent'] || '').slice(0, 300),
      t,
      t,
      o.id
    );

    audit(null, 'ONBOARDING_SUBMITTED', 'onboarding', o.id, o.full_name);
    notifyAdmins('onboarding_submitted', 'Onboarding ready for review', `${o.full_name} has submitted ID verification and signed the NDA.`, 'onboarding', o.id, `onboarding_submitted:${o.id}:${t}`);
    res.json({ ok: true });
  })
);

// ====================================================================
// ADMIN endpoints
// ====================================================================

router.get('/onboarding', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM onboardings ORDER BY updated_at DESC').all();
  res.json({ rows: rows.map(publicShape) });
});

router.get('/onboarding/nda-template', requireAdmin, (req, res) => {
  res.json({ template: getNdaTemplate(), is_default: !getSetting('nda_template', '') });
});

router.put(
  '/onboarding/nda-template',
  requireAdmin,
  wrap((req, res) => {
    if ((req.body || {}).reset) {
      db.prepare("DELETE FROM settings WHERE key='nda_template'").run();
      audit(req.user, 'RESET', 'nda_template', null, '');
      return res.json({ ok: true });
    }
    const template = String((req.body || {}).template || '').trim();
    if (template.length < 50) throw new HttpError(400, 'The NDA text looks too short.');
    if (template.length > 20000) throw new HttpError(400, 'The NDA text is too long.');
    setSetting('nda_template', template);
    audit(req.user, 'UPDATE', 'nda_template', null, `${template.length} chars`);
    res.json({ ok: true });
  })
);

router.post(
  '/onboarding',
  requireAdmin,
  wrap((req, res) => {
    const b = req.body || {};
    const name = String(b.full_name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    if (!name) throw new HttpError(400, 'Full name is required.');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'That email address is not valid.');
    const salary = Number(b.monthly_salary || 0);
    if (!Number.isFinite(salary) || salary < 0) throw new HttpError(400, 'Salary must be a positive number.');

    const dup = db.prepare("SELECT id FROM onboardings WHERE LOWER(email)=? AND email<>'' AND status NOT IN ('Rejected')").get(email);
    if (dup) throw new HttpError(409, 'An onboarding for this email already exists.');

    const t = newToken();
    const r = db
      .prepare(
        `INSERT INTO onboardings(token_hash,token_expires_at,full_name,email,phone,department,designation,joining_date,employment_type,monthly_salary,status,created_by,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,'Invited',?,?,?)`
      )
      .run(
        t.token_hash,
        t.expires,
        name,
        email,
        String(b.phone || '').trim(),
        String(b.department || '').trim(),
        String(b.designation || '').trim(),
        b.joining_date || today(),
        String(b.employment_type || 'Full Time').trim(),
        salary,
        req.user.id,
        now(),
        now()
      );
    const o = db.prepare('SELECT * FROM onboardings WHERE id=?').get(r.lastInsertRowid);
    audit(req.user, 'CREATE', 'onboarding', o.id, name);
    sendInviteEmail(o, t.token);
    res.status(201).json({ id: o.id, token: t.token, link: inviteLink(t.token), expires_at: t.expires, emailed: !!(o.email && process.env.SMTP_HOST) });
  })
);

function adminRow(req) {
  const o = db.prepare('SELECT * FROM onboardings WHERE id=?').get(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Not found');
  return o;
}

router.get(
  '/onboarding/:id',
  requireAdmin,
  wrap((req, res) => {
    const o = adminRow(req);
    res.json({ ...publicShape(o), nda_text: o.nda_text, nda_ip: o.nda_ip, nda_user_agent: o.nda_user_agent });
  })
);

router.get(
  '/onboarding/:id/file/:kind',
  requireAdmin,
  wrap((req, res) => {
    const o = adminRow(req);
    const col = FILE_COLUMNS[req.params.kind];
    if (!col || !o[col]) throw new HttpError(404, 'File not found');
    const full = path.resolve(PRIVATE_DIR, o[col]);
    if (!full.startsWith(PRIVATE_DIR + path.sep) || !fs.existsSync(full)) throw new HttpError(404, 'File not found');
    audit(req.user, 'VIEW', 'onboarding_file', o.id, req.params.kind);
    res.set('Cache-Control', 'private, no-store');
    res.type(path.extname(full) === '.png' ? 'image/png' : 'image/jpeg');
    res.send(fs.readFileSync(full));
  })
);

router.post(
  '/onboarding/:id/regenerate',
  requireAdmin,
  wrap((req, res) => {
    const o = adminRow(req);
    if (['Approved', 'Rejected'].includes(o.status)) throw new HttpError(409, `A ${o.status.toLowerCase()} onboarding cannot get a new link.`);
    const t = newToken();
    db.prepare('UPDATE onboardings SET token_hash=?, token_expires_at=?, updated_at=? WHERE id=?').run(t.token_hash, t.expires, now(), o.id);
    audit(req.user, 'REGENERATE_LINK', 'onboarding', o.id, o.full_name);
    sendInviteEmail({ ...o, token_expires_at: t.expires }, t.token);
    res.json({ link: inviteLink(t.token), expires_at: t.expires });
  })
);

router.post(
  '/onboarding/:id/request-changes',
  requireAdmin,
  wrap((req, res) => {
    const o = adminRow(req);
    if (o.status !== 'Submitted') throw new HttpError(409, 'Only a submitted onboarding can be sent back.');
    const note = String((req.body || {}).note || '').trim();
    if (!note) throw new HttpError(400, 'Tell the new joiner what to fix.');
    const t = newToken();
    db.prepare("UPDATE onboardings SET status='Changes Requested', review_note=?, token_hash=?, token_expires_at=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?").run(
      note,
      t.token_hash,
      t.expires,
      req.user.id,
      now(),
      now(),
      o.id
    );
    audit(req.user, 'ONBOARDING_CHANGES_REQUESTED', 'onboarding', o.id, note);
    sendInviteEmail({ ...o, token_expires_at: t.expires }, t.token);
    res.json({ link: inviteLink(t.token), expires_at: t.expires });
  })
);

router.post(
  '/onboarding/:id/reject',
  requireAdmin,
  wrap((req, res) => {
    const o = adminRow(req);
    if (['Approved', 'Rejected'].includes(o.status)) throw new HttpError(409, `This onboarding is already ${o.status.toLowerCase()}.`);
    const note = String((req.body || {}).note || '').trim();
    db.prepare("UPDATE onboardings SET status='Rejected', review_note=?, token_expires_at=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?").run(
      note,
      now(), // kills the link
      req.user.id,
      now(),
      now(),
      o.id
    );
    audit(req.user, 'ONBOARDING_REJECTED', 'onboarding', o.id, note);
    res.json({ ok: true });
  })
);

router.post(
  '/onboarding/:id/approve',
  requireAdmin,
  wrap((req, res) => {
    const o = adminRow(req);
    if (o.status !== 'Submitted') throw new HttpError(409, 'Only a submitted onboarding can be approved.');
    if (!o.nda_signed_at) throw new HttpError(409, 'The NDA has not been signed.');
    if (!o.aadhaar_front_path || !o.selfie_path) throw new HttpError(409, 'ID documents are missing.');

    const b = req.body || {};
    const email = (o.email || '').toLowerCase();
    if (email && db.prepare('SELECT id FROM users WHERE LOWER(email)=?').get(email)) {
      throw new HttpError(409, 'An employee account with this email already exists.');
    }
    const salary = b.monthly_salary !== undefined ? Number(b.monthly_salary) : o.monthly_salary;
    if (!Number.isFinite(salary) || salary < 0) throw new HttpError(400, 'Salary must be a positive number.');

    const code = generateEmployeeCode();
    // Random per-person password, shown once to the admin. (Not emailed - it would sit in an inbox in plain text.)
    const tempPassword = crypto.randomBytes(9).toString('base64url');
    const t = now();

    db.exec('BEGIN');
    try {
      const u = db
        .prepare(
          `INSERT INTO users(name,employee_code,password_hash,role,department,designation,joining_date,employment_type,phone,email,monthly_salary,active,created_at,updated_at)
           VALUES(?,?,?,'Employee',?,?,?,?,?,?,?,1,?,?)`
        )
        .run(
          o.full_name,
          code,
          passwordHash(tempPassword),
          String(b.department ?? o.department ?? '').trim() || 'General',
          String(b.designation ?? o.designation ?? '').trim() || 'Team Member',
          b.joining_date || o.joining_date || today(),
          o.employment_type || 'Full Time',
          o.phone,
          o.email,
          salary,
          t,
          t
        );
      db.prepare("UPDATE onboardings SET status='Approved', user_id=?, reviewed_by=?, reviewed_at=?, review_note='', updated_at=? WHERE id=?").run(
        u.lastInsertRowid,
        req.user.id,
        t,
        t,
        o.id
      );
      db.exec('COMMIT');
      audit(req.user, 'ONBOARDING_APPROVED', 'onboarding', o.id, `${o.full_name} -> ${code}`);
      res.json({ ok: true, user_id: u.lastInsertRowid, employee_code: code, temp_password: tempPassword });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  })
);

// Data-minimisation: once an employee is approved, the ID images are no longer needed day to day.
router.delete(
  '/onboarding/:id/documents',
  requireAdmin,
  wrap((req, res) => {
    const o = adminRow(req);
    if (o.status === 'Submitted') throw new HttpError(409, 'Review this onboarding before deleting its documents.');
    for (const col of ['aadhaar_front_path', 'aadhaar_back_path', 'selfie_path']) removeFile(o[col]);
    db.prepare("UPDATE onboardings SET aadhaar_front_path='', aadhaar_back_path='', selfie_path='', updated_at=? WHERE id=?").run(now(), o.id);
    audit(req.user, 'PURGE_DOCUMENTS', 'onboarding', o.id, o.full_name);
    res.json({ ok: true });
  })
);

router.delete(
  '/onboarding/:id',
  requireAdmin,
  wrap((req, res) => {
    const o = adminRow(req);
    if (o.status === 'Approved') throw new HttpError(409, 'An approved onboarding is part of the employee record and cannot be deleted.');
    for (const col of Object.values(FILE_COLUMNS)) removeFile(o[col]);
    try {
      fs.rmdirSync(path.join(PRIVATE_DIR, String(o.id)));
    } catch (e) {
      /* not empty / missing */
    }
    db.prepare('DELETE FROM onboardings WHERE id=?').run(o.id);
    audit(req.user, 'DELETE', 'onboarding', o.id, o.full_name);
    res.json({ ok: true });
  })
);

module.exports = router;
