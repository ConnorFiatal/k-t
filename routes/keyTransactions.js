/**
 * routes/keyTransactions.js
 * Single-page transaction menu for all physical key lifecycle events.
 * Mounts at /key-transactions
 */
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { db, auditLog } = require('../db');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

// ── Receipt upload ─────────────────────────────────────────────────────────
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

// ── Page data helper ───────────────────────────────────────────────────────
function getPageData() {
  const activePhysicalKeys = db.prepare(`
    SELECT pk.id, pk.stamp_number, pk.status, k.key_number, ks.name AS system_name
    FROM physical_keys pk
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    WHERE pk.status = 'active'
    ORDER BY pk.stamp_number
  `).all();

  const issuedKeys = db.prepare(`
    SELECT pk.id, pk.stamp_number, k.key_number, ks.name AS system_name,
           s.first_name, s.last_name
    FROM physical_keys pk
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    JOIN key_agreements ka ON ka.physical_key_id = pk.id AND ka.returned_date IS NULL
    JOIN staff s ON s.id = ka.staff_id
    WHERE pk.status = 'active'
    ORDER BY pk.stamp_number
  `).all();

  const nonActiveKeys = db.prepare(`
    SELECT pk.id, pk.stamp_number, pk.status, k.key_number, ks.name AS system_name
    FROM physical_keys pk
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    WHERE pk.status IN ('lost','damaged')
    ORDER BY pk.stamp_number
  `).all();

  const allKeys = db.prepare(`
    SELECT k.id, k.key_number, k.level, ks.name AS system_name
    FROM keys k JOIN key_systems ks ON ks.id = k.key_system_id
    ORDER BY ks.name, k.level, k.key_number
  `).all();

  const keyrings = db.prepare('SELECT id, ring_number, description FROM keyrings ORDER BY ring_number').all();
  const activeStaff = db.prepare("SELECT id, first_name, last_name, department FROM staff WHERE status='active' ORDER BY last_name, first_name").all();

  // Recent transactions
  const recent = db.prepare(`
    SELECT kt.*, pk.stamp_number, s.first_name, s.last_name
    FROM key_transactions kt
    JOIN physical_keys pk ON pk.id = kt.physical_key_id
    LEFT JOIN staff s ON s.id = kt.assigned_to_staff_id
    ORDER BY kt.id DESC LIMIT 25
  `).all();

  return { activePhysicalKeys, issuedKeys, nonActiveKeys, allKeys, keyrings, activeStaff, recent };
}

// ══════════════════════════════════════════════════════════════════════════
// GET / — show transaction page
// ══════════════════════════════════════════════════════════════════════════
router.get('/', requirePermission('key_transactions.view'), (req, res) => {
  res.render('key-transactions/index', {
    title: 'Key Transactions', ...getPageData()
  });
});

// ══════════════════════════════════════════════════════════════════════════
// POST /issued-from-locksmith — receive new key from locksmith
// ══════════════════════════════════════════════════════════════════════════
router.post('/issued-from-locksmith', requirePermission('key_transactions.create'), receiptUpload.single('receipt'), (req, res) => {
  const { stamp_number, key_type_id, keytrak_ring_id, transaction_date, notes } = req.body;
  if (!stamp_number || !key_type_id) {
    req.session.flash = { error: 'Stamp number and key type are required.' };
    return res.redirect('/key-transactions');
  }
  const receiptFilename = req.file ? req.file.filename : null;
  const user = req.session.user.username;
  const txDate = transaction_date || new Date().toISOString().replace('T', ' ').slice(0, 19);

  try {
    const pk = db.prepare(`
      INSERT INTO physical_keys (stamp_number, key_type_id, keytrak_ring_id, notes)
      VALUES (?, ?, ?, ?)
    `).run(stamp_number.trim(), key_type_id, keytrak_ring_id || null, notes || null);

    const pkId = pk.lastInsertRowid;

    db.prepare(`
      INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, notes, receipt_filename)
      VALUES (?, 'issued_from_locksmith', ?, ?, ?, ?)
    `).run(pkId, txDate, user, notes || null, receiptFilename);

    db.prepare(`
      INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
      VALUES (?, NULL, NULL, ?, ?, 'issued_from_locksmith', ?)
    `).run(pkId, txDate, user, notes || null);

    auditLog('CREATE', 'PHYSICAL_KEY', pkId, stamp_number, null, null, user);
    req.session.flash = { success: `Key copy ${stamp_number} received from locksmith.` };
    res.redirect(`/physical-keys/${pkId}`);
  } catch (err) {
    req.session.flash = { error: err.message.includes('UNIQUE') ? `Stamp number "${stamp_number}" already exists.` : err.message };
    res.redirect('/key-transactions');
  }
});

