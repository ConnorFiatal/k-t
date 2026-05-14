/**
 * routes/api.js
 * Machine-to-machine API for plan feature licensing.
 * Used by n8n automations triggered from Stripe webhooks.
 * Mounts at /api  (before requireLogin — no session needed)
 *
 * Auth: Authorization: Bearer <PLAN_API_KEY>
 */
const express = require('express');
const { db }  = require('../db');

const router = express.Router();

const FEATURES = [
  'floor_plans',
  'key_agreements',
  'ring_checkout',
  'csv_import_export',
  'email_alerts',
  'priority_support',
];

const LIMITS = [
  'max_admin_users',
  'max_buildings',
  'audit_retention_days',
];

// Product catalog — used by n8n to know which feature key maps to which product.
// Add your Stripe Price IDs here once products are created.
const CATALOG = [
  {
    key:                  'floor_plans',
    label:                'Floor Plan Management',
    description:          'Upload interactive building floor plans with door pin overlays.',
    stripe_product_name:  'KeyDog — Floor Plans',
    stripe_price_id:      '',   // fill in after creating in Stripe
  },
  {
    key:                  'key_agreements',
    label:                'Key Agreement Workflows',
    description:          'Issue, track, and store signed key custody agreements.',
    stripe_product_name:  'KeyDog — Key Agreements',
    stripe_price_id:      '',
  },
  {
    key:                  'ring_checkout',
    label:                'Ring Checkout System',
    description:          'Fast key-ring check-in / check-out at front desks.',
    stripe_product_name:  'KeyDog — Ring Checkout',
    stripe_price_id:      '',
  },
  {
    key:                  'csv_import_export',
    label:                'CSV Import & Export',
    description:          'Bulk import records and export all data to CSV.',
    stripe_product_name:  'KeyDog — CSV Import & Export',
    stripe_price_id:      '',
  },
  {
    key:                  'email_alerts',
    label:                'Email Overdue Alerts',
    description:          'Automated email notifications for overdue or expiring keys.',
    stripe_product_name:  'KeyDog — Email Alerts',
    stripe_price_id:      '',
  },
  {
    key:                  'priority_support',
    label:                'Priority Support',
    description:          'Dedicated support channel with guaranteed SLA response times.',
    stripe_product_name:  'KeyDog — Priority Support',
    stripe_price_id:      '',
  },
];

// ── Auth middleware ────────────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const apiKey = process.env.PLAN_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'API access not configured. Set PLAN_API_KEY in .env.' });
  }
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key.' });
  }
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────
function getDbSettings() {
  const rows = db.prepare('SELECT key, value FROM plan_settings').all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

function resolveFeatureState(dbSettings) {
  const features = {};
  for (const f of FEATURES) {
    const envVal   = process.env[`PLAN_LICENSED_${f.toUpperCase()}`];
    const envLocked = envVal !== undefined && envVal !== '';
    features[f] = {
      licensed:   envLocked ? envVal === '1' : dbSettings[`licensed_${f}`] === '1',
      active:     dbSettings[`feature_${f}`] === '1',
      env_locked: envLocked,
    };
  }
  return features;
}

function resolveLimitState(dbSettings) {
  const limits = {};
  for (const lim of LIMITS) {
    const envVal    = process.env[`PLAN_${lim.toUpperCase()}`];
    const envLocked = envVal !== undefined && envVal !== '';
    limits[lim] = {
      value:      envLocked ? envVal : (dbSettings[lim] ?? '0'),
      env_locked: envLocked,
    };
  }
  return limits;
}

const upsert = () => db.prepare(
  'INSERT INTO plan_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

// ══════════════════════════════════════════════════════════════════════════
// GET /api/plan  —  inspect current feature + limit state
// ══════════════════════════════════════════════════════════════════════════
router.get('/plan', requireApiKey, express.json(), (req, res) => {
  const db_settings = getDbSettings();
  res.json({
    features: resolveFeatureState(db_settings),
    limits:   resolveLimitState(db_settings),
    _catalog: CATALOG,
    _n8n_notes: {
      grant_feature:  'POST /api/plan/features  body: { "floor_plans": true }',
      revoke_feature: 'POST /api/plan/features  body: { "floor_plans": false }',
      set_limits:     'POST /api/plan/limits    body: { "max_admin_users": 10 }',
    },
  });
});

// ══════════════════════════════════════════════════════════════════════════
// POST /api/plan/features  —  grant or revoke individual feature licenses
//
// n8n calls this after a Stripe checkout.session.completed event.
// Body: { "floor_plans": true, "key_agreements": false, ... }
//
// When a feature is licensed=true  → sets licensed_xxx=1 AND feature_xxx=1 (auto-activate)
// When a feature is licensed=false → sets licensed_xxx=0 AND feature_xxx=0 (auto-deactivate)
// ══════════════════════════════════════════════════════════════════════════
router.post('/plan/features', requireApiKey, express.json(), (req, res) => {
  const stmt    = upsert();
  const updated = {};
  const skipped = {};

  for (const f of FEATURES) {
    if (req.body[f] === undefined) continue;

    // Reject if this feature is locked by env var
    const envVal = process.env[`PLAN_LICENSED_${f.toUpperCase()}`];
    if (envVal !== undefined && envVal !== '') {
      skipped[f] = 'env_locked';
      continue;
    }

    const licensed = (req.body[f] === true || req.body[f] === 1 || req.body[f] === '1') ? '1' : '0';
    stmt.run(`licensed_${f}`, licensed);
    stmt.run(`feature_${f}`,  licensed); // activate when licensed, deactivate when revoked
    updated[f] = { licensed: licensed === '1', active: licensed === '1' };
  }

  if (Object.keys(updated).length === 0 && Object.keys(skipped).length === 0) {
    return res.status(400).json({
      error:      'No valid feature keys in request body.',
      valid_keys: FEATURES,
    });
  }

  res.json({ ok: true, updated, skipped });
});

// ══════════════════════════════════════════════════════════════════════════
// POST /api/plan/limits  —  update plan limits
//
// Body: { "max_admin_users": 10, "max_buildings": 5, "audit_retention_days": 365 }
// Set a limit to 0 for unlimited.
// ══════════════════════════════════════════════════════════════════════════
router.post('/plan/limits', requireApiKey, express.json(), (req, res) => {
  const stmt    = upsert();
  const updated = {};
  const skipped = {};

  for (const lim of LIMITS) {
    if (req.body[lim] === undefined) continue;

    const envVal = process.env[`PLAN_${lim.toUpperCase()}`];
    if (envVal !== undefined && envVal !== '') {
      skipped[lim] = 'env_locked';
      continue;
    }

    const val = String(Math.max(0, parseInt(req.body[lim]) || 0));
    stmt.run(lim, val);
    updated[lim] = val;
  }

  if (Object.keys(updated).length === 0 && Object.keys(skipped).length === 0) {
    return res.status(400).json({
      error:      'No valid limit keys in request body.',
      valid_keys: LIMITS,
    });
  }

  res.json({ ok: true, updated, skipped });
});

module.exports = router;
