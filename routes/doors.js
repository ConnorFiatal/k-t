const express = require('express');
const { db, auditLog } = require('../db');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

router.get('/', requirePermission('doors.view'), (req, res) => {
  const { type, q } = req.query;
  let query = `
    SELECT d.*,
      (SELECT COUNT(*) FROM key_door_access kda WHERE kda.door_id = d.id) AS key_count,
      (SELECT COUNT(*) FROM fob_profile_doors fpd WHERE fpd.door_id = d.id) AS fob_profile_count
    FROM doors d WHERE 1=1
  `;
  const params = [];
  if (type) { query += ' AND d.access_type = ?'; params.push(type); }
  if (q) {
    query += ' AND (d.name LIKE ? OR d.door_number LIKE ? OR d.location LIKE ? OR d.building LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  query += ' ORDER BY d.building, d.floor, d.name';
  const doors = db.prepare(query).all(...params);
  res.render('doors/index', { title: 'Doors', doors, filters: { type, q } });
});

router.get('/new', requirePermission('doors.create'), (req, res) => {
  res.render('doors/form', { title: 'New Door', door: null, action: '/doors' });
});

router.post('/', requirePermission('doors.create'), (req, res) => {
  const { name, door_number, location, building, floor, access_type, notes } = req.body;
  if (!name || !access_type) {
    req.session.flash = { error: 'Name and access type are required.' };
    return res.redirect('/doors/new');
  }

  // Enforce plan max_buildings limit
  if (building) {
    const maxBuildings = parseInt(res.locals.planSettings?.max_buildings || '0', 10);
    if (maxBuildings > 0) {
      const distinctBuildings = db.prepare("SELECT COUNT(DISTINCT building) AS c FROM doors WHERE building IS NOT NULL AND building != ''").get().c;
      const alreadyExists = db.prepare("SELECT 1 FROM doors WHERE building = ? LIMIT 1").get(building.trim());
      if (!alreadyExists && distinctBuildings >= maxBuildings) {
        req.session.flash = { error: `Your plan allows a maximum of ${maxBuildings} building(s). Upgrade your plan to add more.` };
        return res.redirect('/doors/new');
      }
    }
  }

  const result = db.prepare('INSERT INTO doors (name, door_number, location, building, floor, access_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name.trim(), door_number || null, location || null, building || null, floor || null, access_type, notes || null);
  auditLog('CREATE', 'DOOR', result.lastInsertRowid, name.trim(), null, null, req.session.user.username);
  req.session.flash = { success: `Door "${name}" created.` };
  res.redirect(`/doors/${result.lastInsertRowid}`);
});

router.get('/:id', requirePermission('doors.view'), (req, res) => {
  const door = db.prepare('SELECT * FROM doors WHERE id = ?').get(req.params.id);
  if (!door) { req.session.flash = { error: 'Door not found.' }; return res.redirect('/doors'); }

  const keys = db.prepare(`
    SELECT k.*, ks.name AS system_name FROM key_door_access kda
    JOIN keys k ON k.id = kda.key_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    WHERE kda.door_id = ? ORDER BY ks.name, k.level, k.key_number
  `).all(door.id);

  const fobProfiles = db.prepare(`
    SELECT fp.* FROM fob_profile_doors fpd
    JOIN fob_profiles fp ON fp.id = fpd.fob_profile_id
    WHERE fpd.door_id = ? ORDER BY fp.name
  `).all(door.id);

  res.render('doors/detail', { title: door.name, door, keys, fobProfiles });
});

router.get('/:id/edit', requirePermission('doors.edit'), (req, res) => {
  const door = db.prepare('SELECT * FROM doors WHERE id = ?').get(req.params.id);
  if (!door) { req.session.flash = { error: 'Door not found.' }; return res.redirect('/doors'); }
  res.render('doors/form', { title: `Edit ${door.name}`, door, action: `/doors/${door.id}` });
});

router.post('/:id', requirePermission('doors.edit'), (req, res) => {
  const door = db.prepare('SELECT * FROM doors WHERE id = ?').get(req.params.id);
  if (!door) { req.session.flash = { error: 'Door not found.' }; return res.redirect('/doors'); }
  const { name, door_number, location, building, floor, access_type, notes } = req.body;
  if (!name || !access_type) {
    req.session.flash = { error: 'Name and access type are required.' };
    return res.redirect(`/doors/${door.id}/edit`);
  }
  db.prepare('UPDATE doors SET name=?, door_number=?, location=?, building=?, floor=?, access_type=?, notes=? WHERE id=?')
    .run(name.trim(), door_number || null, location || null, building || null, floor || null, access_type, notes || null, door.id);
  auditLog('UPDATE', 'DOOR', door.id, name.trim(), null, null, req.session.user.username);
  req.session.flash = { success: 'Door updated.' };
  res.redirect(`/doors/${door.id}`);
});

router.post('/:id/delete', requirePermission('doors.delete'), (req, res) => {
  const door = db.prepare('SELECT * FROM doors WHERE id = ?').get(req.params.id);
  if (!door) { req.session.flash = { error: 'Door not found.' }; return res.redirect('/doors'); }
  const keyCount = db.prepare('SELECT COUNT(*) AS c FROM key_door_access WHERE door_id = ?').get(door.id).c;
  const fobCount = db.prepare('SELECT COUNT(*) AS c FROM fob_profile_doors WHERE door_id = ?').get(door.id).c;
  if (keyCount > 0 || fobCount > 0) {
    req.session.flash = { error: `Cannot delete — door has ${keyCount} key and ${fobCount} FOB profile assignment(s). Remove them first.` };
    return res.redirect(`/doors/${door.id}`);
  }
  db.prepare('DELETE FROM doors WHERE id = ?').run(door.id);
  auditLog('DELETE', 'DOOR', door.id, door.name, null, null, req.session.user.username);
  req.session.flash = { success: `Door "${door.name}" deleted.` };
  res.redirect('/doors');
});

module.exports = router;
