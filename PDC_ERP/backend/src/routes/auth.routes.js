const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { getSetting } = require('../db');
const { uid, hash, passwordHash, verifyPassword } = require('../utils/crypto');
const { now, today, istHM } = require('../utils/datetime');
const { notify, notifyAdmins } = require('../utils/notify');
const { audit } = require('../utils/audit');
const { requireAuth } = require('../middleware/auth');
const { generateEmployeeCode } = require('../utils/employeeCode');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

function createLoginSession(u, res) {
  const token = uid();
  const expires = new Date(Date.now() + 7 * 864e5).toISOString();
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hash(token), u.id, expires, now());
  const when = now();
  db.prepare('INSERT INTO login_sessions(user_id,login_at) VALUES(?,?)').run(u.id, when);
  const d = today();
  const existing = db.prepare('SELECT * FROM attendance_days WHERE user_id=? AND date=?').get(u.id, d);
  const approvedToday = db.prepare("SELECT id,leave_type FROM leave_requests WHERE user_id=? AND leave_date=? AND status='Approved'").get(u.id, d);
  const firstStatus = approvedToday
    ? approvedToday.leave_type === 'Half Day'
      ? 'Half Day'
      : 'Leave'
    : istHM(when) > getSetting('office_start', '11:00')
    ? 'Late / Half Day'
    : 'Present';
  if (!existing) {
    db.prepare('INSERT INTO attendance_days(user_id,date,status,first_login,manual_note) VALUES(?,?,?,?,?)').run(
      u.id,
      d,
      firstStatus,
      istHM(when),
      approvedToday ? 'Approved leave' : 'Automatic login attendance'
    );
  } else if (!existing.first_login) {
    db.prepare('UPDATE attendance_days SET status=?,first_login=?,manual_note=? WHERE id=?').run(
      firstStatus,
      istHM(when),
      approvedToday ? 'Approved leave' : 'Automatic login attendance',
      existing.id
    );
  }
  notify(u.id, 'attendance_checkin', 'Attendance recorded', `Your ${firstStatus} attendance was recorded at ${istHM(when)}.`, 'attendance', existing?.id || null, `attendance_checkin:${u.id}:${d}`);
  if (u.role !== 'Admin') notifyAdmins('attendance_checkin', 'Employee checked in', `${u.name} checked in at ${istHM(when)} — ${firstStatus}.`, 'attendance', existing?.id || null, `attendance_admin:${u.id}:${d}`);
  audit(u, 'LOGIN', 'session', null, 'Login successful');
  return res.json({
    token,
    user: { id: u.id, name: u.name, employee_code: u.employee_code, role: u.role, department: u.department, designation: u.designation, email: u.email, phone: u.phone },
  });
}

router.post('/login', loginLimiter, (req, res) => {
  const b = req.body || {};
  const queryVal = String(b.user_id || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE (LOWER(employee_code)=? OR LOWER(email)=?) AND active=1').get(queryVal, queryVal);
  if (!u || !verifyPassword(String(b.password || ''), u.password_hash)) {
    audit(null, 'LOGIN_FAILED', 'session', null, String(b.user_id || ''));
    return res.status(401).json({ error: 'Invalid User ID or Password' });
  }
  return createLoginSession(u, res);
});

router.post('/register', loginLimiter, (req, res) => {
  const { name, email, password, department, phone } = req.body || {};
  
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Full name is required.' });
  }
  if (!email || !email.trim() || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(email)=? OR LOWER(employee_code)=?').get(cleanEmail, cleanEmail);
  if (existingUser) {
    return res.status(400).json({ error: 'An account with this email address already exists.' });
  }

  const empCode = generateEmployeeCode();
  const pHash = passwordHash(password);
  const currentTime = now();
  const joiningDate = today();

  const info = db.prepare(
    `INSERT INTO users(name, employee_code, password_hash, role, department, designation, joining_date, employment_type, phone, email, active, created_at, updated_at) 
     VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)`
  ).run(
    name.trim(),
    empCode,
    pHash,
    'Employee',
    department && department.trim() ? department.trim() : 'General',
    'Team Member',
    joiningDate,
    'Full Time',
    phone ? phone.trim() : '',
    cleanEmail,
    currentTime,
    currentTime
  );

  const newUser = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  audit(newUser, 'REGISTER', 'user', newUser.id, `User registered with code ${empCode}`);
  return createLoginSession(newUser, res);
});

router.get('/auth/google/config', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || getSetting('google_client_id', '');
  res.json({
    enabled: Boolean(clientId),
    clientId: clientId || null,
  });
});

