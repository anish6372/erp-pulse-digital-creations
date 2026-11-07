const crypto = require('node:crypto');

function uid() {
  return crypto.randomBytes(18).toString('hex');
}

function hash(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(password, salt, 150000, 32, 'sha256').toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const [salt, storedHash] = stored.split(':');
  const derived = crypto.pbkdf2Sync(password, salt, 150000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(storedHash, 'hex'));
}

// AES-256-GCM encryption for third-party secrets we must store in reversible
// form (e.g. an Instagram access token) — unlike passwords, we need to read
// these back to call the API, so they can't be one-way hashed like above.
// Requires INSTAGRAM_TOKEN_KEY: a 32-byte key, base64 or hex encoded, in .env.
function getSecretKey() {
  const raw = process.env.INSTAGRAM_TOKEN_KEY;
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) return null;
  return buf;
}

function canEncryptSecrets() {
  return !!getSecretKey();
}

function encryptSecret(plaintext) {
  const key = getSecretKey();
  if (!key) throw new Error('INSTAGRAM_TOKEN_KEY is not configured — see backend/.env.example');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

function decryptSecret(stored) {
  const key = getSecretKey();
  if (!key) throw new Error('INSTAGRAM_TOKEN_KEY is not configured — see backend/.env.example');
  const [ivB64, tagB64, dataB64] = String(stored).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { uid, hash, passwordHash, verifyPassword, canEncryptSecrets, encryptSecret, decryptSecret };
