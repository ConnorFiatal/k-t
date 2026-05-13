/**
 * routes/ringCheckout.js
 * Ring checkout / check-in management.
 * Extends existing keyrings with check-out tracking.
 * Mounts at /ring-checkout
 */
const express = require('express');
const { db, auditLog } = require('../db');

const router = express.Router();

// ── List: all rings with checkout status ───────────────────────────────────
router.get('/', (req, res) => {
  const rings = db.prepare(`
    SELECT kr.*,
           s.first_name AS holder_first, s.last_name AS holder_last, s.id AS holder_id,
           s.department AS holder_dept,
           COUNT(DISTINCT pk.id) AS physical_key_count,
           COUNT(DISTINCT kk.key_id) AS key_type_count
    FROM keyrings kr
    LEFT JOIN staff s ON s.id = kr.current_holder_staff_id
    LEFT JOIN physical_keys pk ON pk.keytrak_ring_id = kr.id AND pk.status = 'active'
    LEFT JOIN keyring_keys kk ON kk.keyring_id = kr.id
    GROUP BY kr.id
    ORDER BY kr.ring_number
  `).all();

  res.render('ring-checkout/index', { title: 'Keytrak Ring Checkout', rings });
});

// ── Detail: ring with physical keys + checkout form ────────────────────────
router.get('/:id', (req, res) => {
  const ring = db.prepare(`
    SELECT kr.*,
           s.first_name AS holder_first, s.last_name AS holder_last,
           s.department AS holder_dept, s.id AS holder_id
    FROM keyrings kr
    LEFT JOIN staff s ON s.id = kr.current_holder_staff_id
    WHERE kr.id = ?
  `).get(req.params.id);
  if (!ring) { req.session.flash = { error: 'Keyring not found.' }; return res.redirect('/ring-checkout'); }

  // Physical key copies on this ring
  const physicalKeys = db.prepare(`
    SELECT pk.*,
           k.key_number, k.level,
           ks.name AS system_name,
           s.first_name AS holder_first, s.last_name AS holder_last
    FROM physical_keys pk
    JOIN keys k ON k.id = pk.key_type_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    LEFT JOIN key_agreements ka ON ka.physical_key_id = pk.id AND ka.returned_date IS NULL
    LEFT JOIN staff s ON s.id = ka.staff_id
    WHERE pk.keytrak_ring_id = ?
    ORDER BY pk.stamp_number
  `).all(ring.id);

  // Key types (logical keys) on this ring
  const keyTypes = db.prepare(`
    SELECT k.key_number, k.level, ks.name AS system_name, kk.assigned_at, kk.assigned_by
    FROM keyring_keys kk
    JOIN keys k ON k.id = kk.key_id
    JOIN key_systems ks ON ks.id = k.key_system_id
    WHERE kk.keyring_id = ?
    ORDER BY ks.name, k.level, k.key_number
  `).all(ring.id);

  // Checkout history (last 20 transactions involving physical keys on this ring)
  const checkoutHistory = db.prepare(`
    SELECT kt.*, pk.stamp_number,
           s.first_name, s.last_name
    FROM key_transactions kt
    JOIN physical_keys pk ON pk.id = kt.physical_key_id
    LEFT JOIN staff s ON s.id = kt.assigned_to_staff_id
    WHERE pk.keytrak_ring_id = ?
    ORDER BY kt.id DESC
    LIMIT 20
  `).all(ring.id);

  const activeStaff = db.prepare("SELECT id, first_name, last_name, department FROM staff WHERE status='active' ORDER BY last_name, first_name").all();

  res.render('ring-checkout/detail', {
    title: `Ring ${ring.ring_number} — Checkout`,
    ring, physicalKeys, keyTypes, checkoutHistory, activeStaff
  });
});

// ── Check-out ring to a person ─────────────────────────────────────────────
router.post('/:id/checkout', (req, res) => {
  const ring = db.prepare('SELECT * FROM keyrings WHERE id = ?').get(req.params.id);
  if (!ring) { req.session.flash = { error: 'Keyring not found.' }; return res.redirect('/ring-checkout'); }

  const { staff_id, notes } = req.body;
  const staff = staff_id ? db.prepare('SELECT * FROM staff WHERE id = ?').get(staff_id) : null;
  if (!staff) { req.session.flash = { error: 'Select a valid staff member.' }; return res.redirect(`/ring-checkout/${ring.id}`); }

  const user = req.session.user.username;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`
    UPDATE keyrings SET current_holder_staff_id=?, checked_out_date=?, checked_out_notes=? WHERE id=?
  `).run(staff.id, now, notes || null, ring.id);

  auditLog('CHECKOUT', 'KEYRING', ring.id, ring.ring_number, staff.id, `${staff.first_name} ${staff.last_name}`, user, notes || null);
  req.session.flash = { success: `Ring ${ring.ring_number} checked out to ${staff.first_name} ${staff.last_name}.` };
  res.redirect(`/ring-checkout/${ring.id}`);
});

// ── Check-in ring ──────────────────────────────────────────────────────────
router.post('/:id/checkin', (req, res) => {
  const ring = db.prepare('SELECT * FROM keyrings WHERE id = ?').get(req.params.id);
  if (!ring) { req.session.flash = { error: 'Keyring not found.' }; return res.redirect('/ring-checkout'); }
  if (!ring.current_holder_staff_id) {
    req.session.flash = { error: 'Ring is not currently checked out.' };
    return res.redirect(`/ring-checkout/${ring.id}`);
  }

  const { condition_notes } = req.body;
  const user = req.session.user.username;

  const holder = db.prepare('SELECT first_name, last_name FROM staff WHERE id = ?').get(ring.current_holder_staff_id);

  db.prepare(`
    UPDATE keyrings SET current_holder_staff_id=NULL, checked_out_date=NULL, checked_out_notes=NULL WHERE id=?
  `).run(ring.id);

  auditLog('CHECKIN', 'KEYRING', ring.id, ring.ring_number,
    ring.current_holder_staff_id,
    holder ? `${holder.first_name} ${holder.last_name}` : null,
    user, condition_notes || null);

  req.session.flash = { success: `Ring ${ring.ring_number} checked in.` };
  res.redirect(`/ring-checkout/${ring.id}`);
});

module.exports = router;
