const express = require('express');
const { db } = require('../db');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requirePermission('reports.view'));

const LEVEL_LABEL = { GMK: 'Grand Master', MK: 'Master', SUB_MASTER: 'Sub-Master', CHANGE: 'Change' };

router.get('/', (req, res) => {
  res.render('reports/index', { title: 'Reports' });
});

// 1. Key Directory
router.get('/key-directory', (req, res) => {
  const { system_id, level } = req.query;
  let query = `
    SELECT k.*, ks.name AS system_name, ks.keyway AS system_keyway, p.key_number AS parent_number,
      (SELECT COUNT(*) FROM key_door_access kda WHERE kda.key_id = k.id) AS door_count,
      (SELECT COUNT(*) FROM keyring_keys kk WHERE kk.key_id = k.id) AS ring_count
    FROM keys k
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN keys p ON p.id = k.parent_key_id
    WHERE 1=1
  `;
  const params = [];
  if (system_id) { query += ' AND k.key_system_id = ?'; params.push(system_id); }
  if (level) { query += ' AND k.level = ?'; params.push(level); }
  query += ' ORDER BY ks.name, k.level, k.key_number';
  const keys = db.prepare(query).all(...params);
  const systems = db.prepare('SELECT id, name FROM key_systems ORDER BY name').all();
  res.render('reports/key-directory', { title: 'Report: Key Directory', keys, systems, filters: { system_id, level }, LEVEL_LABEL });
});

// 2. Door Schedule
router.get('/door-schedule', (req, res) => {
  const { type } = req.query;
  let query = 'SELECT * FROM doors WHERE 1=1';
  const params = [];
  if (type) { query += ' AND access_type = ?'; params.push(type); }
  query += ' ORDER BY building, floor, name';
  const doors = db.prepare(query).all(...params);

  // Enrich each door with its keys and fob profiles
  const enriched = doors.map(door => {
    const keys = db.prepare(`
      SELECT k.key_number, k.level, k.bitting, k.keyway, ks.name AS system_name
      FROM key_door_access kda JOIN keys k ON k.id = kda.key_id
      JOIN key_systems ks ON ks.id = k.key_system_id
      WHERE kda.door_id = ? ORDER BY ks.name, k.level, k.key_number
    `).all(door.id);
    const fobProfiles = db.prepare(`
      SELECT fp.name FROM fob_profile_doors fpd JOIN fob_profiles fp ON fp.id = fpd.fob_profile_id
      WHERE fpd.door_id = ? ORDER BY fp.name
    `).all(door.id);
    return { ...door, keys, fobProfiles };
  });
  res.render('reports/door-schedule', { title: 'Report: Door Schedule', doors: enriched, filters: { type } });
});

// 3. Keyring Inventory
router.get('/keyring-inventory', (req, res) => {
  const keyrings = db.prepare('SELECT * FROM keyrings ORDER BY ring_number').all();
  const enriched = keyrings.map(ring => {
    const staff = db.prepare(`
      SELECT st.first_name, st.last_name, st.department, st.status
      FROM keyring_authorizations ka JOIN staff st ON st.id = ka.staff_id
      WHERE ka.keyring_id = ? ORDER BY st.last_name
    `).all(ring.id);
    const keys = db.prepare(`
      SELECT k.key_number, k.level, k.bitting, k.keyway, ks.name AS system_name
      FROM keyring_keys kk JOIN keys k ON k.id = kk.key_id
      JOIN key_systems ks ON ks.id = k.key_system_id
      WHERE kk.keyring_id = ? ORDER BY ks.name, k.level, k.key_number
    `).all(ring.id);
    const fobs = db.prepare(`
      SELECT fp.name AS profile_name, kfp.fob_serial,
        (SELECT COUNT(*) FROM fob_profile_doors fpd WHERE fpd.fob_profile_id = fp.id) AS door_count
      FROM keyring_fob_profiles kfp JOIN fob_profiles fp ON fp.id = kfp.fob_profile_id
      WHERE kfp.keyring_id = ? ORDER BY fp.name
    `).all(ring.id);
    return { ...ring, staff, keys, fobs };
  });
  res.render('reports/keyring-inventory', { title: 'Report: Keyring Inventory', keyrings: enriched });
});

