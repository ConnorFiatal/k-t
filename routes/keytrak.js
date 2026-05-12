const express = require('express');
const { db, auditLog } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const keyrings = db.prepare(`
    SELECT k.*,
      COUNT(DISTINCT ka.staff_id) AS auth_count,
      COUNT(DISTINCT kk.key_id)   AS key_count,
      COUNT(DISTINCT kfp.fob_profile_id) AS fob_count
    FROM keyrings k
    LEFT JOIN keyring_authorizations ka  ON ka.keyring_id  = k.id
    LEFT JOIN keyring_keys           kk  ON kk.keyring_id  = k.id
    LEFT JOIN keyring_fob_profiles   kfp ON kfp.keyring_id = k.id
    GROUP BY k.id ORDER BY k.ring_number
  `).all();
  res.render('keytrak/index', { title: 'KeyTrak Keyrings', keyrings });
});

router.get('/new', (req, res) => {
  res.render('keytrak/form', { title: 'New Keyring', keyring: null, action: '/keytrak' });
});

router.post('/', (req, res) => {
  const { ring_number, description, location, notes } = req.body;
  if (!ring_number) { req.session.flash = { error: 'Ring number is required.' }; return res.redirect('/keytrak/new'); }
  try {
    const result = db.prepare('INSERT INTO keyrings (ring_number, description, location, notes) VALUES (?, ?, ?, ?)').run(ring_number.trim(), description || null, location || null, notes || null);
    req.session.flash = { success: `Keyring ${ring_number} created.` };
    res.redirect(`/keytrak/${result.lastInsertRowid}`);
  } catch {
    req.session.flash = { error: 'Ring number already exists.' };
    res.redirect('/keytrak/new');
  }
});

router.get('/:id', (req, res) => {
  const keyring = db.prepare('SELECT * FROM keyrings WHERE id = ?').get(req.params.id);
  if (!keyring) { req.session.flash = { error: 'Keyring not found.' }; return res.redirect('/keytrak'); }

  const authorizations = db.prepare(`
    SELECT ka.*, st.first_name, st.last_name, st.department, st.status
    FROM keyring_authorizations ka JOIN staff st ON st.id = ka.staff_id
    WHERE ka.keyring_id = ? ORDER BY st.last_name, st.first_name
  `).all(keyring.id);

  const authIds = authorizations.map(a => a.staff_id);
  const eligibleStaff = db.prepare("SELECT * FROM staff WHERE status='active' ORDER BY last_name, first_name").all()
    .filter(s => !authIds.includes(s.id));

  // Keys on this ring
  const assignedKeys = db.prepare(`
    SELECT kk.*, k.key_number, k.level, k.bitting, k.keyway, ks.name AS system_name
    FROM keyring_keys kk
    JOIN keys k ON k.id = kk.key_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    WHERE kk.keyring_id = ? ORDER BY ks.name, k.level, k.key_number
  `).all(keyring.id);

  const assignedKeyIds = assignedKeys.map(k => k.key_id);
  const eligibleKeys = db.prepare(`
    SELECT k.*, ks.name AS system_name FROM keys k
    JOIN key_systems ks ON ks.id = k.key_system_id ORDER BY ks.name, k.level, k.key_number
  `).all().filter(k => !assignedKeyIds.includes(k.id));

  // FOB profiles on this ring
  const assignedFobs = db.prepare(`
    SELECT kfp.*, fp.name AS profile_name,
      (SELECT COUNT(*) FROM fob_profile_doors fpd WHERE fpd.fob_profile_id = fp.id) AS door_count
    FROM keyring_fob_profiles kfp
    JOIN fob_profiles fp ON fp.id = kfp.fob_profile_id
    WHERE kfp.keyring_id = ? ORDER BY fp.name
  `).all(keyring.id);

  const assignedFobIds = assignedFobs.map(f => f.fob_profile_id);
  const eligibleFobs = db.prepare('SELECT * FROM fob_profiles ORDER BY name').all()
    .filter(f => !assignedFobIds.includes(f.id));

  res.render('keytrak/detail', {
    title: `Keyring ${keyring.ring_number}`,
    keyring, authorizations, eligibleStaff,
    assignedKeys, eligibleKeys,
    assignedFobs, eligibleFobs
  });
});

