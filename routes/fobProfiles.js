const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const profiles = db.prepare(`
    SELECT fp.*,
      COUNT(DISTINCT fpd.door_id) AS door_count,
      COUNT(DISTINCT kfp.keyring_id) AS ring_count
    FROM fob_profiles fp
    LEFT JOIN fob_profile_doors fpd ON fpd.fob_profile_id = fp.id
    LEFT JOIN keyring_fob_profiles kfp ON kfp.fob_profile_id = fp.id
    GROUP BY fp.id ORDER BY fp.name
  `).all();
  res.render('fob-profiles/index', { title: 'FOB Profiles', profiles });
});

router.get('/new', (req, res) => {
  res.render('fob-profiles/form', { title: 'New FOB Profile', profile: null, action: '/fob-profiles' });
});

router.post('/', (req, res) => {
  const { name, description, notes } = req.body;
  if (!name) { req.session.flash = { error: 'Profile name is required.' }; return res.redirect('/fob-profiles/new'); }
  try {
    const result = db.prepare('INSERT INTO fob_profiles (name, description, notes) VALUES (?, ?, ?)')
      .run(name.trim(), description || null, notes || null);
    req.session.flash = { success: `FOB profile "${name}" created.` };
    res.redirect(`/fob-profiles/${result.lastInsertRowid}`);
  } catch {
    req.session.flash = { error: 'A profile with that name already exists.' };
    res.redirect('/fob-profiles/new');
  }
});

router.get('/:id', (req, res) => {
  const profile = db.prepare('SELECT * FROM fob_profiles WHERE id = ?').get(req.params.id);
  if (!profile) { req.session.flash = { error: 'FOB profile not found.' }; return res.redirect('/fob-profiles'); }

  const doors = db.prepare(`
    SELECT d.* FROM fob_profile_doors fpd JOIN doors d ON d.id = fpd.door_id
    WHERE fpd.fob_profile_id = ? ORDER BY d.building, d.floor, d.name
  `).all(profile.id);

  const assignedDoorIds = doors.map(d => d.id);
  const eligibleDoors = db.prepare("SELECT * FROM doors WHERE access_type IN ('FOB','BOTH') ORDER BY building, floor, name").all()
    .filter(d => !assignedDoorIds.includes(d.id));

  const onRings = db.prepare(`
    SELECT kfp.*, kr.ring_number, kr.description FROM keyring_fob_profiles kfp
    JOIN keyrings kr ON kr.id = kfp.keyring_id WHERE kfp.fob_profile_id = ?
  `).all(profile.id);

  res.render('fob-profiles/detail', { title: `FOB Profile: ${profile.name}`, profile, doors, eligibleDoors, onRings });
});

router.get('/:id/edit', (req, res) => {
  const profile = db.prepare('SELECT * FROM fob_profiles WHERE id = ?').get(req.params.id);
  if (!profile) { req.session.flash = { error: 'FOB profile not found.' }; return res.redirect('/fob-profiles'); }
  res.render('fob-profiles/form', { title: `Edit ${profile.name}`, profile, action: `/fob-profiles/${profile.id}` });
});

router.post('/:id', (req, res) => {
  const profile = db.prepare('SELECT * FROM fob_profiles WHERE id = ?').get(req.params.id);
  if (!profile) { req.session.flash = { error: 'FOB profile not found.' }; return res.redirect('/fob-profiles'); }
  const { name, description, notes } = req.body;
  if (!name) { req.session.flash = { error: 'Name is required.' }; return res.redirect(`/fob-profiles/${profile.id}/edit`); }
  try {
    db.prepare('UPDATE fob_profiles SET name=?, description=?, notes=? WHERE id=?')
      .run(name.trim(), description || null, notes || null, profile.id);
    req.session.flash = { success: 'FOB profile updated.' };
    res.redirect(`/fob-profiles/${profile.id}`);
  } catch {
    req.session.flash = { error: 'A profile with that name already exists.' };
    res.redirect(`/fob-profiles/${profile.id}/edit`);
  }
});

router.post('/:id/delete', (req, res) => {
  const profile = db.prepare('SELECT * FROM fob_profiles WHERE id = ?').get(req.params.id);
  if (!profile) { req.session.flash = { error: 'FOB profile not found.' }; return res.redirect('/fob-profiles'); }
  const ringCount = db.prepare('SELECT COUNT(*) AS c FROM keyring_fob_profiles WHERE fob_profile_id = ?').get(profile.id).c;
  if (ringCount > 0) {
    req.session.flash = { error: `Cannot delete — profile is assigned to ${ringCount} keyring(s).` };
    return res.redirect(`/fob-profiles/${profile.id}`);
  }
  db.prepare('DELETE FROM fob_profiles WHERE id = ?').run(profile.id);
  req.session.flash = { success: `FOB profile "${profile.name}" deleted.` };
  res.redirect('/fob-profiles');
});

router.post('/:id/doors/add', (req, res) => {
  const profile = db.prepare('SELECT * FROM fob_profiles WHERE id = ?').get(req.params.id);
  if (!profile) { req.session.flash = { error: 'Profile not found.' }; return res.redirect('/fob-profiles'); }
  const { door_id } = req.body;
  if (!door_id) { req.session.flash = { error: 'Select a door.' }; return res.redirect(`/fob-profiles/${profile.id}`); }
  try {
    db.prepare('INSERT INTO fob_profile_doors (fob_profile_id, door_id) VALUES (?, ?)').run(profile.id, door_id);
    req.session.flash = { success: 'Door added to profile.' };
  } catch {
    req.session.flash = { error: 'That door is already in this profile.' };
  }
  res.redirect(`/fob-profiles/${profile.id}`);
});

router.post('/:id/doors/:doorId/remove', (req, res) => {
  const profile = db.prepare('SELECT * FROM fob_profiles WHERE id = ?').get(req.params.id);
  if (!profile) { req.session.flash = { error: 'Profile not found.' }; return res.redirect('/fob-profiles'); }
  db.prepare('DELETE FROM fob_profile_doors WHERE fob_profile_id = ? AND door_id = ?').run(profile.id, req.params.doorId);
  req.session.flash = { success: 'Door removed from profile.' };
  res.redirect(`/fob-profiles/${profile.id}`);
});

module.exports = router;