// 4. Staff Access Summary
router.get('/staff-access', (req, res) => {
  const { staff_id, status } = req.query;
  let staffQuery = 'SELECT * FROM staff WHERE 1=1';
  const params = [];
  if (staff_id) { staffQuery += ' AND id = ?'; params.push(staff_id); }
  else if (status) { staffQuery += ' AND status = ?'; params.push(status); }
  else { staffQuery += " AND status = 'active'"; }
  staffQuery += ' ORDER BY last_name, first_name';
  const staffList = db.prepare(staffQuery).all(...params);

  const allStaff = db.prepare('SELECT id, first_name, last_name, status FROM staff ORDER BY last_name, first_name').all();

  const enriched = staffList.map(s => {
    const keyrings = db.prepare(`
      SELECT kr.ring_number, kr.description,
        (SELECT COUNT(*) FROM keyring_keys kk WHERE kk.keyring_id = kr.id) AS key_count,
        (SELECT COUNT(*) FROM keyring_fob_profiles kfp WHERE kfp.keyring_id = kr.id) AS fob_count
      FROM keyring_authorizations ka JOIN keyrings kr ON kr.id = ka.keyring_id
      WHERE ka.staff_id = ? ORDER BY kr.ring_number
    `).all(s.id);
    const safeAccess = db.prepare(`
      SELECT sf.name, sf.location FROM safe_access sa JOIN safes sf ON sf.id = sa.safe_id WHERE sa.staff_id = ?
    `).all(s.id);
    const sysAccess = db.prepare(`
      SELECT a.system_name, a.account_username, a.category FROM system_account_access saa
      JOIN system_accounts a ON a.id = saa.account_id WHERE saa.staff_id = ?
    `).all(s.id);
    return { ...s, keyrings, safeAccess, sysAccess };
  });
  res.render('reports/staff-access', { title: 'Report: Staff Access Summary', staff: enriched, allStaff, filters: { staff_id, status } });
});

// 5. Master System Map
router.get('/master-system-map', (req, res) => {
  const { system_id } = req.query;
  const systems = db.prepare('SELECT * FROM key_systems ORDER BY name').all();
  let trees = [];

  const targetSystems = system_id
    ? systems.filter(s => s.id === parseInt(system_id))
    : systems;

  for (const sys of targetSystems) {
    const allKeys = db.prepare(`
      SELECT k.*,
        (SELECT COUNT(*) FROM key_door_access kda WHERE kda.key_id = k.id) AS door_count,
        (SELECT COUNT(*) FROM keyring_keys kk WHERE kk.key_id = k.id) AS ring_count
      FROM keys k WHERE k.key_system_id = ? ORDER BY k.level, k.key_number
    `).all(sys.id);
    const treeHtml = buildTreeHtml(allKeys, null, 0);
    trees.push({ system: sys, treeHtml, keyCount: allKeys.length });
  }

  res.render('reports/master-system-map', { title: 'Report: Master System Map', trees, systems, filters: { system_id }, LEVEL_LABEL });
});

// 6. FOB Profile Directory
router.get('/fob-profiles', (req, res) => {
  const profiles = db.prepare('SELECT * FROM fob_profiles ORDER BY name').all();
  const enriched = profiles.map(p => {
    const doors = db.prepare(`
      SELECT d.name, d.door_number, d.location, d.building, d.floor, d.access_type
      FROM fob_profile_doors fpd JOIN doors d ON d.id = fpd.door_id
      WHERE fpd.fob_profile_id = ? ORDER BY d.building, d.floor, d.name
    `).all(p.id);
    const rings = db.prepare(`
      SELECT kr.ring_number, kfp.fob_serial FROM keyring_fob_profiles kfp
      JOIN keyrings kr ON kr.id = kfp.keyring_id WHERE kfp.fob_profile_id = ? ORDER BY kr.ring_number
    `).all(p.id);
    return { ...p, doors, rings };
  });
  res.render('reports/fob-profiles', { title: 'Report: FOB Profile Directory', profiles: enriched });
});

