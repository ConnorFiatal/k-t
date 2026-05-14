const express = require('express');
const bcrypt = require('bcryptjs');
const { db, auditLog } = require('../db');
const { sendEmail } = require('./email');

const router = express.Router();

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, username, created_at FROM admin_users ORDER BY username').all();
  res.render('admin/users', { title: 'Admin Users', users });
});

router.get('/users/new', (req, res) => {
  res.render('admin/new-user', { title: 'New Admin User' });
});

router.post('/users', async (req, res) => {
  const { username, password, confirm_password, email } = req.body;
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
  try {
    const hash = bcrypt.hashSync(password, 10);
    const emailVal = email?.trim() || null;
    const result = db.prepare('INSERT INTO admin_users (username, password_hash, email) VALUES (?, ?, ?)').run(username.trim(), hash, emailVal);
    auditLog('CREATE_USER', 'ADMIN_USER', result.lastInsertRowid, username.trim(), null, null, req.session.user.username);
    req.session.flash = { success: `Admin user "${username}" created.` };

    // Send welcome email if an address was provided
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

router.post('/users/:id/delete', (req, res) => {
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

router.get('/users/:id/change-password', (req, res) => {
  const user = db.prepare('SELECT id, username FROM admin_users WHERE id = ?').get(req.params.id);
  if (!user) { req.session.flash = { error: 'User not found.' }; return res.redirect('/admin/users'); }
  res.render('admin/change-password', { title: 'Change Password', targetUser: user });
});

router.post('/users/:id/change-password', (req, res) => {
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

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  auditLog('CHANGE_PASSWORD', 'ADMIN_USER', user.id, user.username, null, null, req.session.user.username,
    req.session.user.id === user.id ? 'Own password changed' : `Password changed by ${req.session.user.username}`);
  req.session.flash = { success: `Password updated for "${user.username}".` };
  res.redirect('/admin/users');
});

module.exports = router;
