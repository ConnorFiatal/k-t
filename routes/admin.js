const express = require('express');
const bcrypt = require('bcryptjs');
const { db, auditLog } = require('../db');
const { sendEmail } = require('./email');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

// ── Admin Users ────────────────────────────────────────────────────────────

router.get('/users', requirePermission('admin.users'), (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.email, u.created_at, u.role_id, r.label AS role_label, r.name AS role_name, r.is_system
    FROM admin_users u
    LEFT JOIN roles r ON r.id = u.role_id
    ORDER BY u.username
  `).all();
  res.render('admin/users', { title: 'Admin Users', users });
});

router.get('/users/new', requirePermission('admin.users'), (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY is_system DESC, label').all();
  res.render('admin/new-user', { title: 'New Admin User', roles });
});

router.post('/users', requirePermission('admin.users'), async (req, res) => {
  const { username, password, confirm_password, email, role_id } = req.body;
  if (!username || !password) {
    req.session.flash = { error: 'Username and password are required.' };
    return res.redirect('/admin/users/new');
  }
  if (password !== confirm_password) {
    req.session.flash = { error: 'Passwords do not match.' };
    return res.redirect('/admin/users/new');
  }
  if (password.length < 8) {
    req.session.flash = { error: 'Password must be at least 8 characters.' };
    return res.redirect('/admin/users/new');
  }

  // Enforce plan max_admin_users limit
  const planSettings = res.locals.planSettings || {};
  const maxUsers = parseInt(planSettings.max_admin_users || '0', 10);
  if (maxUsers > 0) {
    const currentCount = db.prepare('SELECT COUNT(*) AS c FROM admin_users').get().c;
    if (currentCount >= maxUsers) {
      req.session.flash = { error: `Your plan allows a maximum of ${maxUsers} admin users. Upgrade your plan to add more.` };
      return res.redirect('/admin/users/new');
    }
  }

  const roleRow = role_id ? db.prepare('SELECT id FROM roles WHERE id = ?').get(role_id) : null;

  try {
    const hash = bcrypt.hashSync(password, 12);
    const emailVal = email?.trim() || null;
    const result = db.prepare(
      'INSERT INTO admin_users (username, password_hash, email, role_id) VALUES (?, ?, ?, ?)'
    ).run(username.trim(), hash, emailVal, roleRow?.id ?? null);

    auditLog('CREATE_USER', 'ADMIN_USER', result.lastInsertRowid, username.trim(), null, null, req.session.user.username);
    req.session.flash = { success: `Admin user "${username}" created.` };

    if (emailVal) {
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      sendEmail(emailVal, `Welcome to KeyDog — your account is ready`, 'welcome', {
        username:  username.trim(),
        loginUrl:  `${appUrl}/login`,
        createdBy: req.session.user.username,
      }).catch(err => console.error('[email] Welcome email failed:', err.message));
    }

    res.redirect('/admin/users');
  } catch {
    req.session.flash = { error: 'Username already exists.' };
    res.redirect('/admin/users/new');
  }
});

router.get('/users/:id/edit-role', requirePermission('admin.users'), (req, res) => {
  const user = db.prepare('SELECT id, username, role_id FROM admin_users WHERE id = ?').get(req.params.id);
  if (!user) { req.session.flash = { error: 'User not found.' }; return res.redirect('/admin/users'); }
  const roles = db.prepare('SELECT * FROM roles ORDER BY is_system DESC, label').all();
  res.render('admin/edit-user-role', { title: `Edit Role — ${user.username}`, targetUser: user, roles });
});

router.post('/users/:id/edit-role', requirePermission('admin.users'), (req, res) => {
  const user = db.prepare('SELECT id, username FROM admin_users WHERE id = ?').get(req.params.id);
  if (!user) { req.session.flash = { error: 'User not found.' }; return res.redirect('/admin/users'); }

  const { role_id } = req.body;
  const roleRow = role_id ? db.prepare('SELECT id FROM roles WHERE id = ?').get(role_id) : null;
  db.prepare('UPDATE admin_users SET role_id = ? WHERE id = ?').run(roleRow?.id ?? null, user.id);
  auditLog('EDIT_USER_ROLE', 'ADMIN_USER', user.id, user.username, null, null, req.session.user.username);
  req.session.flash = { success: `Role updated for "${user.username}".` };
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', requirePermission('admin.users'), (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) {
    req.session.flash = { error: 'You cannot delete your own account.' };
    return res.redirect('/admin/users');
  }
  const total = db.prepare('SELECT COUNT(*) AS c FROM admin_users').get().c;
  if (total <= 1) {
    req.session.flash = { error: 'Cannot delete the last admin user.' };
    return res.redirect('/admin/users');
  }
  const targetUser = db.prepare('SELECT id, username FROM admin_users WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(req.params.id);
  if (targetUser) auditLog('DELETE_USER', 'ADMIN_USER', targetUser.id, targetUser.username, null, null, req.session.user.username);
  req.session.flash = { success: 'Admin user deleted.' };
  res.redirect('/admin/users');
});

router.get('/users/:id/change-password', requirePermission('admin.users'), (req, res) => {
  const user = db.prepare('SELECT id, username FROM admin_users WHERE id = ?').get(req.params.id);
  if (!user) { req.session.flash = { error: 'User not found.' }; return res.redirect('/admin/users'); }
  res.render('admin/change-password', { title: 'Change Password', targetUser: user });
});

router.post('/users/:id/change-password', requirePermission('admin.users'), (req, res) => {
  const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.params.id);
  if (!user) { req.session.flash = { error: 'User not found.' }; return res.redirect('/admin/users'); }

  const { password, confirm_password } = req.body;
  if (!password || password !== confirm_password) {
    req.session.flash = { error: 'Passwords do not match or are empty.' };
    return res.redirect(`/admin/users/${user.id}/change-password`);
  }
  if (password.length < 8) {
    req.session.flash = { error: 'Password must be at least 8 characters.' };
    return res.redirect(`/admin/users/${user.id}/change-password`);
  }

  const hash = bcrypt.hashSync(password, 12);
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  auditLog('CHANGE_PASSWORD', 'ADMIN_USER', user.id, user.username, null, null, req.session.user.username,
    req.session.user.id === user.id ? 'Own password changed' : `Password changed by ${req.session.user.username}`);
  req.session.flash = { success: `Password updated for "${user.username}".` };
  res.redirect('/admin/users');
});

// ── Plan Settings ──────────────────────────────────────────────────────────

router.get('/plan', requirePermission('admin.plan'), (req, res) => {
  res.render('admin/plan-settings', {
    title: 'Plan Settings',
    planLicensed: res.locals.planLicensed || {},
    planSettings: res.locals.planSettings || {},
  });
});

module.exports = router;