router.get('/:id/edit', (req, res) => {
  const keyring = db.prepare('SELECT * FROM keyrings WHERE id = ?').get(req.params.id);
  if (!keyring) { req.session.flash = { error: 'Keyring not found.' }; return res.redirect('/keytrak'); }
  res.render('keytrak/form', { title: `Edit Keyring ${keyring.ring_number}`, keyring, action: `/keytrak/${keyring.id}` });
});

router.post('/:id', (req, res) => {
  const keyring = db.prepare('SELECT * FROM keyrings WHERE id = ?').get(req.params.id);
  if (!keyring) { req.session.flash = { error: 'Keyring not found.' }; return res.redirect('/keytrak'); }
  const { ring_number, description, location, notes } = req.body;
  if (!ring_number) { req.session.flash = { error: 'Ring number is required.' }; return res.redirect(`/keytrak/${keyring.id}/edit`); }
  try {
    db.prepare('UPDATE keyrings SET ring_number=?, description=?, location=?, notes=? WHERE id=?')
      .run(ring_number.trim(), description || null, location || null, notes || null, keyring.id);
    req.session.flash = { success: 'Keyring updated.' };
    res.redirect(`/keytrak/${keyring.id}`);
  } catch {
    req.session.flash = { error: 'Ring number already exists.' };
    res.redirect(`/keytrak/${keyring.id}/edit`);
  }
});

// ── Staff authorization ────────────────────────────────────────────────────

router.post('/:id/grant', (req, res) => {
  const keyring = db.prepare('SELECT * FROM keyrings WHERE id = ?').get(req.params.id);
  if (!keyring) { req.session.flash = { error: 'Keyring not found.' }; return res.redirect('/keytrak'); }
  const staff = req.body.staff_id ? db.prepare('SELECT * FROM staff WHERE id = ?').get(req.body.staff_id) : null;
  if (!staff) { req.session.flash = { error: 'Select a valid staff member.' }; return res.redirect(`/keytrak/${keyring.id}`); }
  try {
    db.prepare('INSERT INTO keyring_authorizations (keyring_id, staff_id, granted_by) VALUES (?, ?, ?)').run(keyring.id, staff.id, req.session.user.username);
    auditLog('GRANT', 'KEYRING', keyring.id, keyring.ring_number, staff.id, `${staff.first_name} ${staff.last_name}`, req.session.user.username);
    req.session.flash = { success: `Authorization granted to ${staff.first_name} ${staff.last_name}.` };
  } catch {
    req.session.flash = { error: 'That person is already authorized.' };
  }
  res.redirect(`/keytrak/${keyring.id}`);
});

router.post('/:id/revoke/:staffId', (req, res) => {
  const keyring = db.prepare('SELECT * FROM keyrings WHERE id = ?').get(req.params.id);
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.staffId);
  if (!keyring || !staff) { req.session.flash = { error: 'Record not found.' }; return res.redirect('/keytrak'); }
  db.prepare('DELETE FROM keyring_authorizations WHERE keyring_id = ? AND staff_id = ?').run(keyring.id, staff.id);
  auditLog('REVOKE', 'KEYRING', keyring.id, keyring.ring_number, staff.id, `${staff.first_name} ${staff.last_name}`, req.session.user.username);
  req.session.flash = { success: `Authorization revoked for ${staff.first_name} ${staff.last_name}.` };
  res.redirect(`/keytrak/${keyring.id}`);
});

// ── Key assignments ────────────────────────────────────────────────────────

