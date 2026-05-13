/**
 * routes/keyReports.js
 * Reports for physical key copy tracking.
 * Mounts at /reports/keys
 */
const express = require('express');
const { db }  = require('../db');

const router = express.Router();

// ── CSV builder (same pattern as export.js) ────────────────────────────────
function toCSV(rows, columns) {
  const escape = v => {
    if (v == null || v === '') return '';
    const s = String(v);
    return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [
    columns.join(','),
    ...rows.map(row => columns.map(col => escape(row[col])).join(','))
  ];
  return lines.join('\r\n');
}

function sendCSV(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv); // UTF-8 BOM
}

// ══════════════════════════════════════════════════════════════════════════
// INDEX
// ══════════════════════════════════════════════════════════════════════════
router.get('/', (req, res) => {
  const counts = {
    total:      db.prepare('SELECT COUNT(*) AS c FROM physical_keys').get().c,
    active:     db.prepare("SELECT COUNT(*) AS c FROM physical_keys WHERE status='active'").get().c,
    outstanding: db.prepare(`
      SELECT COUNT(*) AS c FROM key_agreements WHERE returned_date IS NULL
    `).get().c,
    overdue: db.prepare(`
      SELECT COUNT(*) AS c FROM physical_keys
      WHERE status='active' AND expiry_date IS NOT NULL AND expiry_date < date('now')
    `).get().c,
  };
  res.render('reports/keys', { title: 'Key Copy Reports', counts });
});

// ══════════════════════════════════════════════════════════════════════════
// OUTSTANDING KEYS BY PERSON
// ══════════════════════════════════════════════════════════════════════════
router.get('/outstanding', (req, res) => {
  const { staff_id } = req.query;
  let query = `
    SELECT ka.id AS agreement_id, ka.issued_date, ka.expiry_date, ka.returned_date,
           pk.stamp_number, pk.status, k.key_number, k.level, ks.name AS system_name,
           s.id AS staff_id, s.first_name, s.last_name, s.department, s.status AS staff_status,
           kr.ring_number
    FROM key_agreements ka
    JOIN physical_keys pk ON pk.id = ka.physical_key_id
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    JOIN staff s ON s.id = ka.staff_id
    LEFT JOIN keyrings kr ON kr.id = pk.keytrak_ring_id
    WHERE ka.returned_date IS NULL
  `;
  const params = [];
  if (staff_id) { query += ' AND s.id = ?'; params.push(staff_id); }
  query += ' ORDER BY s.last_name, s.first_name, ka.issued_date';
  const rows = db.prepare(query).all(...params).map(r => ({
    ...r,
    isOverdue: r.expiry_date && new Date(r.expiry_date) < new Date()
  }));

  const allStaff = db.prepare('SELECT id, first_name, last_name FROM staff ORDER BY last_name, first_name').all();

  if (req.path.endsWith('.csv')) {
    return sendCSV(res, 'outstanding-keys.csv',
      toCSV(rows, ['stamp_number','key_number','system_name','first_name','last_name','department','issued_date','expiry_date','ring_number','status']));
  }

  res.render('reports/keys-outstanding', {
    title: 'Report: Outstanding Keys',
    rows, allStaff, filters: { staff_id: staff_id || '' }
  });
});

router.get('/outstanding.csv', (req, res, next) => {
  req.path = req.path; // forward to outstanding handler
  const rows = db.prepare(`
    SELECT pk.stamp_number, k.key_number, ks.name AS system_name,
           s.first_name, s.last_name, s.department,
           ka.issued_date, ka.expiry_date, kr.ring_number, pk.status
    FROM key_agreements ka
    JOIN physical_keys pk ON pk.id = ka.physical_key_id
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    JOIN staff s ON s.id = ka.staff_id
    LEFT JOIN keyrings kr ON kr.id = pk.keytrak_ring_id
    WHERE ka.returned_date IS NULL
    ORDER BY s.last_name, s.first_name, ka.issued_date
  `).all();
  sendCSV(res, 'outstanding-keys.csv',
    toCSV(rows, ['stamp_number','key_number','system_name','first_name','last_name','department','issued_date','expiry_date','ring_number','status']));
});

