const express = require('express');
const { db } = require('../db');

const router = express.Router();

const LEVELS = ['GMK', 'MK', 'SUB_MASTER', 'CHANGE'];
const LEVEL_LABEL = { GMK: 'Grand Master', MK: 'Master', SUB_MASTER: 'Sub-Master', CHANGE: 'Change' };

router.get('/', (req, res) => {
  const { system_id, level, q } = req.query;
  let query = `
    SELECT k.*, ks.name AS system_name, p.key_number AS parent_number,
      (SELECT COUNT(*) FROM key_door_access kda WHERE kda.key_id = k.id) AS door_count
    FROM keys k
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN keys p ON p.id = k.parent_key_id
    WHERE 1=1
  `;
  const params = [];
  if (system_id) { query += ' AND k.key_system_id = ?'; params.push(system_id); }
  if (level) { query += ' AND k.level = ?'; params.push(level); }
  if (q) {
    query += ' AND (k.key_number LIKE ? OR k.bitting LIKE ? OR k.keyway LIKE ? OR k.key_blank LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  query += ' ORDER BY ks.name, k.level, k.key_number';

  const keys = db.prepare(query).all(...params);
  const systems = db.prepare('SELECT id, name FROM key_systems ORDER BY name').all();
  res.render('keys/index', { title: 'Keys', keys, systems, filters: { system_id, level, q }, LEVELS, LEVEL_LABEL });
});

router.get('/new', (req, res) => {
  const systems = db.prepare('SELECT id, name FROM key_systems ORDER BY name').all();
  const preSystem = req.query.system_id ? db.prepare('SELECT * FROM key_systems WHERE id = ?').get(req.query.system_id) : null;
  const parentKeys = preSystem
    ? db.prepare("SELECT * FROM keys WHERE key_system_id = ? AND level != 'CHANGE' ORDER BY level, key_number").all(preSystem.id)
    : [];
  res.render('keys/form', { title: 'New Key', key: null, action: '/keys', systems, parentKeys, preSystemId: req.query.system_id || '', LEVELS, LEVEL_LABEL });
});

router.post('/', (req, res) => {
  const { key_system_id, key_number, level, parent_key_id, bitting, keyway, key_blank, notes } = req.body;
  if (!key_system_id || !key_number || !level) {
    req.session.flash = { error: 'System, key number, and level are required.' };
    return res.redirect('/keys/new');
  }
  try {
    const result = db.prepare(`
      INSERT INTO keys (key_system_id, key_number, level, parent_key_id, bitting, keyway, key_blank, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(key_system_id, key_number.trim(), level, parent_key_id || null, bitting || null, keyway || null, key_blank || null, notes || null);
    req.session.flash = { success: `Key "${key_number}" created.` };
    res.redirect(`/keys/${result.lastInsertRowid}`);
  } catch {
    req.session.flash = { error: 'A key with that number already exists in this system.' };
    res.redirect('/keys/new');
  }
});

router.get('/:id', (req, res) => {
  const key = db.prepare(`
    SELECT k.*, ks.name AS system_name, ks.keyway AS system_keyway,
      p.key_number AS parent_number, p.id AS parent_id
    FROM keys k
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN keys p ON p.id = k.parent_key_id
    WHERE k.id = ?
  `).get(req.params.id);
  if (!key) { req.session.flash = { error: 'Key not found.' }; return res.redirect('/keys'); }

  const doors = db.prepare(`
    SELECT d.* FROM key_door_access kda JOIN doors d ON d.id = kda.door_id WHERE kda.key_id = ? ORDER BY d.name
  `).all(key.id);

  const assignedDoorIds = doors.map(d => d.id);
  const eligibleDoors = db.prepare("SELECT * FROM doors WHERE access_type IN ('KEYED','BOTH') ORDER BY name").all()
    .filter(d => !assignedDoorIds.includes(d.id));

  const childKeys = db.prepare("SELECT * FROM keys WHERE parent_key_id = ? ORDER BY level, key_number").all(key.id);

  const onRings = db.prepare(`
    SELECT kk.*, kr.ring_number, kr.description FROM keyring_keys kk
    JOIN keyrings kr ON kr.id = kk.keyring_id WHERE kk.key_id = ?
  `).all(key.id);

  res.render('keys/detail', { title: `Key ${key.key_number}`, key, doors, eligibleDoors, childKeys, onRings, LEVEL_LABEL });
});

router.get('/:id/edit', (req, res) => {
  const key = db.prepare('SELECT * FROM keys WHERE id = ?').get(req.params.id);
  if (!key) { req.session.flash = { error: 'Key not found.' }; return res.redirect('/keys'); }
  const systems = db.prepare('SELECT id, name FROM key_systems ORDER BY name').all();
  const parentKeys = db.prepare("SELECT * FROM keys WHERE key_system_id = ? AND id != ? AND level != 'CHANGE' ORDER BY level, key_number")
    .all(key.key_system_id, key.id);
  res.render('keys/form', { title: `Edit Key ${key.key_number}`, key, action: `/keys/${key.id}`, systems, parentKeys, preSystemId: key.key_system_id, LEVELS, LEVEL_LABEL });
});

router.post('/:id', (req, res) => {
  const key = db.prepare('SELECT * FROM keys WHERE id = ?').get(req.params.id);
  if (!key) { req.session.flash = { error: 'Key not found.' }; return res.redirect('/keys'); }
  const { key_system_id, key_number, level, parent_key_id, bitting, keyway, key_blank, notes } = req.body;
  if (!key_system_id || !key_number || !level) {
    req.session.flash = { error: 'System, key number, and level are required.' };
    return res.redirect(`/keys/${key.id}/edit`);
  }
  try {
    db.prepare(`
      UPDATE keys SET key_system_id=?, key_number=?, level=?, parent_key_id=?, bitting=?, keyway=?, key_blank=?, notes=? WHERE id=?
    `).run(key_system_id, key_number.trim(), level, parent_key_id || null, bitting || null, keyway || null, key_blank || null, notes || null, key.id);
    req.session.flash = { success: 'Key updated.' };
    res.redirect(`/keys/${key.id}`);
  } catch {
    req.session.flash = { error: 'A key with that number already exists in this system.' };
    res.redirect(`/keys/${key.id}/edit`);
  }
});

router.post('/:id/delete', (req, res) => {
  const key = db.prepare('SELECT *, (SELECT name FROM key_systems WHERE id = key_system_id) AS system_name FROM keys WHERE id = ?').get(req.params.id);
  if (!key) { req.session.flash = { error: 'Key not found.' }; return res.redirect('/keys'); }
  const onRings = db.prepare('SELECT COUNT(*) AS c FROM keyring_keys WHERE key_id = ?').get(key.id).c;
  if (onRings > 0) {
    req.session.flash = { error: `Cannot delete — key is on ${onRings} keyring(s). Remove it from all rings first.` };
    return res.redirect(`/keys/${key.id}`);
  }
  const childCount = db.prepare('SELECT COUNT(*) AS c FROM keys WHERE parent_key_id = ?').get(key.id).c;
  if (childCount > 0) {
    req.session.flash = { error: `Cannot delete — ${childCount} key(s) are subordinate to this key. Reassign them first.` };
    return res.redirect(`/keys/${key.id}`);
  }
  db.prepare('DELETE FROM keys WHERE id = ?').run(key.id);
  req.session.flash = { success: `Key "${key.key_number}" deleted.` };
  res.redirect(`/key-systems/${key.key_system_id}`);
});

router.post('/:id/doors/add', (req, res) => {
  const key = db.prepare('SELECT * FROM keys WHERE id = ?').get(req.params.id);
  if (!key) { req.session.flash = { error: 'Key not found.' }; return res.redirect('/keys'); }
  const { door_id } = req.body;
  if (!door_id) { req.session.flash = { error: 'Select a door.' }; return res.redirect(`/keys/${key.id}`); }
  try {
    db.prepare('INSERT INTO key_door_access (key_id, door_id) VALUES (?, ?)').run(key.id, door_id);
    req.session.flash = { success: 'Door added to key.' };
  } catch {
    req.session.flash = { error: 'That door is already assigned to this key.' };
  }
  res.redirect(`/keys/${key.id}`);
});

router.post('/:id/doors/:doorId/remove', (req, res) => {
  const key = db.prepare('SELECT * FROM keys WHERE id = ?').get(req.params.id);
  if (!key) { req.session.flash = { error: 'Key not found.' }; return res.redirect('/keys'); }
  db.prepare('DELETE FROM key_door_access WHERE key_id = ? AND door_id = ?').run(key.id, req.params.doorId);
  req.session.flash = { success: 'Door removed from key.' };
  res.redirect(`/keys/${key.id}`);
});

module.exports = router;