router.post('/:id/keys/assign', (req, res) => {
  const keyring = db.prepare('SELECT * FROM keyrings WHERE id = ?').get(req.params.id);
  if (!keyring) { req.session.flash = { error: 'Keyring not found.' }; return res.redirect('/keytrak'); }
  const key = req.body.key_id ? db.prepare('SELECT *, (SELECT name FROM key_systems WHERE id = key_system_id) AS system_name FROM keys WHERE id = ?').get(req.body.key_id) : null;
  if (!key) { req.session.flash = { error: 'Select a valid key.' }; return res.redirect(`/keytrak/${keyring.id}`); }
  try {
    db.prepare('INSERT INTO keyring_keys (keyring_id, key_id, assigned_by) VALUES (?, ?, ?)').run(keyring.id, key.id, req.session.user.username);
    auditLog('ASSIGN_KEY', 'KEYRING', keyring.id, keyring.ring_number, null, null, req.session.user.username, `Key ${key.key_number} (${key.system_name})`);
    req.session.flash = { success: `Key ${key.key_number} added to ring.` };
  } catch {
    req.session.flash = { error: 'That key is already on this ring.' };
  }
  res.redirect(`/keytrak/${keyring.id}`);
});

router.post('/:id/keys/:keyId/remove', (req, res) => {
  const keyring = db.prepare('SELECT * FROM keyrings WHERE id = ?').get(req.params.id);
  const key = db.prepare('SELECT *, (SELECT name FROM key_systems WHERE id = key_system_id) AS system_name FROM keys WHERE id = ?').get(req.params.keyId);
  if (!keyring || !key) { req.session.flash = { error: 'Record not found.' }; return res.redirect('/keytrak'); }
  db.prepare('DELETE FROM keyring_keys WHERE keyring_id = ? AND key_id = ?').run(keyring.id, key.id);
  auditLog('REMOVE_KEY', 'KEYRING', keyring.id, keyring.ring_number, null, null, req.session.user.username, `Key ${key.key_number} removed`);
  req.session.flash = { success: `Key ${key.key_number} removed from ring.` };
  res.redirect(`/keytrak/${keyring.id}`);
});

// ── FOB profile assignments ────────────────────────────────────────────────

router.post('/:id/fobs/assign', (req, res) => {
  const keyring = db.prepare('SELECT * FROM keyrings WHERE id = ?').get(req.params.id);
  if (!keyring) { req.session.flash = { error: 'Keyring not found.' }; return res.redirect('/keytrak'); }
  const { fob_profile_id, fob_serial } = req.body;
  const profile = fob_profile_id ? db.prepare('SELECT * FROM fob_profiles WHERE id = ?').get(fob_profile_id) : null;
  if (!profile) { req.session.flash = { error: 'Select a valid FOB profile.' }; return res.redirect(`/keytrak/${keyring.id}`); }
  try {
    db.prepare('INSERT INTO keyring_fob_profiles (keyring_id, fob_profile_id, fob_serial, assigned_by) VALUES (?, ?, ?, ?)').run(keyring.id, profile.id, fob_serial || null, req.session.user.username);
    auditLog('ASSIGN_FOB', 'KEYRING', keyring.id, keyring.ring_number, null, null, req.session.user.username, `Profile: ${profile.name}`);
    req.session.flash = { success: `FOB profile "${profile.name}" added to ring.` };
  } catch {
    req.session.flash = { error: 'That FOB profile is already on this ring.' };
  }
  res.redirect(`/keytrak/${keyring.id}`);
});

router.post('/:id/fobs/:profileId/remove', (req, res) => {
  const keyring = db.prepare('SELECT * FROM keyrings WHERE id = ?').get(req.params.id);
  const profile = db.prepare('SELECT * FROM fob_profiles WHERE id = ?').get(req.params.profileId);
  if (!keyring || !profile) { req.session.flash = { error: 'Record not found.' }; return res.redirect('/keytrak'); }
  db.prepare('DELETE FROM keyring_fob_profiles WHERE keyring_id = ? AND fob_profile_id = ?').run(keyring.id, profile.id);
  auditLog('REMOVE_FOB', 'KEYRING', keyring.id, keyring.ring_number, null, null, req.session.user.username, `Profile: ${profile.name} removed`);
  req.session.flash = { success: `FOB profile "${profile.name}" removed from ring.` };
  res.redirect(`/keytrak/${keyring.id}`);
});

module.exports = router;