// ══════════════════════════════════════════════════════════════════════════
// EXPIRING KEYS (7 / 30 days)
// ══════════════════════════════════════════════════════════════════════════
router.get('/expiring', (req, res) => {
  const { days = '30' } = req.query;
  const daysNum = parseInt(days) || 30;

  const rows = db.prepare(`
    SELECT pk.id, pk.stamp_number, pk.expiry_date, pk.status,
           k.key_number, k.level, ks.name AS system_name,
           s.first_name, s.last_name, s.department, s.email,
           ka.issued_date, ka.id AS agreement_id,
           kr.ring_number
    FROM physical_keys pk
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN keyrings kr ON kr.id = pk.keytrak_ring_id
    LEFT JOIN key_agreements ka ON ka.physical_key_id = pk.id AND ka.returned_date IS NULL
    LEFT JOIN staff s ON s.id = ka.staff_id
    WHERE pk.status = 'active'
      AND pk.expiry_date IS NOT NULL
      AND pk.expiry_date >= date('now')
      AND pk.expiry_date <= date('now', '+' || ? || ' days')
    ORDER BY pk.expiry_date, pk.stamp_number
  `).all(daysNum);

  const overdueRows = db.prepare(`
    SELECT pk.id, pk.stamp_number, pk.expiry_date, pk.status,
           k.key_number, k.level, ks.name AS system_name,
           s.first_name, s.last_name, s.department, s.email,
           ka.issued_date, ka.id AS agreement_id,
           kr.ring_number
    FROM physical_keys pk
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN keyrings kr ON kr.id = pk.keytrak_ring_id
    LEFT JOIN key_agreements ka ON ka.physical_key_id = pk.id AND ka.returned_date IS NULL
    LEFT JOIN staff s ON s.id = ka.staff_id
    WHERE pk.status = 'active'
      AND pk.expiry_date IS NOT NULL
      AND pk.expiry_date < date('now')
    ORDER BY pk.expiry_date, pk.stamp_number
  `).all();

  res.render('reports/keys-expiring', {
    title: 'Report: Expiring Keys',
    rows, overdueRows, filters: { days: String(daysNum) }
  });
});

router.get('/expiring.csv', (req, res) => {
  const rows = db.prepare(`
    SELECT pk.stamp_number, pk.expiry_date, pk.status,
           k.key_number, ks.name AS system_name,
           s.first_name, s.last_name, s.department, s.email,
           ka.issued_date
    FROM physical_keys pk
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN key_agreements ka ON ka.physical_key_id = pk.id AND ka.returned_date IS NULL
    LEFT JOIN staff s ON s.id = ka.staff_id
    WHERE pk.status = 'active' AND pk.expiry_date IS NOT NULL AND pk.expiry_date <= date('now','+30 days')
    ORDER BY pk.expiry_date
  `).all();
  sendCSV(res, 'expiring-keys.csv',
    toCSV(rows, ['stamp_number','key_number','system_name','first_name','last_name','department','email','issued_date','expiry_date','status']));
});

// ══════════════════════════════════════════════════════════════════════════
// LOST KEY HISTORY
// ══════════════════════════════════════════════════════════════════════════
router.get('/lost-history', (req, res) => {
  const rows = db.prepare(`
    SELECT pk.id, pk.stamp_number, pk.status, pk.created_at AS received_date,
           k.key_number, k.level, ks.name AS system_name,
           kt.transaction_date AS lost_date, kt.notes AS lost_notes, kt.performed_by,
           s.first_name, s.last_name, s.department
    FROM physical_keys pk
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    JOIN key_transactions kt ON kt.physical_key_id = pk.id AND kt.transaction_type = 'lost'
    LEFT JOIN staff s ON s.id = kt.assigned_to_staff_id
    WHERE pk.status IN ('lost','destroyed')
    ORDER BY kt.transaction_date DESC
  `).all();

  res.render('reports/keys-lost', { title: 'Report: Lost Key History', rows });
});

router.get('/lost-history.csv', (req, res) => {
  const rows = db.prepare(`
    SELECT pk.stamp_number, k.key_number, ks.name AS system_name,
           kt.transaction_date AS lost_date, kt.notes, kt.performed_by,
           s.first_name, s.last_name, s.department
    FROM physical_keys pk
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    JOIN key_transactions kt ON kt.physical_key_id = pk.id AND kt.transaction_type = 'lost'
    LEFT JOIN staff s ON s.id = kt.assigned_to_staff_id
    ORDER BY kt.transaction_date DESC
  `).all();
  sendCSV(res, 'lost-keys.csv',
    toCSV(rows, ['stamp_number','key_number','system_name','first_name','last_name','department','lost_date','notes','performed_by']));
});

// ══════════════════════════════════════════════════════════════════════════
// LOCKSMITH TRANSACTION HISTORY
// ══════════════════════════════════════════════════════════════════════════
router.get('/locksmith-history', (req, res) => {
  const { from_date, to_date } = req.query;
  let query = `
    SELECT kt.*, pk.stamp_number, k.key_number, ks.name AS system_name,
           lk.stamp_number AS linked_stamp
    FROM key_transactions kt
    JOIN physical_keys pk ON pk.id = kt.physical_key_id
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN physical_keys lk ON lk.id = kt.linked_key_id
    WHERE kt.transaction_type IN ('issued_from_locksmith','replaced')
  `;
  const params = [];
  if (from_date) { query += ' AND date(kt.transaction_date) >= ?'; params.push(from_date); }
  if (to_date)   { query += ' AND date(kt.transaction_date) <= ?'; params.push(to_date); }
  query += ' ORDER BY kt.transaction_date DESC';

  const rows = db.prepare(query).all(...params);
  res.render('reports/keys-locksmith', {
    title: 'Report: Locksmith History',
    rows, filters: { from_date: from_date || '', to_date: to_date || '' }
  });
});

