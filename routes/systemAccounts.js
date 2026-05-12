const express = require('express');
const { db, auditLog } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const { category } = req.query;
  let query = `
    SELECT a.*, COUNT(saa.staff_id) AS access_count
    FROM system_accounts a LEFT JOIN system_account_access saa ON saa.account_id = a.id
  `;
  const params = [];
  if (category) { query += ' WHERE a.category = ?'; params.push(category); }
  query += ' GROUP BY a.id ORDER BY a.system_name, a.account_username';

  const accounts = db.prepare(query).all(...params);
  const categories = db.prepare("SELECT DISTINCT category FROM system_accounts WHERE category IS NOT NULL ORDER BY category").all().map(r => r.category);
  res.render('system-accounts/index', { title: 'System Accounts', accounts, categories, selectedCategory: category || '' });
});

router.get('/new', (req, res) => {
  res.render('system-accounts/form', { title: 'New System Account', account: null, action: '/system-accounts' });
});

router.post('/', (req, res) => {
  const { system_name, account_username, account_password, url, category, notes } = req.body;
  if (!system_name || !account_username) {
    req.session.flash = { error: 'System name and username are required.' };
    return res.redirect('/system-accounts/new');
  }
  const result = db.prepare('INSERT INTO system_accounts (system_name, account_username, account_password, url, category, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(system_name.trim(), account_username.trim(), account_password || null, url || null, category || null, notes || null);
  req.session.flash = { success: `Account "${system_name}" created.` };
  res.redirect(`/system-accounts/${result.lastInsertRowid}`);
});

router.get('/:id', (req, res) => {
  const account = db.prepare('SELECT * FROM system_accounts WHERE id = ?').get(req.params.id);
  if (!account) { req.session.flash = { error: 'Account not found.' }; return res.redirect('/system-accounts'); }

  const access = db.prepare(`
    SELECT saa.*, st.first_name, st.last_name, st.department, st.status
    FROM system_account_access saa JOIN staff st ON st.id = saa.staff_id
    WHERE saa.account_id = ? ORDER BY st.last_name, st.first_name
  `).all(account.id);

  const accessIds = access.map(a => a.staff_id);
  const eligibleStaff = db.prepare("SELECT * FROM staff WHERE status='active' ORDER BY last_name, first_name").all()
    .filter(s => !accessIds.includes(s.id));

  res.render('system-accounts/detail', { title: `${account.system_name} — ${account.account_username}`, account, access, eligibleStaff });
});

router.get('/:id/edit', (req, res) => {
  const account = db.prepare('SELECT * FROM system_accounts WHERE id = ?').get(req.params.id);
  if (!account) { req.session.flash = { error: 'Account not found.' }; return res.redirect('/system-accounts'); }
  res.render('system-accounts/form', { title: `Edit ${account.system_name}`, account, action: `/system-accounts/${account.id}` });
});

router.post('/:id', (req, res) => {
  const account = db.prepare('SELECT * FROM system_accounts WHERE id = ?').get(req.params.id);
  if (!account) { req.session.flash = { error: 'Account not found.' }; return res.redirect('/system-accounts'); }

  const { system_name, account_username, account_password, url, category, notes } = req.body;
  if (!system_name || !account_username) {
    req.session.flash = { error: 'System name and username are required.' };
    return res.redirect(`/system-accounts/${account.id}/edit`);
  }

  db.prepare('UPDATE system_accounts SET system_name=?, account_username=?, account_password=?, url=?, category=?, notes=? WHERE id=?')
    .run(system_name.trim(), account_username.trim(), account_password || null, url || null, category || null, notes || null, account.id);
  req.session.flash = { success: 'Account updated.' };
  res.redirect(`/system-accounts/${account.id}`);
});

router.post('/:id/grant', (req, res) => {
  const account = db.prepare('SELECT * FROM system_accounts WHERE id = ?').get(req.params.id);
  if (!account) { req.session.flash = { error: 'Account not found.' }; return res.redirect('/system-accounts'); }

  const { staff_id } = req.body;
  const staff = staff_id ? db.prepare('SELECT * FROM staff WHERE id = ?').get(staff_id) : null;
  if (!staff) { req.session.flash = { error: 'Select a valid staff member.' }; return res.redirect(`/system-accounts/${account.id}`); }

  try {
    db.prepare('INSERT INTO system_account_access (account_id, staff_id, granted_by) VALUES (?, ?, ?)').run(account.id, staff.id, req.session.user.username);
    auditLog('GRANT', 'SYSTEM_ACCOUNT', account.id, account.system_name, staff.id, `${staff.first_name} ${staff.last_name}`, req.session.user.username);
    req.session.flash = { success: `Access granted to ${staff.first_name} ${staff.last_name}.` };
  } catch {
    req.session.flash = { error: 'That person already has access.' };
  }
  res.redirect(`/system-accounts/${account.id}`);
});

router.post('/:id/revoke/:staffId', (req, res) => {
  const account = db.prepare('SELECT * FROM system_accounts WHERE id = ?').get(req.params.id);
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.staffId);
  if (!account || !staff) { req.session.flash = { error: 'Record not found.' }; return res.redirect('/system-accounts'); }

  db.prepare('DELETE FROM system_account_access WHERE account_id = ? AND staff_id = ?').run(account.id, staff.id);
  auditLog('REVOKE', 'SYSTEM_ACCOUNT', account.id, account.system_name, staff.id, `${staff.first_name} ${staff.last_name}`, req.session.user.username);
  req.session.flash = { success: `Access revoked for ${staff.first_name} ${staff.last_name}.` };
  res.redirect(`/system-accounts/${account.id}`);
});

module.exports = router;
