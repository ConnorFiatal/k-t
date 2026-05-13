/**
 * routes/physicalKeys.js
 * CRUD + lifecycle actions for individual physical key copies.
 * Mounts at /physical-keys
 */
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { db, auditLog } = require('../db');

const router = express.Router();

// ── Receipt upload (for issued_from_locksmith) ────────────────────────────
const receiptDir = path.join(__dirname, '..', 'public', 'uploads', 'receipts');
if (!fs.existsSync(receiptDir)) fs.mkdirSync(receiptDir, { recursive: true });

const receiptStorage = multer.diskStorage({
  destination: receiptDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `receipt-${Date.now()}${ext}`);
  }
});
const receiptUpload = multer({
  storage: receiptStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
    if (allowed.has(path.extname(file.originalname).toLowerCase())) return cb(null, true);
    cb(new Error('Only PDF and image files are accepted'));
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
const STATUS_LABELS = { active: 'Active', lost: 'Lost', damaged: 'Damaged', destroyed: 'Destroyed' };

function getPhysicalKey(id) {
  return db.prepare(`
    SELECT pk.*,
           k.key_number, k.level, k.bitting, k.keyway,
           ks.name AS system_name,
           kr.ring_number,
           s.first_name AS holder_first, s.last_name AS holder_last, s.id AS holder_staff_id
    FROM physical_keys pk
    JOIN keys k        ON k.id  = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN keyrings kr ON kr.id = pk.keytrak_ring_id
    LEFT JOIN key_agreements ka ON ka.physical_key_id = pk.id AND ka.returned_date IS NULL
    LEFT JOIN staff s ON s.id = ka.staff_id
    WHERE pk.id = ?
  `).get(id);
}

function getCustodyLog(physicalKeyId) {
  return db.prepare(`
    SELECT kcl.*,
           fs.first_name AS from_first, fs.last_name AS from_last,
           ts.first_name AS to_first,   ts.last_name AS to_last
    FROM key_custody_log kcl
    LEFT JOIN staff fs ON fs.id = kcl.from_staff_id
    LEFT JOIN staff ts ON ts.id = kcl.to_staff_id
    WHERE kcl.physical_key_id = ?
    ORDER BY kcl.id DESC
  `).all(physicalKeyId);
}

function getTransactions(physicalKeyId) {
  return db.prepare(`
    SELECT kt.*,
           s.first_name, s.last_name,
           lk.stamp_number AS linked_stamp
    FROM key_transactions kt
    LEFT JOIN staff s ON s.id = kt.assigned_to_staff_id
    LEFT JOIN physical_keys lk ON lk.id = kt.linked_key_id
    WHERE kt.physical_key_id = ?
    ORDER BY kt.id DESC
  `).all(physicalKeyId);
}

function isExpiringSoon(dateStr) {
  if (!dateStr) return false;
  const diff = (new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 30;
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

// ══════════════════════════════════════════════════════════════════════════
// LIST
// ══════════════════════════════════════════════════════════════════════════
router.get('/', (req, res) => {
  const { status, system_id, q } = req.query;

  let query = `
    SELECT pk.*,
           k.key_number, k.level,
           ks.name AS system_name, ks.id AS key_system_id,
           kr.ring_number,
           s.first_name AS holder_first, s.last_name AS holder_last
    FROM physical_keys pk
    JOIN keys k        ON k.id  = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN keyrings kr ON kr.id = pk.keytrak_ring_id
    LEFT JOIN key_agreements ka ON ka.physical_key_id = pk.id AND ka.returned_date IS NULL
    LEFT JOIN staff s ON s.id = ka.staff_id
    WHERE 1=1
  `;
  const params = [];
  if (status) { query += ' AND pk.status = ?'; params.push(status); }
  if (system_id) { query += ' AND ks.id = ?'; params.push(system_id); }
  if (q) {
    query += ' AND (pk.stamp_number LIKE ? OR k.key_number LIKE ? OR ks.name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  query += ' ORDER BY pk.stamp_number';

  const keys = db.prepare(query).all(...params).map(k => ({
    ...k,
    isOverdue: isOverdue(k.expiry_date),
    isExpiringSoon: !isOverdue(k.expiry_date) && isExpiringSoon(k.expiry_date)
  }));

  const systems  = db.prepare('SELECT id, name FROM key_systems ORDER BY name').all();
  const counts = {
    active:    db.prepare("SELECT COUNT(*) AS c FROM physical_keys WHERE status='active'").get().c,
    lost:      db.prepare("SELECT COUNT(*) AS c FROM physical_keys WHERE status='lost'").get().c,
    damaged:   db.prepare("SELECT COUNT(*) AS c FROM physical_keys WHERE status='damaged'").get().c,
    destroyed: db.prepare("SELECT COUNT(*) AS c FROM physical_keys WHERE status='destroyed'").get().c,
  };

  res.render('physical-keys/index', {
    title: 'Physical Key Copies', keys, systems, counts,
    filters: { status: status || '', system_id: system_id || '', q: q || '' },
    STATUS_LABELS
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW / CREATE
// ══════════════════════════════════════════════════════════════════════════
router.get('/new', (req, res) => {
  const allKeys  = db.prepare(`
    SELECT k.*, ks.name AS system_name FROM keys k
    JOIN key_systems ks ON ks.id = k.key_system_id ORDER BY ks.name, k.level, k.key_number
  `).all();
  const keyrings = db.prepare('SELECT id, ring_number, description FROM keyrings ORDER BY ring_number').all();
  res.render('physical-keys/form', {
    title: 'Add Physical Key Copy', pk: null, action: '/physical-keys',
    allKeys, keyrings, STATUS_LABELS
  });
});

router.post('/', receiptUpload.single('receipt'), (req, res) => {
  const { stamp_number, key_type_id, keytrak_ring_id, notes, expiry_date, transaction_date } = req.body;
  if (!stamp_number || !key_type_id) {
    req.session.flash = { error: 'Stamp number and key type are required.' };
    return res.redirect('/physical-keys/new');
  }
  const receiptFilename = req.file ? req.file.filename : null;
  const user = req.session.user.username;
  const txDate = transaction_date || new Date().toISOString().replace('T', ' ').slice(0, 19);

  try {
    const result = db.prepare(`
      INSERT INTO physical_keys (stamp_number, key_type_id, keytrak_ring_id, notes, expiry_date)
      VALUES (?, ?, ?, ?, ?)
    `).run(stamp_number.trim(), key_type_id, keytrak_ring_id || null, notes || null, expiry_date || null);
    const pkId = result.lastInsertRowid;

    // Record initial locksmith transaction
    db.prepare(`
      INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, notes, receipt_filename)
      VALUES (?, 'issued_from_locksmith', ?, ?, ?, ?)
    `).run(pkId, txDate, user, notes || null, receiptFilename);

    // Custody log entry
    db.prepare(`
      INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
      VALUES (?, NULL, NULL, ?, ?, 'issued_from_locksmith', ?)
    `).run(pkId, txDate, user, notes || null);

    auditLog('CREATE', 'PHYSICAL_KEY', pkId, stamp_number, null, null, user);
    req.session.flash = { success: `Physical key copy ${stamp_number} added.` };
    res.redirect(`/physical-keys/${pkId}`);
  } catch (err) {
    req.session.flash = { error: err.message.includes('UNIQUE') ? `Stamp number "${stamp_number}" already exists.` : `Error: ${err.message}` };
    res.redirect('/physical-keys/new');
  }
});

// ══════════════════════════════════════════════════════════════════════════
// BATCH CREATE  (must be before /:id so "batch" isn't treated as an ID)
// ══════════════════════════════════════════════════════════════════════════
router.get('/batch', (req, res) => {
  const allKeys  = db.prepare(`
    SELECT k.*, ks.name AS system_name FROM keys k
    JOIN key_systems ks ON ks.id = k.key_system_id ORDER BY ks.name, k.level, k.key_number
  `).all();
  const keyrings = db.prepare('SELECT id, ring_number, description FROM keyrings ORDER BY ring_number').all();
  res.render('physical-keys/batch', {
    title: 'Add Key Batch', allKeys, keyrings
  });
});

router.post('/batch', receiptUpload.single('receipt'), (req, res) => {
  const {
    mode, prefix, start_num, end_num, stamp_list,
    key_type_id, keytrak_ring_id, notes, expiry_date, transaction_date
  } = req.body;

  // ── Build stamp list ────────────────────────────────────────────────────
  let stamps = [];

  if (mode === 'range') {
    const startRaw = (start_num || '').trim();
    const startVal = parseInt(startRaw, 10);
    const endVal   = parseInt(end_num,  10);

    if (!startRaw || isNaN(startVal) || isNaN(endVal)) {
      req.session.flash = { error: 'Start and end numbers are required for range mode.' };
      return res.redirect('/physical-keys/batch');
    }
    if (startVal > endVal) {
      req.session.flash = { error: 'Start number must be less than or equal to end number.' };
      return res.redirect('/physical-keys/batch');
    }
    // Detect zero-padding from start value (e.g. "007" → pad=3)
    const pad = startRaw.length > startVal.toString().length ? startRaw.length : 0;
    const pre = prefix || '';
    for (let i = startVal; i <= endVal; i++) {
      stamps.push(pre + (pad ? i.toString().padStart(pad, '0') : i.toString()));
    }
  } else {
    // list mode — one stamp per line
    stamps = (stamp_list || '').split('\n').map(s => s.trim()).filter(Boolean);
  }

  if (stamps.length === 0) {
    req.session.flash = { error: 'No stamp numbers to add.' };
    return res.redirect('/physical-keys/batch');
  }
  if (stamps.length > 500) {
    req.session.flash = { error: 'Maximum 500 keys per batch. Split into smaller batches.' };
    return res.redirect('/physical-keys/batch');
  }
  if (!key_type_id) {
    req.session.flash = { error: 'Key type is required.' };
    return res.redirect('/physical-keys/batch');
  }

  const receiptFilename = req.file ? req.file.filename : null;
  const user   = req.session.user.username;
  const txDate = transaction_date || new Date().toISOString().replace('T', ' ').slice(0, 19);

  const insertPk = db.prepare(`
    INSERT INTO physical_keys (stamp_number, key_type_id, keytrak_ring_id, notes, expiry_date)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertTx = db.prepare(`
    INSERT INTO key_transactions
      (physical_key_id, transaction_type, transaction_date, performed_by, notes, receipt_filename)
    VALUES (?, 'issued_from_locksmith', ?, ?, ?, ?)
  `);
  const insertCustody = db.prepare(`
    INSERT INTO key_custody_log
      (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
    VALUES (?, NULL, NULL, ?, ?, 'issued_from_locksmith', ?)
  `);

  const added   = [];
  const skipped = [];

  try {
    db.exec('BEGIN');
    for (const stamp of stamps) {
      try {
        const result = insertPk.run(
          stamp, key_type_id, keytrak_ring_id || null, notes || null, expiry_date || null
        );
        const pkId = result.lastInsertRowid;
        insertTx.run(pkId, txDate, user, notes || null, receiptFilename);
        insertCustody.run(pkId, txDate, user, notes || null);
        auditLog('CREATE', 'PHYSICAL_KEY', pkId, stamp, null, null, user);
        added.push(stamp);
      } catch (innerErr) {
        if (innerErr.message && innerErr.message.includes('UNIQUE')) {
          skipped.push(stamp);
        } else {
          db.exec('ROLLBACK');
          req.session.flash = { error: `Batch failed at stamp "${stamp}": ${innerErr.message}` };
          return res.redirect('/physical-keys/batch');
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    req.session.flash = { error: `Batch failed: ${err.message}` };
    return res.redirect('/physical-keys/batch');
  }

  let msg = `${added.length} key cop${added.length === 1 ? 'y' : 'ies'} added.`;
  if (skipped.length > 0) {
    msg += ` ${skipped.length} skipped (stamp already exists): ${skipped.join(', ')}.`;
  }
  req.session.flash = { [added.length > 0 ? 'success' : 'error']: msg };
  res.redirect('/physical-keys');
});

// ══════════════════════════════════════════════════════════════════════════
// DETAIL
// ══════════════════════════════════════════════════════════════════════════
router.get('/:id', (req, res) => {
  const pk = getPhysicalKey(req.params.id);
  if (!pk) { req.session.flash = { error: 'Physical key not found.' }; return res.redirect('/physical-keys'); }

  const custodyLog   = getCustodyLog(pk.id);
  const transactions = getTransactions(pk.id);

  // Active agreement (if any)
  const activeAgreement = db.prepare(`
    SELECT ka.*, s.first_name, s.last_name, s.email, s.department, s.title
    FROM key_agreements ka JOIN staff s ON s.id = ka.staff_id
    WHERE ka.physical_key_id = ? AND ka.returned_date IS NULL
    ORDER BY ka.id DESC LIMIT 1
  `).get(pk.id);

  // For the issue form: active staff without this key
  const activeStaff = pk.status === 'active' && !activeAgreement
    ? db.prepare("SELECT id, first_name, last_name, department FROM staff WHERE status='active' ORDER BY last_name, first_name").all()
    : [];

  res.render('physical-keys/detail', {
    title: `Key Copy ${pk.stamp_number}`,
    pk, custodyLog, transactions, activeAgreement, activeStaff,
    STATUS_LABELS,
    isOverdue: isOverdue(pk.expiry_date),
    isExpiringSoon: !isOverdue(pk.expiry_date) && isExpiringSoon(pk.expiry_date)
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EDIT
// ══════════════════════════════════════════════════════════════════════════
router.get('/:id/edit', (req, res) => {
  const pk = db.prepare('SELECT * FROM physical_keys WHERE id = ?').get(req.params.id);
  if (!pk) { req.session.flash = { error: 'Physical key not found.' }; return res.redirect('/physical-keys'); }
  const allKeys  = db.prepare(`
    SELECT k.*, ks.name AS system_name FROM keys k
    JOIN key_systems ks ON ks.id = k.key_system_id ORDER BY ks.name, k.level, k.key_number
  `).all();
  const keyrings = db.prepare('SELECT id, ring_number, description FROM keyrings ORDER BY ring_number').all();
  res.render('physical-keys/form', {
    title: `Edit Key Copy ${pk.stamp_number}`, pk, action: `/physical-keys/${pk.id}`,
    allKeys, keyrings, STATUS_LABELS
  });
});

router.post('/:id', (req, res) => {
  const pk = db.prepare('SELECT * FROM physical_keys WHERE id = ?').get(req.params.id);
  if (!pk) { req.session.flash = { error: 'Physical key not found.' }; return res.redirect('/physical-keys'); }
  const { stamp_number, key_type_id, keytrak_ring_id, notes, expiry_date } = req.body;
  if (!stamp_number || !key_type_id) {
    req.session.flash = { error: 'Stamp number and key type are required.' };
    return res.redirect(`/physical-keys/${pk.id}/edit`);
  }
  try {
    db.prepare(`
      UPDATE physical_keys SET stamp_number=?, key_type_id=?, keytrak_ring_id=?, notes=?, expiry_date=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(stamp_number.trim(), key_type_id, keytrak_ring_id || null, notes || null, expiry_date || null, pk.id);
    req.session.flash = { success: 'Key copy updated.' };
    res.redirect(`/physical-keys/${pk.id}`);
  } catch (err) {
    req.session.flash = { error: err.message.includes('UNIQUE') ? `Stamp number "${stamp_number}" already exists.` : `Error: ${err.message}` };
    res.redirect(`/physical-keys/${pk.id}/edit`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ISSUE TO PERSON
// ══════════════════════════════════════════════════════════════════════════
router.post('/:id/issue', (req, res) => {
  const pk = getPhysicalKey(req.params.id);
  if (!pk) { req.session.flash = { error: 'Physical key not found.' }; return res.redirect('/physical-keys'); }
  if (pk.status !== 'active') {
    req.session.flash = { error: `Cannot issue — key is ${pk.status}.` };
    return res.redirect(`/physical-keys/${pk.id}`);
  }
  // Check if already issued
  const existing = db.prepare('SELECT id FROM key_agreements WHERE physical_key_id = ? AND returned_date IS NULL').get(pk.id);
  if (existing) {
    req.session.flash = { error: 'Key is already issued. Return it first.' };
    return res.redirect(`/physical-keys/${pk.id}`);
  }

  const { staff_id, issued_date, expiry_date, notes } = req.body;
  const staff = staff_id ? db.prepare('SELECT * FROM staff WHERE id = ?').get(staff_id) : null;
  if (!staff || !issued_date) {
    req.session.flash = { error: 'Staff member and issued date are required.' };
    return res.redirect(`/physical-keys/${pk.id}`);
  }
  const user = req.session.user.username;
  const ackText = `I, ${staff.first_name} ${staff.last_name}, acknowledge receipt of key copy ${pk.stamp_number} (${pk.key_number} — ${pk.system_name}). I understand I am personally responsible for the safekeeping of this key. In the event of loss or theft I will immediately notify the responsible administrator. I will not duplicate this key or allow unauthorized use. I will return this key upon request or upon termination of employment.`;

  // Create agreement
  const agmt = db.prepare(`
    INSERT INTO key_agreements (physical_key_id, staff_id, issued_date, expiry_date, acknowledgment_text)
    VALUES (?, ?, ?, ?, ?)
  `).run(pk.id, staff.id, issued_date, expiry_date || null, ackText);

  // Transaction record
  db.prepare(`
    INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, assigned_to_staff_id, notes)
    VALUES (?, 'issued_to_person', ?, ?, ?, ?)
  `).run(pk.id, issued_date, user, staff.id, notes || null);

  // Custody log
  db.prepare(`
    INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
    VALUES (?, NULL, ?, ?, ?, 'issued_to_person', ?)
  `).run(pk.id, staff.id, issued_date, user, notes || null);

  // Update key expiry if provided
  if (expiry_date) {
    db.prepare('UPDATE physical_keys SET expiry_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(expiry_date, pk.id);
  }

  auditLog('ISSUE', 'PHYSICAL_KEY', pk.id, pk.stamp_number, staff.id, `${staff.first_name} ${staff.last_name}`, user);
  req.session.flash = { success: `Key ${pk.stamp_number} issued to ${staff.first_name} ${staff.last_name}.` };
  res.redirect(`/key-agreements/${agmt.lastInsertRowid}`);
});

// ══════════════════════════════════════════════════════════════════════════
// RETURN
// ══════════════════════════════════════════════════════════════════════════
router.post('/:id/return', (req, res) => {
  const pk = getPhysicalKey(req.params.id);
  if (!pk) { req.session.flash = { error: 'Physical key not found.' }; return res.redirect('/physical-keys'); }

  const activeAgreement = db.prepare(
    'SELECT * FROM key_agreements WHERE physical_key_id = ? AND returned_date IS NULL ORDER BY id DESC LIMIT 1'
  ).get(pk.id);
  if (!activeAgreement) {
    req.session.flash = { error: 'No active issuance found for this key.' };
    return res.redirect(`/physical-keys/${pk.id}`);
  }

  const { returned_date, notes } = req.body;
  if (!returned_date) {
    req.session.flash = { error: 'Return date is required.' };
    return res.redirect(`/physical-keys/${pk.id}`);
  }
  const user = req.session.user.username;

  // Close agreement
  db.prepare('UPDATE key_agreements SET returned_date = ? WHERE id = ?').run(returned_date, activeAgreement.id);

  // Transaction
  db.prepare(`
    INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, assigned_to_staff_id, notes)
    VALUES (?, 'returned', ?, ?, ?, ?)
  `).run(pk.id, returned_date, user, activeAgreement.staff_id, notes || null);

  // Custody log
  db.prepare(`
    INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
    VALUES (?, ?, NULL, ?, ?, 'returned', ?)
  `).run(pk.id, activeAgreement.staff_id, returned_date, user, notes || null);

  auditLog('RETURN', 'PHYSICAL_KEY', pk.id, pk.stamp_number, activeAgreement.staff_id, null, user);
  req.session.flash = { success: `Key ${pk.stamp_number} returned.` };
  res.redirect(`/physical-keys/${pk.id}`);
});

// ══════════════════════════════════════════════════════════════════════════
// MARK LOST
// ══════════════════════════════════════════════════════════════════════════
router.post('/:id/lost', (req, res) => {
  const pk = db.prepare('SELECT * FROM physical_keys WHERE id = ?').get(req.params.id);
  if (!pk) { req.session.flash = { error: 'Physical key not found.' }; return res.redirect('/physical-keys'); }
  const { lost_date, report_number, notes } = req.body;
  const user = req.session.user.username;
  const txDate = lost_date || new Date().toISOString().replace('T',' ').slice(0,19);

  db.prepare("UPDATE physical_keys SET status='lost', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(pk.id);

  // Close any open agreement
  const agmt = db.prepare('SELECT * FROM key_agreements WHERE physical_key_id = ? AND returned_date IS NULL').get(pk.id);
  if (agmt) db.prepare("UPDATE key_agreements SET returned_date=? WHERE id=?").run(txDate, agmt.id);

  db.prepare(`
    INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, notes)
    VALUES (?, 'lost', ?, ?, ?)
  `).run(pk.id, txDate, user, [notes, report_number ? `Report#: ${report_number}` : null].filter(Boolean).join(' · ') || null);

  db.prepare(`
    INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
    VALUES (?, ?, NULL, ?, ?, 'lost', ?)
  `).run(pk.id, agmt ? agmt.staff_id : null, txDate, user, notes || null);

  auditLog('LOST', 'PHYSICAL_KEY', pk.id, pk.stamp_number, null, null, user, notes || null);
  req.session.flash = { success: `Key ${pk.stamp_number} marked as lost.` };
  res.redirect(`/physical-keys/${pk.id}`);
});

// ══════════════════════════════════════════════════════════════════════════
// MARK DAMAGED
// ══════════════════════════════════════════════════════════════════════════
router.post('/:id/damaged', (req, res) => {
  const pk = db.prepare('SELECT * FROM physical_keys WHERE id = ?').get(req.params.id);
  if (!pk) { req.session.flash = { error: 'Physical key not found.' }; return res.redirect('/physical-keys'); }
  const { damage_date, witness, notes } = req.body;
  const user = req.session.user.username;
  const txDate = damage_date || new Date().toISOString().replace('T',' ').slice(0,19);

  db.prepare("UPDATE physical_keys SET status='damaged', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(pk.id);
  const agmt = db.prepare('SELECT * FROM key_agreements WHERE physical_key_id = ? AND returned_date IS NULL').get(pk.id);
  if (agmt) db.prepare("UPDATE key_agreements SET returned_date=? WHERE id=?").run(txDate, agmt.id);

  db.prepare(`
    INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, notes)
    VALUES (?, 'damaged', ?, ?, ?)
  `).run(pk.id, txDate, user, [notes, witness ? `Witness: ${witness}` : null].filter(Boolean).join(' · ') || null);

  db.prepare(`
    INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
    VALUES (?, ?, NULL, ?, ?, 'damaged', ?)
  `).run(pk.id, agmt ? agmt.staff_id : null, txDate, user, notes || null);

  auditLog('DAMAGED', 'PHYSICAL_KEY', pk.id, pk.stamp_number, null, null, user, notes || null);
  req.session.flash = { success: `Key ${pk.stamp_number} marked as damaged.` };
  res.redirect(`/physical-keys/${pk.id}`);
});

// ══════════════════════════════════════════════════════════════════════════
// MARK DESTROYED
// ══════════════════════════════════════════════════════════════════════════
router.post('/:id/destroyed', (req, res) => {
  const pk = db.prepare('SELECT * FROM physical_keys WHERE id = ?').get(req.params.id);
  if (!pk) { req.session.flash = { error: 'Physical key not found.' }; return res.redirect('/physical-keys'); }
  const { destroyed_date, witness, notes } = req.body;
  const user = req.session.user.username;
  const txDate = destroyed_date || new Date().toISOString().replace('T',' ').slice(0,19);

  db.prepare("UPDATE physical_keys SET status='destroyed', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(pk.id);
  const agmt = db.prepare('SELECT * FROM key_agreements WHERE physical_key_id = ? AND returned_date IS NULL').get(pk.id);
  if (agmt) db.prepare("UPDATE key_agreements SET returned_date=? WHERE id=?").run(txDate, agmt.id);

  db.prepare(`
    INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, notes)
    VALUES (?, 'destroyed', ?, ?, ?)
  `).run(pk.id, txDate, user, [notes, witness ? `Witness: ${witness}` : null].filter(Boolean).join(' · ') || null);

  db.prepare(`
    INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
    VALUES (?, ?, NULL, ?, ?, 'destroyed', ?)
  `).run(pk.id, agmt ? agmt.staff_id : null, txDate, user, notes || null);

  auditLog('DESTROYED', 'PHYSICAL_KEY', pk.id, pk.stamp_number, null, null, user, notes || null);
  req.session.flash = { success: `Key ${pk.stamp_number} marked as destroyed.` };
  res.redirect(`/physical-keys/${pk.id}`);
});

module.exports = router;
