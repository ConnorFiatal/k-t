const express = require('express');
const { db } = require('../db');

const router = express.Router();

const DEMO_ROLES = [
  {
    name: 'super_admin',
    username: 'demo_admin',
    label: 'Super Admin',
    tagline: 'Full access',
    description: 'Manage users, roles, and plan settings. Create, edit, and delete anything. See all audit logs and reports.',
    color: '#7c3aed',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/><path d="M16 11l2 2 4-4"/></svg>`,
  },
  {
    name: 'manager',
    username: 'demo_manager',
    label: 'Manager',
    tagline: 'Create & edit',
    description: 'Create and edit staff, keys, doors, safes, and accounts. View all reports. No delete or admin access.',
    color: '#2563eb',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  },
  {
    name: 'key_clerk',
    username: 'demo_clerk',
    label: 'Key Clerk',
    tagline: 'Key operations',
    description: 'Issue, return, and track physical keys. Check rings in and out. Focused on day-to-day key transaction workflows.',
    color: '#0891b2',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`,
  },
  {
    name: 'viewer',
    username: 'demo_viewer',
    label: 'Viewer',
    tagline: 'Read only',
    description: 'Browse all records across every module — staff, keys, doors, credentials, and reports. No changes permitted.',
    color: '#16a34a',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  },
];

router.get('/demo', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('demo-select', {
    title: 'Demo — KeyDog',
    flash: req.session.flash || null,
    roles: DEMO_ROLES,
  });
  delete req.session.flash;
});

router.post('/demo/select', (req, res) => {
  const { role } = req.body;
  const demoRole = DEMO_ROLES.find(r => r.name === role);
  if (!demoRole) {
    req.session.flash = { error: 'Invalid role selection.' };
    return res.redirect('/demo');
  }

  const userRow = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(demoRole.username);
  if (!userRow) {
    req.session.flash = { error: 'Demo user not initialised — please restart the server.' };
    return res.redirect('/demo');
  }

  const roleRow = db.prepare('SELECT * FROM roles WHERE id = ?').get(userRow.role_id);
  const isSuperAdmin = roleRow?.name === 'super_admin';
  const permissions = isSuperAdmin
    ? []
    : db.prepare('SELECT permission FROM role_permissions WHERE role_id = ?')
        .all(userRow.role_id).map(r => r.permission);

  req.session.regenerate((err) => {
    if (err) return res.redirect('/demo');
    req.session.user = {
      id:           userRow.id,
      username:     userRow.username,
      role_id:      userRow.role_id,
      role_name:    roleRow?.name  ?? null,
      role_label:   roleRow?.label ?? null,
      is_super_admin: isSuperAdmin,
      permissions,
    };
    res.redirect('/');
  });
});

module.exports = { router, DEMO_ROLES };
