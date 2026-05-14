const express = require('express');
const { db, auditLog } = require('../db');
const { requirePermission } = require('../middleware/auth');
const { PERMISSION_GROUPS, ALL_PERMISSIONS } = require('../middleware/permissions');

const router = express.Router();

router.get('/', requirePermission('admin.roles'), (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY is_system DESC, label').all();
  const counts = db.prepare(`
    SELECT role_id, COUNT(*) AS c FROM admin_users GROUP BY role_id
  `).all();
  const userCountByRole = {};
  for (const row of counts) userCountByRole[row.role_id] = row.c;

  res.render('admin/roles', { title: 'Roles & Permissions', roles, userCountByRole });
});

router.get('/new', requirePermission('admin.roles'), (req, res) => {
  res.render('admin/role-form', {
    title: 'New Role',
    role: null,
    rolePerms: [],
    permissionGroups: PERMISSION_GROUPS,
  });
});

router.post('/', requirePermission('admin.roles'), (req, res) => {
  const { label, description, permissions } = req.body;
  if (!label?.trim()) {
    req.session.flash = { error: 'Role name is required.' };
    return res.redirect('/admin/roles/new');
  }

  const name = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const selectedPerms = Array.isArray(permissions)
    ? permissions.filter(p => ALL_PERMISSIONS.includes(p))
    : (typeof permissions === 'string' && ALL_PERMISSIONS.includes(permissions) ? [permissions] : []);

  try {
    const result = db.prepare(
      'INSERT INTO roles (name, label, description, is_system) VALUES (?, ?, ?, 0)'
    ).run(name, label.trim(), description?.trim() || null);

    const roleId = result.lastInsertRowid;
    const insertPerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)');
    for (const perm of selectedPerms) insertPerm.run(roleId, perm);

    auditLog('CREATE_ROLE', 'ROLE', roleId, label.trim(), null, null, req.session.user.username);
    req.session.flash = { success: `Role "${label.trim()}" created.` };
    res.redirect('/admin/roles');
  } catch {
    req.session.flash = { error: 'A role with a similar name already exists.' };
    res.redirect('/admin/roles/new');
  }
});

router.get('/:id/edit', requirePermission('admin.roles'), (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) { req.session.flash = { error: 'Role not found.' }; return res.redirect('/admin/roles'); }
  if (role.is_system) { req.session.flash = { error: 'System roles cannot be edited.' }; return res.redirect('/admin/roles'); }

  const rolePerms = db.prepare('SELECT permission FROM role_permissions WHERE role_id = ?')
    .all(role.id).map(r => r.permission);

  res.render('admin/role-form', {
    title: `Edit Role — ${role.label}`,
    role,
    rolePerms,
    permissionGroups: PERMISSION_GROUPS,
  });
});

router.post('/:id/edit', requirePermission('admin.roles'), (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) { req.session.flash = { error: 'Role not found.' }; return res.redirect('/admin/roles'); }
  if (role.is_system) { req.session.flash = { error: 'System roles cannot be edited.' }; return res.redirect('/admin/roles'); }

  const { label, description, permissions } = req.body;
  if (!label?.trim()) {
    req.session.flash = { error: 'Role name is required.' };
    return res.redirect(`/admin/roles/${role.id}/edit`);
  }

  const selectedPerms = Array.isArray(permissions)
    ? permissions.filter(p => ALL_PERMISSIONS.includes(p))
    : (typeof permissions === 'string' && ALL_PERMISSIONS.includes(permissions) ? [permissions] : []);

  db.prepare('UPDATE roles SET label = ?, description = ? WHERE id = ?')
    .run(label.trim(), description?.trim() || null, role.id);

  db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(role.id);
  const insertPerm = db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)');
  for (const perm of selectedPerms) insertPerm.run(role.id, perm);

  auditLog('EDIT_ROLE', 'ROLE', role.id, label.trim(), null, null, req.session.user.username);
  req.session.flash = { success: `Role "${label.trim()}" updated.` };
  res.redirect('/admin/roles');
});

router.post('/:id/delete', requirePermission('admin.roles'), (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) { req.session.flash = { error: 'Role not found.' }; return res.redirect('/admin/roles'); }
  if (role.is_system) { req.session.flash = { error: 'System roles cannot be deleted.' }; return res.redirect('/admin/roles'); }

  const usersWithRole = db.prepare('SELECT COUNT(*) AS c FROM admin_users WHERE role_id = ?').get(role.id).c;
  if (usersWithRole > 0) {
    req.session.flash = { error: `Cannot delete role "${role.label}" — ${usersWithRole} user(s) are assigned to it.` };
    return res.redirect('/admin/roles');
  }

  db.prepare('DELETE FROM roles WHERE id = ?').run(role.id);
  auditLog('DELETE_ROLE', 'ROLE', role.id, role.label, null, null, req.session.user.username);
  req.session.flash = { success: `Role "${role.label}" deleted.` };
  res.redirect('/admin/roles');
});

module.exports = router;