router.post('/auth/google', async (req, res) => {
  const { credential } = req.body || {};
  const clientId = process.env.GOOGLE_CLIENT_ID || getSetting('google_client_id', '');
  if (!clientId) return res.status(400).json({ error: 'Google sign-in is not enabled.' });
  if (!credential || typeof credential !== 'string') {
    return res.status(400).json({ error: 'Google sign-in information incomplete.' });
  }

  // Never trust the token's contents on their own: Google confirms the signature, expiry and audience.
  let payload;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!r.ok) return res.status(401).json({ error: 'Google sign-in could not be verified.' });
    payload = await r.json();
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Google to verify sign-in.' });
  }
  if (payload.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) {
    return res.status(401).json({ error: 'Google sign-in could not be verified.' });
  }
  if (String(payload.email_verified) !== 'true') {
    return res.status(401).json({ error: 'Your Google email is not verified.' });
  }

  const userEmail = payload.email || '';
  const userName = payload.name || (payload.email ? payload.email.split('@')[0] : '');
  const subId = payload.sub || '';

  if (!userEmail || !userEmail.includes('@')) {
    return res.status(400).json({ error: 'Valid Google email is required.' });
  }

  const cleanEmail = userEmail.trim().toLowerCase();
  let user = db.prepare('SELECT * FROM users WHERE LOWER(email)=? OR (google_id<>"" AND google_id=?)').get(cleanEmail, subId);

  if (!user) {
    const empCode = generateEmployeeCode();
    const dummyPassword = passwordHash(uid());
    const currentTime = now();
    const joiningDate = today();

    const info = db.prepare(
      `INSERT INTO users(name, employee_code, password_hash, role, department, designation, joining_date, employment_type, phone, email, google_id, active, created_at, updated_at) 
       VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?)`
    ).run(
      userName.trim(),
      empCode,
      dummyPassword,
      'Employee',
      'General',
      'Team Member',
      joiningDate,
      'Full Time',
      '',
      cleanEmail,
      subId,
      currentTime,
      currentTime
    );

    user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    audit(user, 'OAUTH_REGISTER', 'user', user.id, `User registered via Google OAuth (${empCode})`);
  } else if (!user.google_id && subId) {
    db.prepare('UPDATE users SET google_id=?, updated_at=? WHERE id=?').run(subId, now(), user.id);
  }

  if (!user.active) {
    return res.status(403).json({ error: 'Account is inactive. Contact administrator.' });
  }

  return createLoginSession(user, res);
});

router.post('/logout', requireAuth, (req, res) => {
  const u = req.user;
  db.prepare(`UPDATE login_sessions SET logout_at=? WHERE id=(SELECT id FROM login_sessions WHERE user_id=? AND logout_at IS NULL ORDER BY login_at DESC LIMIT 1)`).run(now(), u.id);
  const auth = req.headers.authorization || '';
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(auth.slice(7)));
  audit(u, 'LOGOUT', 'session', null, 'Logout');
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u.id,
      name: u.name,
      employee_code: u.employee_code,
      role: u.role,
      department: u.department,
      designation: u.designation,
      email: u.email,
      phone: u.phone,
      joining_date: u.joining_date,
      employment_type: u.employment_type,
      monthly_salary: u.monthly_salary,
      monthly_target_tasks: u.monthly_target_tasks,
      monthly_target_hours: u.monthly_target_hours,
    },
  });
});

module.exports = router;
