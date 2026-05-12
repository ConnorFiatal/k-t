const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const systems = db.prepare(`
    SELECT ks.*, COUNT(k.id) AS key_count
    FROM key_systems ks LEFT JOIN keys k ON k.key_system_id = ks.id
    GROUP BY ks.id ORDER BY ks.name
  `).all();
  res.render('key-systems/index', { title: 'Key Systems', systems });
});

router.get('/new', (req, res) => {
  res.render('key-systems/form', { title: 'New Key System', system: null, action: '/key-systems' });
});

router.post('/', (req, res) => {
  const { name, description, manufacturer, keyway, notes } = req.body;
  if (!name) { req.session.flash = { error: 'System name is required.' }; return res.redirect('/key-systems/new'); }
  try {
    const result = db.prepare('INSERT INTO key_systems (name, description, manufacturer, keyway, notes) VALUES (?, ?, ?, ?, ?)')
      .run(name.trim(), description || null, manufacturer || null, keyway || null, notes || null);
    req.session.flash = { success: `Key system "${name}" created.` };
    res.redirect(`/key-systems/${result.lastInsertRowid}`);
  } catch {
    req.session.flash = { error: 'A key system with that name already exists.' };
    res.redirect('/key-systems/new');
  }
});

router.get('/:id', (req, res) => {
  const system = db.prepare('SELECT * FROM key_systems WHERE id = ?').get(req.params.id);
  if (!system) { req.session.flash = { error: 'Key system not found.' }; return res.redirect('/key-systems'); }

  const allKeys = db.prepare(`
    SELECT k.*,
      p.key_number AS parent_number,
      (SELECT COUNT(*) FROM key_door_access kda WHERE kda.key_id = k.id) AS door_count
    FROM keys k
    LEFT JOIN keys p ON p.id = k.parent_key_id
    WHERE k.key_system_id = ?
    ORDER BY k.level, k.key_number
  `).all(system.id);

  // Build nested tree
  const treeHtml = buildTreeHtml(allKeys, null, 0);

  res.render('key-systems/detail', { title: system.name, system, allKeys, treeHtml });
});

router.get('/:id/edit', (req, res) => {
  const system = db.prepare('SELECT * FROM key_systems WHERE id = ?').get(req.params.id);
  if (!system) { req.session.flash = { error: 'Key system not found.' }; return res.redirect('/key-systems'); }
  res.render('key-systems/form', { title: `Edit ${system.name}`, system, action: `/key-systems/${system.id}` });
});

router.post('/:id', (req, res) => {
  const system = db.prepare('SELECT * FROM key_systems WHERE id = ?').get(req.params.id);
  if (!system) { req.session.flash = { error: 'Key system not found.' }; return res.redirect('/key-systems'); }
  const { name, description, manufacturer, keyway, notes } = req.body;
  if (!name) { req.session.flash = { error: 'Name is required.' }; return res.redirect(`/key-systems/${system.id}/edit`); }
  try {
    db.prepare('UPDATE key_systems SET name=?, description=?, manufacturer=?, keyway=?, notes=? WHERE id=?')
      .run(name.trim(), description || null, manufacturer || null, keyway || null, notes || null, system.id);
    req.session.flash = { success: 'Key system updated.' };
    res.redirect(`/key-systems/${system.id}`);
  } catch {
    req.session.flash = { error: 'A key system with that name already exists.' };
    res.redirect(`/key-systems/${system.id}/edit`);
  }
});

router.post('/:id/delete', (req, res) => {
  const system = db.prepare('SELECT * FROM key_systems WHERE id = ?').get(req.params.id);
  if (!system) { req.session.flash = { error: 'Key system not found.' }; return res.redirect('/key-systems'); }
  const keyCount = db.prepare('SELECT COUNT(*) AS c FROM keys WHERE key_system_id = ?').get(system.id).c;
  if (keyCount > 0) {
    req.session.flash = { error: `Cannot delete — ${keyCount} key(s) exist in this system. Remove them first.` };
    return res.redirect(`/key-systems/${system.id}`);
  }
  db.prepare('DELETE FROM key_systems WHERE id = ?').run(system.id);
  req.session.flash = { success: `Key system "${system.name}" deleted.` };
  res.redirect('/key-systems');
});

const LEVEL_ORDER = { 'GMK': 0, 'MK': 1, 'SUB_MASTER': 2, 'CHANGE': 3 };
const LEVEL_LABEL = { 'GMK': 'Grand Master', 'MK': 'Master', 'SUB_MASTER': 'Sub-Master', 'CHANGE': 'Change' };

function buildTreeHtml(allKeys, parentId, depth) {
  const children = allKeys.filter(k => (k.parent_key_id || null) === (parentId || null));
  if (children.length === 0) return '';

  const indent = depth === 0 ? 'tree-root' : 'tree-children';
  let html = `<ul class="key-tree-list ${indent}">`;
  for (const k of children) {
    const levelClass = `level-${(k.level || 'CHANGE').toLowerCase()}`;
    const levelLabel = LEVEL_LABEL[k.level] || k.level;
    const doorBadge = k.door_count > 0 ? `<span class="tree-door-count" title="${k.door_count} door(s)">${k.door_count} door${k.door_count !== 1 ? 's' : ''}</span>` : '';
    const bitting = k.bitting ? `<span class="tree-bitting" title="Bitting">${k.bitting}</span>` : '';
    const keyway = k.keyway ? `<span class="tree-meta">${k.keyway}</span>` : '';
    html += `<li class="key-tree-node ${levelClass}">
      <div class="key-tree-card">
        <span class="badge badge-level-${(k.level || 'CHANGE').toLowerCase()}">${levelLabel}</span>
        <a href="/keys/${k.id}" class="key-tree-number">${k.key_number}</a>
        ${bitting}${keyway}${doorBadge}
      </div>
      ${buildTreeHtml(allKeys, k.id, depth + 1)}
    </li>`;
  }
  html += '</ul>';
  return html;
}

module.exports = router;