// 7. Access by Door
router.get('/access-by-door', (req, res) => {
  const { building, type } = req.query;
  let query = 'SELECT * FROM doors WHERE 1=1';
  const params = [];
  if (building) { query += ' AND building = ?'; params.push(building); }
  if (type) { query += ' AND access_type = ?'; params.push(type); }
  query += ' ORDER BY building, floor, name';
  const doors = db.prepare(query).all(...params);

  const buildings = db.prepare("SELECT DISTINCT building FROM doors WHERE building IS NOT NULL ORDER BY building").all().map(r => r.building);

  const enriched = doors.map(door => {
    // All staff who hold a keyring that has a key opening this door
    const staffViaKey = db.prepare(`
      SELECT DISTINCT st.first_name, st.last_name, st.status, kr.ring_number, k.key_number, ks.name AS system_name
      FROM key_door_access kda
      JOIN keyring_keys kk ON kk.key_id = kda.key_id
      JOIN keyrings kr ON kr.id = kk.keyring_id
      JOIN keyring_authorizations ka ON ka.keyring_id = kr.id
      JOIN staff st ON st.id = ka.staff_id
      JOIN keys k ON k.id = kda.key_id
      JOIN key_systems ks ON ks.id = k.key_system_id
      WHERE kda.door_id = ? ORDER BY st.last_name, st.first_name
    `).all(door.id);

    // All staff who hold a keyring with a fob profile covering this door
    const staffViaFob = db.prepare(`
      SELECT DISTINCT st.first_name, st.last_name, st.status, kr.ring_number, fp.name AS profile_name, kfp.fob_serial
      FROM fob_profile_doors fpd
      JOIN keyring_fob_profiles kfp ON kfp.fob_profile_id = fpd.fob_profile_id
      JOIN keyrings kr ON kr.id = kfp.keyring_id
      JOIN keyring_authorizations ka ON ka.keyring_id = kr.id
      JOIN staff st ON st.id = ka.staff_id
      JOIN fob_profiles fp ON fp.id = fpd.fob_profile_id
      WHERE fpd.door_id = ? ORDER BY st.last_name, st.first_name
    `).all(door.id);

    return { ...door, staffViaKey, staffViaFob };
  });
  res.render('reports/access-by-door', { title: 'Report: Access by Door', doors: enriched, buildings, filters: { building, type } });
});

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildTreeHtml(allKeys, parentId, depth) {
  const children = allKeys.filter(k => (k.parent_key_id || null) === (parentId || null));
  if (!children.length) return '';
  const LBL = { GMK: 'Grand Master', MK: 'Master', SUB_MASTER: 'Sub-Master', CHANGE: 'Change' };
  let html = `<ul class="key-tree-list ${depth === 0 ? 'tree-root' : 'tree-children'}">`;
  for (const k of children) {
    const lvl = (k.level || 'CHANGE').toLowerCase();
    const lbl = esc(LBL[k.level] || k.level);
    html += `<li class="key-tree-node level-${lvl}">
      <div class="key-tree-card">
        <span class="badge badge-level-${lvl}">${lbl}</span>
        <a href="/keys/${k.id}" class="key-tree-number">${esc(k.key_number)}</a>
        ${k.bitting ? `<span class="tree-bitting">${esc(k.bitting)}</span>` : ''}
        ${k.keyway ? `<span class="tree-meta">${esc(k.keyway)}</span>` : ''}
        ${k.door_count > 0 ? `<span class="tree-door-count">${k.door_count} door${k.door_count !== 1 ? 's' : ''}</span>` : ''}
        ${k.ring_count > 0 ? `<span class="tree-ring-count">${k.ring_count} ring${k.ring_count !== 1 ? 's' : ''}</span>` : ''}
      </div>
      ${buildTreeHtml(allKeys, k.id, depth + 1)}
    </li>`;
  }
  html += '</ul>';
  return html;
}

module.exports = router;
