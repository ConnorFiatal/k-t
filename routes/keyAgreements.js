/**
 * routes/keyAgreements.js
 * Key agreement management — view, list, upload signed scans.
 * Mounts at /key-agreements
 */
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { db }  = require('../db');

const router = express.Router();

// ── Signed agreement upload ────────────────────────────────────────────────
const agreementDir = path.join(__dirname, '..', 'public', 'uploads', 'agreements');
if (!fs.existsSync(agreementDir)) fs.mkdirSync(agreementDir, { recursive: true });

const agmtStorage = multer.diskStorage({
  destination: agreementDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `agmt-${req.params.id}-${Date.now()}${ext}`);
  }
});
const agmtUpload = multer({
  storage: agmtStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
    if (allowed.has(path.extname(file.originalname).toLowerCase())) return cb(null, true);
    cb(new Error('Only PDF and image files are accepted'));
  }
});

// ══════════════════════════════════════════════════════════════════════════
// LIST
// ══════════════════════════════════════════════════════════════════════════
router.get('/', (req, res) => {
  const { status, staff_id } = req.query;

  let query = `
    SELECT ka.*,
           pk.stamp_number, k.key_number, ks.name AS system_name,
           s.first_name, s.last_name, s.department, s.status AS staff_status
    FROM key_agreements ka
    JOIN physical_keys pk ON pk.id = ka.physical_key_id
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    JOIN staff s ON s.id = ka.staff_id
    WHERE 1=1
  `;
  const params = [];

  if (status === 'active') {
    query += ' AND ka.returned_date IS NULL';
  } else if (status === 'returned') {
    query += ' AND ka.returned_date IS NOT NULL';
  }
  if (staff_id) { query += ' AND ka.staff_id = ?'; params.push(staff_id); }

  // default: active only
  if (!status) query += ' AND ka.returned_date IS NULL';

  query += ' ORDER BY ka.issued_date DESC, ka.id DESC';
  const agreements = db.prepare(query).all(...params).map(a => ({
    ...a,
    isOverdue: a.expiry_date && !a.returned_date && new Date(a.expiry_date) < new Date()
  }));

  const allStaff = db.prepare('SELECT id, first_name, last_name FROM staff ORDER BY last_name, first_name').all();

  res.render('key-agreements/index', {
    title: 'Key Agreements', agreements, allStaff,
    filters: { status: status || 'active', staff_id: staff_id || '' }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// DETAIL / PRINT
// ══════════════════════════════════════════════════════════════════════════
router.get('/:id', (req, res) => {
  const agreement = db.prepare(`
    SELECT ka.*,
           pk.stamp_number, pk.status AS key_status, pk.expiry_date AS key_expiry,
           k.key_number, k.level, k.keyway,
           ks.name AS system_name,
           s.first_name, s.last_name, s.department, s.title, s.employee_id
    FROM key_agreements ka
    JOIN physical_keys pk ON pk.id = ka.physical_key_id
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    JOIN staff s ON s.id = ka.staff_id
    WHERE ka.id = ?
  `).get(req.params.id);

  if (!agreement) {
    req.session.flash = { error: 'Agreement not found.' };
    return res.redirect('/key-agreements');
  }

  const appName = 'KeyDog';
  const appUrl  = process.env.APP_URL || 'http://localhost:3000';

  res.render('key-agreements/detail', {
    title: `Agreement — ${agreement.stamp_number}`, agreement, appName, appUrl
  });
});

// ══════════════════════════════════════════════════════════════════════════
// UPLOAD SIGNED AGREEMENT SCAN
// ══════════════════════════════════════════════════════════════════════════
router.post('/:id/upload', agmtUpload.single('signed_agreement'), (req, res) => {
  const agreement = db.prepare('SELECT * FROM key_agreements WHERE id = ?').get(req.params.id);
  if (!agreement) { req.session.flash = { error: 'Agreement not found.' }; return res.redirect('/key-agreements'); }
  if (!req.file) { req.session.flash = { error: 'No file received.' }; return res.redirect(`/key-agreements/${agreement.id}`); }

  db.prepare('UPDATE key_agreements SET signed_agreement_filename=? WHERE id=?')
    .run(req.file.filename, agreement.id);

  req.session.flash = { success: 'Signed agreement uploaded.' };
  res.redirect(`/key-agreements/${agreement.id}`);
});

module.exports = router;
