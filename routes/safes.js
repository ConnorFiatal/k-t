const express = require('express');
const { db, auditLog } = require('../db');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

router.get('/', requirePermission('safes.view'), (req, res) => {
  const safes = db.prepare(`
    SELECT s.*, COUNT(sa.staff_id) AS access_count
    FROM safes s LEFT JOIN safe_access sa ON sa.safe_id = s.id
    GROUP BY s.id ORDER BY s.name
  `).all();
  res.render('safes/index', { title: 'Safe Combinations', safes });
});

router.get('/new', requirePermission('safes.create'), (req, res) => {
  res.render('safes/form', { title: 'New Safe', safe: null, action: '/safes' });
});

router.post('/', requirePermission('safes.create'), (req, res) => {
  const { name, location, combination, notes } = req.body;
  if (!name || !combination) {
    req.session.flash = { error: 'Name and combination are required.' };
    return res.redirect('/safes/new');
  }
  const result = db.prepare('INSERT INTO safes (name, location, combination, notes) VALUES (?, ?, ?, ?)').run(name.trim(), location || null, combination.trim(), notes || null);
  auditLog('CREATE', 'SAFE', result.lastInsertRowid, name.trim(), null, null, req.session.user.username);
  req.session.flash = { success: `Safe "${name}" created.` };
  res.redirect(`/safes/${result.lastInsertRowid}`);
});

router.get('/:id', requirePermission('safes.view'), (req, res) => {
  const safe = db.prepare('SELECT * FROM safes WHERE id = ?').get(req.params.id);
  if (!safe) { req.session.flash = { error: 'Safe not found.' }; return res.redirect('/safes'); }

  const access = db.prepare(`
    SELECT sa.*, st.first_name, st.last_name, st.department, st.status
    FROM safe_access sa JOIN staff st ON st.id = sa.staff_id
    WHERE sa.safe_id = ? ORDER BY st.last_name, st.first_name
  `).all(safe.id);

  const accessIds = access.map(a => a.staff_id);
  const eligibleStaff = db.prepare("SELECT * FROM staff WHERE status='active' ORDER BY last_name, first_name").all()
    .filter(s => !accessIds.includes(s.id));

  res.render('safes/detail', { title: safe.name, safe, access, eligibleStaff });
});

router.get('/:id/edit', requirePermission('safes.edit'), (req, res) => {
  const safe = db.prepare('SELECT * FROM safes WHERE id = ?').get(req.params.id);
  if (!safe) { req.session.flash = { error: 'Safe not found.' }; return res.redirect('/safes'); }
  res.render('safes/form', { title: `Edit ${safe.name}`, safe, action: `/safes/${safe.id}` });
});

router.post('/:id', requirePermission('safes.edit'), (req, res) => {
  const safe = db.prepare('SELECT * FROM safes WHERE id = ?').get(req.params.id);
  if (!safe) { req.session.flash = { error: 'Safe not found.' }; return res.redirect('/safes'); }

  const { name, location, combination, notes } = req.body;
  if (!name || !combination) {
    req.session.flash = { error: 'Name and combination are required.' };
    return res.redirect(`/safes/${safe.id}/edit`);
  }

  const combinationChanged = combination.trim() !== safe.combination;
  db.prepare('UPDATE safes SET name=?, location=?, combination=?, notes=? WHERE id=?')
    .run(name.trim(), location || null, combination.trim(), notes || null, safe.id);
  auditLog('UPDATE', 'SAFE', safe.id, name.trim(), null, null, req.session.user.username, combinationChanged ? 'Combination changed' : null);
  req.session.flash = { success: 'Safe updated.' };
  res.redirect(`/safes/${safe.id}`);
});

router.post('/:id/grant', requirePermission('safes.edit'), (req, res) => {
  const safe = db.prepare('SELECT * FROM safes WHERE id = ?').get(req.params.id);
  if (!safe) { req.session.flash = { error: 'Safe not found.' }; return res.redirect('/safes'); }

  const { staff_id } = req.body;
  if (!staff_id) {
    req.session.flash = { error: 'Select a staff member.' };
    return res.redirect(`/safes/${safe.id}`);
  }

  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(staff_id);
  if (!staff) { req.session.flash = { error: 'Staff member not found.' }; return res.redirect(`/safes/${safe.id}`); }

  try {
    db.prepare('INSERT INTO safe_access (safe_id, staff_id, granted_by) VALUES (?, ?, ?)').run(safe.id, staff.id, req.session.user.username);
    auditLog('GRANT', 'SAFE', safe.id, safe.name, staff.id, `${staff.first_name} ${staff.last_name}`, req.session.user.username);
    req.session.flash = { success: `Access granted to ${staff.first_name} ${staff.last_name}.` };
  } catch {
    req.session.flash = { error: 'That person already has access.' };
  }
  res.redirect(`/safes/${safe.id}`);
});

router.post('/:id/revoke/:staffId', requirePermission('safes.edit'), (req, res) => {
  const safe = db.prepare('SELECT * FROM safes WHERE id = ?').get(req.params.id);
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.staffId);
  if (!safe || !staff) { req.session.flash = { error: 'Record not found.' }; return res.redirect('/safes'); }

  db.prepare('DELETE FROM safe_access WHERE safe_id = ? AND staff_id = ?').run(safe.id, staff.id);
  auditLog('REVOKE', 'SAFE', safe.id, safe.name, staff.id, `${staff.first_name} ${staff.last_name}`, req.session.user.username);
  req.session.flash = { success: `Access revoked for ${staff.first_name} ${staff.last_name}.` };
  res.redirect(`/safes/${safe.id}`);
});

router.post('/:id/delete', requirePermission('safes.delete'), (req, res) => {
  const safe = db.prepare('SELECT * FROM safes WHERE id = ?').get(req.params.id);
  if (!safe) { req.session.flash = { error: 'Safe not found.' }; return res.redirect('/safes'); }
  db.prepare('DELETE FROM safes WHERE id = ?').run(safe.id);
  auditLog('DELETE', 'SAFE', safe.id, safe.name, null, null, req.session.user.username);
  req.session.flash = { success: `Safe "${safe.name}" deleted.` };
  res.redirect('/safes');
});

module.exports = router;
