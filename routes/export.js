const express = require('express');
const { db }  = require('../db');

const router = express.Router();

// ── CSV builder ────────────────────────────────────────────────────────────
function toCSV(rows, columns) {
  const escape = v => {
    if (v == null || v === '') return '';
    const s = String(v);
    return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
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
  // UTF-8 BOM so Excel opens it correctly
  res.send('﻿' + csv);
}

// ── GET /export  (page) ────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const counts = {
    doors:          db.prepare('SELECT COUNT(*) AS c FROM doors').get().c,
    keys:           db.prepare('SELECT COUNT(*) AS c FROM keys').get().c,
    users:          db.prepare('SELECT COUNT(*) AS c FROM staff').get().c,
    combinations:   db.prepare('SELECT COUNT(*) AS c FROM key_door_access').get().c,
    systemAccounts: db.prepare('SELECT COUNT(*) AS c FROM system_accounts').get().c,
  };
  res.render('export', { title: 'CSV Export', counts });
});

// ── GET /export/doors ──────────────────────────────────────────────────────
router.get('/doors', (req, res) => {
  const rows = db.prepare(`
    SELECT name, building, floor,
           location   AS room,
           notes      AS description,
           access_type AS door_type,
           door_number
    FROM doors ORDER BY building NULLS LAST, floor NULLS LAST, name
  `).all();
  sendCSV(res, 'doors.csv', toCSV(rows, ['name','building','floor','room','description','door_type','door_number']));
});

// ── GET /export/keys ───────────────────────────────────────────────────────
router.get('/keys', (req, res) => {
  const rows = db.prepare(`
    SELECT k.key_number,
           ks.name            AS system_name,
           k.level,
           pk.key_number      AS parent_key_number,
           k.bitting,
           k.keyway,
           k.key_blank,
           k.notes
    FROM keys k
    JOIN  key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN keys pk    ON pk.id = k.parent_key_id
    ORDER BY ks.name, k.level, k.key_number
  `).all();
  sendCSV(res, 'keys.csv', toCSV(rows, ['key_number','system_name','level','parent_key_number','bitting','keyway','key_blank','notes']));
});

// ── GET /export/users ──────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const rows = db.prepare(`
    SELECT first_name, last_name, employee_id, department, title,
           email, phone, start_date, status, notes
    FROM staff ORDER BY last_name, first_name
  `).all();
  sendCSV(res, 'users.csv', toCSV(rows, ['first_name','last_name','employee_id','department','title','email','phone','start_date','status','notes']));
});

// ── GET /export/combinations ───────────────────────────────────────────────
router.get('/combinations', (req, res) => {
  const rows = db.prepare(`
    SELECT k.key_number,
           ks.name  AS system_name,
           d.name   AS door_name
    FROM key_door_access kda
    JOIN keys        k  ON k.id  = kda.key_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    JOIN doors       d  ON d.id  = kda.door_id
    ORDER BY ks.name, k.key_number, d.name
  `).all();
  sendCSV(res, 'combinations.csv', toCSV(rows, ['key_number','system_name','door_name']));
});

// ── GET /export/system-accounts ───────────────────────────────────────────
router.get('/system-accounts', (req, res) => {
  const rows = db.prepare(`
    SELECT system_name    AS account_name,
           account_username AS username,
           account_password AS password,
           url,
           category        AS access_level,
           notes
    FROM system_accounts ORDER BY system_name, account_username
  `).all();
  sendCSV(res, 'system-accounts.csv', toCSV(rows, ['account_name','username','password','url','access_level','notes']));
});

module.exports = router;