// ══════════════════════════════════════════════════════════════════════════
// POST /issued-to-person — issue existing key to a staff member
// ══════════════════════════════════════════════════════════════════════════
router.post('/issued-to-person', requirePermission('key_transactions.create'), (req, res) => {
  const { physical_key_id, staff_id, issued_date, expiry_date, notes } = req.body;
  const pk  = physical_key_id ? db.prepare(`SELECT pk.*, k.key_number, ks.name AS system_name FROM physical_keys pk JOIN keys k ON k.id = pk.key_type_id JOIN key_systems ks ON ks.id = k.key_system_id WHERE pk.id = ?`).get(physical_key_id) : null;
  const staff = staff_id ? db.prepare('SELECT * FROM staff WHERE id = ?').get(staff_id) : null;

  if (!pk || !staff || !issued_date) {
    req.session.flash = { error: 'Physical key, staff member, and date are required.' };
    return res.redirect('/key-transactions');
  }
  if (pk.status !== 'active') {
    req.session.flash = { error: `Key ${pk.stamp_number} is ${pk.status} — cannot issue.` };
    return res.redirect('/key-transactions');
  }
  const existing = db.prepare('SELECT id FROM key_agreements WHERE physical_key_id = ? AND returned_date IS NULL').get(pk.id);
  if (existing) {
    req.session.flash = { error: `Key ${pk.stamp_number} is already issued. Return it first.` };
    return res.redirect('/key-transactions');
  }

  const user = req.session.user.username;
  const ackText = `I, ${staff.first_name} ${staff.last_name}, acknowledge receipt of key copy ${pk.stamp_number} (${pk.key_number} — ${pk.system_name}). I understand I am personally responsible for the safekeeping of this key. In the event of loss or theft I will immediately notify the responsible administrator. I will not duplicate this key or allow unauthorized use. I will return this key upon request or upon termination of employment.`;

  const agmt = db.prepare(`
    INSERT INTO key_agreements (physical_key_id, staff_id, issued_date, expiry_date, acknowledgment_text)
    VALUES (?, ?, ?, ?, ?)
  `).run(pk.id, staff.id, issued_date, expiry_date || null, ackText);

  db.prepare(`
    INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, assigned_to_staff_id, notes)
    VALUES (?, 'issued_to_person', ?, ?, ?, ?)
  `).run(pk.id, issued_date, user, staff.id, notes || null);

  db.prepare(`
    INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
    VALUES (?, NULL, ?, ?, ?, 'issued_to_person', ?)
  `).run(pk.id, staff.id, issued_date, user, notes || null);

  if (expiry_date) {
    db.prepare('UPDATE physical_keys SET expiry_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(expiry_date, pk.id);
  }

  auditLog('ISSUE', 'PHYSICAL_KEY', pk.id, pk.stamp_number, staff.id, `${staff.first_name} ${staff.last_name}`, user);
  req.session.flash = { success: `Key ${pk.stamp_number} issued to ${staff.first_name} ${staff.last_name}.` };
  res.redirect(`/key-agreements/${agmt.lastInsertRowid}`);
});

// ══════════════════════════════════════════════════════════════════════════
// POST /returned — record return
// ══════════════════════════════════════════════════════════════════════════
router.post('/returned', requirePermission('key_transactions.create'), (req, res) => {
  const { physical_key_id, returned_date, condition, notes } = req.body;
  const pk = physical_key_id ? db.prepare('SELECT * FROM physical_keys WHERE id = ?').get(physical_key_id) : null;
  if (!pk || !returned_date) {
    req.session.flash = { error: 'Physical key and return date are required.' };
    return res.redirect('/key-transactions');
  }
  const agmt = db.prepare('SELECT * FROM key_agreements WHERE physical_key_id = ? AND returned_date IS NULL ORDER BY id DESC LIMIT 1').get(pk.id);
  if (!agmt) {
    req.session.flash = { error: `No active issuance for key ${pk.stamp_number}.` };
    return res.redirect('/key-transactions');
  }

  const user = req.session.user.username;
  const fullNotes = [notes, condition ? `Condition: ${condition}` : null].filter(Boolean).join(' · ') || null;

  db.prepare('UPDATE key_agreements SET returned_date=? WHERE id=?').run(returned_date, agmt.id);

  db.prepare(`
    INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, assigned_to_staff_id, notes)
    VALUES (?, 'returned', ?, ?, ?, ?)
  `).run(pk.id, returned_date, user, agmt.staff_id, fullNotes);

  db.prepare(`
    INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
    VALUES (?, ?, NULL, ?, ?, 'returned', ?)
  `).run(pk.id, agmt.staff_id, returned_date, user, fullNotes);

  auditLog('RETURN', 'PHYSICAL_KEY', pk.id, pk.stamp_number, agmt.staff_id, null, user, fullNotes);
  req.session.flash = { success: `Key ${pk.stamp_number} return recorded.` };
  res.redirect(`/physical-keys/${pk.id}`);
});

// ══════════════════════════════════════════════════════════════════════════
// POST /lost — record loss
// ══════════════════════════════════════════════════════════════════════════
router.post('/lost', requirePermission('key_transactions.create'), (req, res) => {
  const { physical_key_id, lost_date, report_number, notes } = req.body;
  const pk = physical_key_id ? db.prepare('SELECT * FROM physical_keys WHERE id = ?').get(physical_key_id) : null;
  if (!pk) { req.session.flash = { error: 'Select a valid key.' }; return res.redirect('/key-transactions'); }

  const user = req.session.user.username;
  const txDate = lost_date || new Date().toISOString().replace('T',' ').slice(0,19);

  db.prepare("UPDATE physical_keys SET status='lost', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(pk.id);
  const agmt = db.prepare('SELECT * FROM key_agreements WHERE physical_key_id = ? AND returned_date IS NULL').get(pk.id);
  if (agmt) db.prepare('UPDATE key_agreements SET returned_date=? WHERE id=?').run(txDate, agmt.id);

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
// POST /damaged-destroyed — record damage or destruction
// ══════════════════════════════════════════════════════════════════════════
router.post('/damaged-destroyed', requirePermission('key_transactions.create'), (req, res) => {
  const { physical_key_id, status_type, event_date, witness, notes } = req.body;
  const newStatus = status_type === 'destroyed' ? 'destroyed' : 'damaged';
  const txType    = newStatus;
  const pk = physical_key_id ? db.prepare('SELECT * FROM physical_keys WHERE id = ?').get(physical_key_id) : null;
  if (!pk) { req.session.flash = { error: 'Select a valid key.' }; return res.redirect('/key-transactions'); }

  const user = req.session.user.username;
  const txDate = event_date || new Date().toISOString().replace('T',' ').slice(0,19);

  db.prepare(`UPDATE physical_keys SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(newStatus, pk.id);
  const agmt = db.prepare('SELECT * FROM key_agreements WHERE physical_key_id = ? AND returned_date IS NULL').get(pk.id);
  if (agmt) db.prepare('UPDATE key_agreements SET returned_date=? WHERE id=?').run(txDate, agmt.id);

  db.prepare(`
    INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(pk.id, txType, txDate, user, [notes, witness ? `Witness: ${witness}` : null].filter(Boolean).join(' · ') || null);

  db.prepare(`
    INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
    VALUES (?, ?, NULL, ?, ?, ?, ?)
  `).run(pk.id, agmt ? agmt.staff_id : null, txDate, user, txType, notes || null);

  auditLog(newStatus.toUpperCase(), 'PHYSICAL_KEY', pk.id, pk.stamp_number, null, null, user, notes || null);
  req.session.flash = { success: `Key ${pk.stamp_number} marked as ${newStatus}.` };
  res.redirect(`/physical-keys/${pk.id}`);
});

// ══════════════════════════════════════════════════════════════════════════
// POST /replaced — replace a key copy with a new one from locksmith
// ══════════════════════════════════════════════════════════════════════════
router.post('/replaced', requirePermission('key_transactions.create'), receiptUpload.single('receipt'), (req, res) => {
  const { old_key_id, new_stamp_number, transaction_date, notes } = req.body;
  const oldKey = old_key_id ? db.prepare(`
    SELECT pk.*, k.key_number, k.id AS key_type_id_val, ks.name AS system_name, pk.keytrak_ring_id
    FROM physical_keys pk
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    WHERE pk.id = ?
  `).get(old_key_id) : null;

  if (!oldKey || !new_stamp_number) {
    req.session.flash = { error: 'Old key and new stamp number are required.' };
    return res.redirect('/key-transactions');
  }

  const receiptFilename = req.file ? req.file.filename : null;
  const user = req.session.user.username;
  const txDate = transaction_date || new Date().toISOString().replace('T', ' ').slice(0, 19);

  try {
    // Mark old key as destroyed
    db.prepare("UPDATE physical_keys SET status='destroyed', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(oldKey.id);

    // Create new key with same type
    const newPk = db.prepare(`
      INSERT INTO physical_keys (stamp_number, key_type_id, keytrak_ring_id, notes)
      VALUES (?, ?, ?, ?)
    `).run(new_stamp_number.trim(), oldKey.key_type_id, oldKey.keytrak_ring_id, notes || null);
    const newPkId = newPk.lastInsertRowid;

    // Transaction on old key
    db.prepare(`
      INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, notes, receipt_filename, linked_key_id)
      VALUES (?, 'replaced', ?, ?, ?, ?, ?)
    `).run(oldKey.id, txDate, user, notes || null, receiptFilename, newPkId);

    // Transaction on new key
    db.prepare(`
      INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, notes, receipt_filename, linked_key_id)
      VALUES (?, 'issued_from_locksmith', ?, ?, ?, ?, ?)
    `).run(newPkId, txDate, user, notes || null, receiptFilename, oldKey.id);

    // Custody log for old key
    const oldAgmt = db.prepare('SELECT * FROM key_agreements WHERE physical_key_id = ? AND returned_date IS NULL').get(oldKey.id);
    if (oldAgmt) db.prepare('UPDATE key_agreements SET returned_date=? WHERE id=?').run(txDate, oldAgmt.id);

    db.prepare(`
      INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
      VALUES (?, ?, NULL, ?, ?, 'replaced', ?)
    `).run(oldKey.id, oldAgmt ? oldAgmt.staff_id : null, txDate, user, notes || null);

    db.prepare(`
      INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes)
      VALUES (?, NULL, NULL, ?, ?, 'issued_from_locksmith', ?)
    `).run(newPkId, txDate, user, notes || null);

    auditLog('REPLACE', 'PHYSICAL_KEY', oldKey.id, oldKey.stamp_number, null, null, user, `Replaced by ${new_stamp_number}`);
    req.session.flash = { success: `Key ${oldKey.stamp_number} replaced by new key ${new_stamp_number}.` };
    res.redirect(`/physical-keys/${newPkId}`);
  } catch (err) {
    req.session.flash = { error: err.message.includes('UNIQUE') ? `Stamp number "${new_stamp_number}" already exists.` : err.message };
    res.redirect('/key-transactions');
  }
});

module.exports = router;