router.get('/locksmith-history.csv', (req, res) => {
  const { from_date, to_date } = req.query;
  let query = `
    SELECT kt.transaction_date, kt.transaction_type, pk.stamp_number, k.key_number,
           ks.name AS system_name, kt.performed_by, kt.notes, kt.receipt_filename,
           lk.stamp_number AS linked_stamp
    FROM key_transactions kt
    JOIN physical_keys pk ON pk.id = kt.physical_key_id
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN physical_keys lk ON lk.id = kt.linked_key_id
    WHERE kt.transaction_type IN ('issued_from_locksmith','replaced')
  `;
  const params = [];
  if (from_date) { query += ' AND date(kt.transaction_date) >= ?'; params.push(from_date); }
  if (to_date)   { query += ' AND date(kt.transaction_date) <= ?'; params.push(to_date); }
  query += ' ORDER BY kt.transaction_date DESC';
  const rows = db.prepare(query).all(...params);
  sendCSV(res, 'locksmith-history.csv',
    toCSV(rows, ['transaction_date','transaction_type','stamp_number','key_number','system_name','performed_by','notes','receipt_filename','linked_stamp']));
});

// ══════════════════════════════════════════════════════════════════════════
// FULL AUDIT LOG
// ══════════════════════════════════════════════════════════════════════════
router.get('/audit-log', (req, res) => {
  const { from_date, to_date, type, q } = req.query;
  let query = `
    SELECT kcl.*,
           pk.stamp_number, k.key_number, ks.name AS system_name,
           fs.first_name AS from_first, fs.last_name AS from_last,
           ts.first_name AS to_first,   ts.last_name AS to_last
    FROM key_custody_log kcl
    JOIN physical_keys pk ON pk.id = kcl.physical_key_id
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN staff fs ON fs.id = kcl.from_staff_id
    LEFT JOIN staff ts ON ts.id = kcl.to_staff_id
    WHERE 1=1
  `;
  const params = [];
  if (from_date) { query += ' AND date(kcl.transferred_date) >= ?'; params.push(from_date); }
  if (to_date)   { query += ' AND date(kcl.transferred_date) <= ?'; params.push(to_date); }
  if (type)      { query += ' AND kcl.transaction_type = ?'; params.push(type); }
  if (q) {
    query += ' AND (pk.stamp_number LIKE ? OR k.key_number LIKE ? OR ks.name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  query += ' ORDER BY kcl.id DESC LIMIT 500';

  const rows = db.prepare(query).all(...params);
  const txTypes = db.prepare('SELECT DISTINCT transaction_type FROM key_custody_log ORDER BY transaction_type').all().map(r => r.transaction_type);

  res.render('reports/keys-audit', {
    title: 'Report: Key Custody Audit Log',
    rows, txTypes, filters: { from_date: from_date || '', to_date: to_date || '', type: type || '', q: q || '' }
  });
});

router.get('/audit-log.csv', (req, res) => {
  const { from_date, to_date, type } = req.query;
  let query = `
    SELECT kcl.transferred_date, kcl.transaction_type,
           pk.stamp_number, k.key_number, ks.name AS system_name,
           fs.first_name || ' ' || fs.last_name AS from_person,
           ts.first_name || ' ' || ts.last_name AS to_person,
           kcl.performed_by, kcl.notes
    FROM key_custody_log kcl
    JOIN physical_keys pk ON pk.id = kcl.physical_key_id
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN staff fs ON fs.id = kcl.from_staff_id
    LEFT JOIN staff ts ON ts.id = kcl.to_staff_id
    WHERE 1=1
  `;
  const params = [];
  if (from_date) { query += ' AND date(kcl.transferred_date) >= ?'; params.push(from_date); }
  if (to_date)   { query += ' AND date(kcl.transferred_date) <= ?'; params.push(to_date); }
  if (type)      { query += ' AND kcl.transaction_type = ?'; params.push(type); }
  query += ' ORDER BY kcl.id DESC';
  const rows = db.prepare(query).all(...params);
  sendCSV(res, 'key-audit-log.csv',
    toCSV(rows, ['transferred_date','transaction_type','stamp_number','key_number','system_name','from_person','to_person','performed_by','notes']));
});

module.exports = router;
