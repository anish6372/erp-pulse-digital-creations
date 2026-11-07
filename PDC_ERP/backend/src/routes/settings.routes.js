const express = require('express');
const { defaultSettings, setSetting } = require('../db');
const { audit } = require('../utils/audit');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.put('/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  for (const k of Object.keys(defaultSettings)) if (b[k] !== undefined) setSetting(k, b[k]);
  audit(req.user, 'UPDATE', 'settings', null);
  res.json({ ok: true });
});

module.exports = router;
