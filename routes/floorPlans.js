const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { db, auditLog } = require('../db');
const { requirePermission, requirePlanFeature } = require('../middleware/auth');

const router = express.Router();

// All floor plan routes require the plan feature
router.use(requirePlanFeature('feature_floor_plans'));

// ── Upload directory ───────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '..', 'uploads', 'floorplans');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `fp-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
    if (allowed.has(path.extname(file.originalname).toLowerCase())) return cb(null, true);
    cb(new Error('Only image files are accepted (PNG, JPG, GIF, WebP)'));
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
const getPins = (planId) => db.prepare(`
  SELECT fpd.door_id, fpd.x_pct, fpd.y_pct,
         d.name, d.access_type, d.building, d.floor, d.location, d.door_number, d.notes
  FROM floor_plan_doors fpd
  JOIN doors d ON d.id = fpd.door_id
  WHERE fpd.floor_plan_id = ?
  ORDER BY d.name
`).all(planId);

// ══════════════════════════════════════════════════════════════════════════
// LIST
// ══════════════════════════════════════════════════════════════════════════
router.get('/', requirePermission('floor_plans.view'), (req, res) => {
  const plans = db.prepare(`
    SELECT fp.*, COUNT(fpd.id) AS door_count
    FROM floor_plans fp
    LEFT JOIN floor_plan_doors fpd ON fpd.floor_plan_id = fp.id
    GROUP BY fp.id
    ORDER BY fp.building NULLS LAST, fp.floor NULLS LAST, fp.name
  `).all();
  res.render('floor-plans/index', { title: 'Floor Plans', plans });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW / CREATE
// ══════════════════════════════════════════════════════════════════════════
router.get('/new', requirePermission('floor_plans.create'), (req, res) => {
  res.render('floor-plans/new', { title: 'Upload Floor Plan' });
});

router.post('/', requirePermission('floor_plans.create'), upload.single('image'), (req, res) => {
  if (!req.file) {
    req.session.flash = { error: 'An image file is required.' };
    return res.redirect('/floor-plans/new');
  }
  const { name, building, floor } = req.body;
  if (!name || !name.trim()) {
    fs.unlinkSync(req.file.path);
    req.session.flash = { error: 'A name is required.' };
    return res.redirect('/floor-plans/new');
  }
  const result = db.prepare(
    'INSERT INTO floor_plans (name, building, floor, filename) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), building?.trim() || null, floor?.trim() || null, req.file.filename);
  auditLog('CREATE', 'floor_plan', result.lastInsertRowid, name.trim(), null, null, req.session.user.username);
  res.redirect(`/floor-plans/${result.lastInsertRowid}/edit`);
});

// ══════════════════════════════════════════════════════════════════════════
// VIEWER
// ══════════════════════════════════════════════════════════════════════════
router.get('/:id', requirePermission('floor_plans.view'), (req, res) => {
  const plan = db.prepare('SELECT * FROM floor_plans WHERE id = ?').get(req.params.id);
  if (!plan) { req.session.flash = { error: 'Floor plan not found.' }; return res.redirect('/floor-plans'); }
  const pins = getPins(plan.id);
  res.render('floor-plans/detail', { title: plan.name, plan, pins });
});

// ══════════════════════════════════════════════════════════════════════════
// EDITOR
// ══════════════════════════════════════════════════════════════════════════
router.get('/:id/edit', requirePermission('floor_plans.edit'), (req, res) => {
  const plan = db.prepare('SELECT * FROM floor_plans WHERE id = ?').get(req.params.id);
  if (!plan) { req.session.flash = { error: 'Floor plan not found.' }; return res.redirect('/floor-plans'); }
  const pins = getPins(plan.id);
  const placedIds = pins.map(p => p.door_id);
  const availableDoors = db.prepare('SELECT id, name, access_type, door_number, building, floor FROM doors ORDER BY name').all()
    .filter(d => !placedIds.includes(d.id));
  res.render('floor-plans/edit', { title: `Edit: ${plan.name}`, plan, pins, availableDoors });
});

// ══════════════════════════════════════════════════════════════════════════
// API — place or move a pin  (POST /floor-plans/:id/doors)
// ══════════════════════════════════════════════════════════════════════════
router.post('/:id/doors', requirePermission('floor_plans.edit'), express.json(), (req, res) => {
  const plan = db.prepare('SELECT id FROM floor_plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });

  const { door_id, x_pct, y_pct } = req.body;
  if (door_id == null || x_pct == null || y_pct == null)
    return res.status(400).json({ error: 'door_id, x_pct and y_pct are required' });

  const door = db.prepare('SELECT id, name FROM doors WHERE id = ?').get(parseInt(door_id));
  if (!door) return res.status(404).json({ error: 'Door not found' });

  db.prepare(`
    INSERT INTO floor_plan_doors (floor_plan_id, door_id, x_pct, y_pct)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(floor_plan_id, door_id) DO UPDATE SET x_pct = excluded.x_pct, y_pct = excluded.y_pct
  `).run(plan.id, door.id, parseFloat(x_pct), parseFloat(y_pct));

  res.json({ ok: true, door_name: door.name });
});

// ══════════════════════════════════════════════════════════════════════════
// API — remove a pin  (POST /floor-plans/:id/doors/:doorId/remove)
// ══════════════════════════════════════════════════════════════════════════
router.post('/:id/doors/:doorId/remove', requirePermission('floor_plans.edit'), express.json(), (req, res) => {
  db.prepare('DELETE FROM floor_plan_doors WHERE floor_plan_id = ? AND door_id = ?')
    .run(req.params.id, req.params.doorId);

  const door = db.prepare('SELECT id, name, access_type, door_number, building, floor FROM doors WHERE id = ?')
    .get(req.params.doorId);

  // Return door data so editor can add it back to the available list
  res.json({ ok: true, door: door || null });
});

// ══════════════════════════════════════════════════════════════════════════
// DELETE FLOOR PLAN
// ══════════════════════════════════════════════════════════════════════════
router.post('/:id/delete', requirePermission('floor_plans.delete'), (req, res) => {
  const plan = db.prepare('SELECT * FROM floor_plans WHERE id = ?').get(req.params.id);
  if (!plan) { req.session.flash = { error: 'Not found.' }; return res.redirect('/floor-plans'); }

  const imgPath = path.join(uploadDir, plan.filename);
  if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);

  db.prepare('DELETE FROM floor_plans WHERE id = ?').run(plan.id);
  auditLog('DELETE', 'floor_plan', plan.id, plan.name, null, null, req.session.user.username);
  req.session.flash = { success: `Floor plan "${plan.name}" deleted.` };
  res.redirect('/floor-plans');
});

module.exports = router;
