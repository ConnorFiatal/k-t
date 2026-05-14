const express = require('express');
const { db, auditLog } = require('../db');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

router.get('/', requirePermission('staff.view'), (req, res) => {
  const { status, q } = req.query;
  let query = 'SELECT * FROM staff WHERE 1=1';
  const params = [];

  if (status && status !== 'all') {
    query += ' AND status = ?';
    params.push(status);
  } else if (!status) {
    query += ' AND status = ?';
    params.push('active');
  }

  if (q) {
    query += ' AND (first_name LIKE ? OR last_name LIKE ? OR employee_id LIKE ? OR department LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  query += ' ORDER BY last_name, first_name';
  const staff = db.prepare(query).all(...params);
  res.render('staff/index', { title: 'Staff', staff, q: q || '', status: status || 'active' });
});

router.get('/new', requirePermission('staff.create'), (req, res) => {
  res.render('staff/form', { title: 'New Staff Member', staff: null, action: '/staff' });
});

router.post('/', requirePermission('staff.create'), (req, res) => {
  const { first_name, last_name, employee_id, department, title, email, phone, start_date, notes } = req.body;
  if (!first_name || !last_name) {
    req.session.flash = { error: 'First and last name are required.' };
    return res.redirect('/staff/new');
  }
  try {
    const result = db.prepare(`
      INSERT INTO staff (first_name, last_name, employee_id, department, title, email, phone, start_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(first_name.trim(), last_name.trim(), employee_id || null, department || null, title || null, email || null, phone || null, start_date || null, notes || null);

    const fullName = `${first_name.trim()} ${last_name.trim()}`;
    auditLog('CREATE', 'STAFF', result.lastInsertRowid, fullName, result.lastInsertRowid, fullName, req.session.user.username);
    req.session.flash = { success: `Staff member ${first_name} ${last_name} created.` };
    res.redirect(`/staff/${result.lastInsertRowid}`);
  } catch (err) {
    req.session.flash = { error: err.message.includes('UNIQUE') ? 'Employee ID already exists.' : 'Error creating staff member.' };
    res.redirect('/staff/new');
  }
});

router.get('/:id', requirePermission('staff.view'), (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!staff) { req.session.flash = { error: 'Staff member not found.' }; return res.redirect('/staff'); }

  const safeAccess = db.prepare(`
    SELECT sa.*, s.name AS safe_name, s.location FROM safe_access sa
    JOIN safes s ON s.id = sa.safe_id WHERE sa.staff_id = ?
  `).all(staff.id);

  const keyrings = db.prepare(`
    SELECT ka.*, k.ring_number, k.description, k.location FROM keyring_authorizations ka
    JOIN keyrings k ON k.id = ka.keyring_id WHERE ka.staff_id = ?
  `).all(staff.id);

  const systemAccounts = db.prepare(`
    SELECT saa.*, a.system_name, a.account_username, a.category FROM system_account_access saa
    JOIN system_accounts a ON a.id = saa.account_id WHERE saa.staff_id = ?
  `).all(staff.id);

  res.render('staff/detail', { title: `${staff.first_name} ${staff.last_name}`, staff, safeAccess, keyrings, systemAccounts });
});

router.get('/:id/edit', requirePermission('staff.edit'), (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!staff) { req.session.flash = { error: 'Staff member not found.' }; return res.redirect('/staff'); }
  res.render('staff/form', { title: `Edit ${staff.first_name} ${staff.last_name}`, staff, action: `/staff/${staff.id}` });
});

router.post('/:id', requirePermission('staff.edit'), (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!staff) { req.session.flash = { error: 'Staff member not found.' }; return res.redirect('/staff'); }

  const { first_name, last_name, employee_id, department, title, email, phone, start_date, notes } = req.body;
  if (!first_name || !last_name) {
    req.session.flash = { error: 'First and last name are required.' };
    return res.redirect(`/staff/${req.params.id}/edit`);
  }

  try {
    db.prepare(`
      UPDATE staff SET first_name=?, last_name=?, employee_id=?, department=?, title=?, email=?, phone=?, start_date=?, notes=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(first_name.trim(), last_name.trim(), employee_id || null, department || null, title || null, email || null, phone || null, start_date || null, notes || null, staff.id);

    const fullName = `${first_name.trim()} ${last_name.trim()}`;
    auditLog('UPDATE', 'STAFF', staff.id, fullName, staff.id, fullName, req.session.user.username);
    req.session.flash = { success: 'Staff member updated.' };
    res.redirect(`/staff/${staff.id}`);
  } catch (err) {
    req.session.flash = { error: err.message.includes('UNIQUE') ? 'Employee ID already exists.' : 'Error updating staff member.' };
    res.redirect(`/staff/${staff.id}/edit`);
  }
});

router.post('/:id/terminate', requirePermission('staff.edit'), (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!staff) { req.session.flash = { error: 'Staff member not found.' }; return res.redirect('/staff'); }

  db.prepare("UPDATE staff SET status='terminated', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(staff.id);
  auditLog('TERMINATE', 'STAFF', staff.id, `${staff.first_name} ${staff.last_name}`, staff.id, `${staff.first_name} ${staff.last_name}`, req.session.user.username);

  req.session.flash = { success: `${staff.first_name} ${staff.last_name} marked as terminated.` };
  res.redirect(`/staff/${staff.id}/termination`);
});

router.post('/:id/reactivate', requirePermission('staff.edit'), (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!staff) { req.session.flash = { error: 'Staff member not found.' }; return res.redirect('/staff'); }

  db.prepare("UPDATE staff SET status='active', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(staff.id);
  auditLog('REACTIVATE', 'STAFF', staff.id, `${staff.first_name} ${staff.last_name}`, staff.id, `${staff.first_name} ${staff.last_name}`, req.session.user.username);
  req.session.flash = { success: `${staff.first_name} ${staff.last_name} reactivated.` };
  res.redirect(`/staff/${staff.id}`);
});

router.get('/:id/termination', requirePermission('staff.view'), (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!staff) { req.session.flash = { error: 'Staff member not found.' }; return res.redirect('/staff'); }

  const safeAccess = db.prepare(`
    SELECT sa.*, s.name AS safe_name, s.location FROM safe_access sa
    JOIN safes s ON s.id = sa.safe_id WHERE sa.staff_id = ?
  `).all(staff.id);

  const keyrings = db.prepare(`
    SELECT ka.*, k.ring_number, k.description, k.location FROM keyring_authorizations ka
    JOIN keyrings k ON k.id = ka.keyring_id WHERE ka.staff_id = ?
  `).all(staff.id);

  const systemAccounts = db.prepare(`
    SELECT saa.*, a.system_name, a.account_username, a.category FROM system_account_access saa
    JOIN system_accounts a ON a.id = saa.account_id WHERE saa.staff_id = ?
  `).all(staff.id);

  const totalAccess = safeAccess.length + keyrings.length + systemAccounts.length;
  res.render('staff/termination', { title: `Termination Checklist — ${staff.first_name} ${staff.last_name}`, staff, safeAccess, keyrings, systemAccounts, totalAccess });
});

router.post('/:id/revoke-all', requirePermission('staff.edit'), (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!staff) { req.session.flash = { error: 'Staff member not found.' }; return res.redirect('/staff'); }

  const staffName = `${staff.first_name} ${staff.last_name}`;
  const admin = req.session.user.username;

  const safeAccess = db.prepare('SELECT sa.*, s.name AS safe_name FROM safe_access sa JOIN safes s ON s.id = sa.safe_id WHERE sa.staff_id = ?').all(staff.id);
  safeAccess.forEach(sa => {
    db.prepare('DELETE FROM safe_access WHERE safe_id = ? AND staff_id = ?').run(sa.safe_id, staff.id);
    auditLog('REVOKE', 'SAFE', sa.safe_id, sa.safe_name, staff.id, staffName, admin, 'Termination revoke-all');
  });

  const keyrings = db.prepare('SELECT ka.*, k.ring_number FROM keyring_authorizations ka JOIN keyrings k ON k.id = ka.keyring_id WHERE ka.staff_id = ?').all(staff.id);
  keyrings.forEach(ka => {
    db.prepare('DELETE FROM keyring_authorizations WHERE keyring_id = ? AND staff_id = ?').run(ka.keyring_id, staff.id);
    auditLog('REVOKE', 'KEYRING', ka.keyring_id, ka.ring_number, staff.id, staffName, admin, 'Termination revoke-all');
  });

  const sysAccess = db.prepare('SELECT saa.*, a.system_name FROM system_account_access saa JOIN system_accounts a ON a.id = saa.account_id WHERE saa.staff_id = ?').all(staff.id);
  sysAccess.forEach(saa => {
    db.prepare('DELETE FROM system_account_access WHERE account_id = ? AND staff_id = ?').run(saa.account_id, staff.id);
    auditLog('REVOKE', 'SYSTEM_ACCOUNT', saa.account_id, saa.system_name, staff.id, staffName, admin, 'Termination revoke-all');
  });

  const total = safeAccess.length + keyrings.length + sysAccess.length;
  req.session.flash = { success: `All access revoked for ${staffName} (${total} item${total !== 1 ? 's' : ''}).` };
  res.redirect(`/staff/${staff.id}/termination`);
});

module.exports = router;
