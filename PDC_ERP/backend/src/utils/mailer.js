const nodemailer = require('nodemailer');

let transporter = null;
let warned = false;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

// Fire-and-forget: a mail failure should never break the API request that triggered it.
async function sendMail({ to, subject, html, text }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return;
  const t = getTransporter();
  if (!t) {
    if (!warned) {
      console.warn('[mailer] SMTP_HOST is not set — emails will not be sent. See backend/.env.example.');
      warned = true;
    }
    return;
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: recipients.join(','),
      subject,
      text: text || undefined,
      html,
    });
  } catch (e) {
    console.error('[mailer] send failed:', e.message);
  }
}

module.exports = { sendMail };
