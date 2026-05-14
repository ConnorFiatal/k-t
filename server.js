require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is not set.');
  process.exit(1);
}
if (!process.env.ENCRYPTION_KEY) {
  console.error('FATAL: ENCRYPTION_KEY environment variable is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const { requireLogin, userCan } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const rolesRoutes = require('./routes/roles');
const staffRoutes = require('./routes/staff');
const safesRoutes = require('./routes/safes');
const keytrakRoutes = require('./routes/keytrak');
const systemAccountsRoutes = require('./routes/systemAccounts');
const auditRoutes = require('./routes/audit');
const adminRoutes = require('./routes/admin');
const keySystemsRoutes = require('./routes/keySystems');
const keysRoutes = require('./routes/keys');
const doorsRoutes = require('./routes/doors');
const fobProfilesRoutes = require('./routes/fobProfiles');
const reportsRoutes = require('./routes/reports');
const importRoutes      = require('./routes/import');
const emailRoutes       = require('./routes/email');
const exportRoutes      = require('./routes/export');
const floorPlansRoutes      = require('./routes/floorPlans');
const physicalKeysRoutes    = require('./routes/physicalKeys');
const ringCheckoutRoutes    = require('./routes/ringCheckout');
const keyTransactionsRoutes = require('./routes/keyTransactions');
const keyAgreementsRoutes   = require('./routes/keyAgreements');
const keyReportsRoutes      = require('./routes/keyReports');
const { setupKeyCron }      = require('./routes/keyCron');
const { db } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.flash = req.session.flash || null;
  if (req.session.flash) delete req.session.flash;

  // Load plan settings and compute license + active layers
  try {
    const rows = db.prepare('SELECT key, value FROM plan_settings').all();
    const ps = {};
    for (const r of rows) ps[r.key] = r.value;

    // Feature license: env var overrides DB licensed_xxx value
    const FEATURE_KEYS = ['floor_plans', 'key_agreements', 'ring_checkout', 'csv_import_export', 'email_alerts', 'priority_support'];
    const planLicensed = {};
    for (const f of FEATURE_KEYS) {
      const envVal = process.env[`PLAN_LICENSED_${f.toUpperCase()}`];
      planLicensed[f] = (envVal !== undefined && envVal !== '')
        ? (envVal === '1' ? '1' : '0')
        : (ps[`licensed_${f}`] ?? '1');
      // Sync planSettings so nav/middleware checks still work
      ps[`feature_${f}`] = planLicensed[f];
    }
    res.locals.planLicensed = planLicensed;

    // Limits: env vars override DB values
    const LIMIT_KEYS = ['max_admin_users', 'max_buildings', 'audit_retention_days'];
    for (const lim of LIMIT_KEYS) {
      const envVal = process.env[`PLAN_${lim.toUpperCase()}`];
      if (envVal !== undefined && envVal !== '') ps[lim] = envVal;
    }
    res.locals.planSettings = ps;
  } catch {
    res.locals.planSettings = {};
    res.locals.planLicensed = {};
    res.locals.planLimitsLocked = {};
  }
  res.locals.userCan = (permission) => userCan(req.session.user, permission);
  next();
});

// CSRF: reject state-changing requests that originate from a different host
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const host = req.get('Host');
    const origin = req.get('Origin');
    const referer = req.get('Referer');
    const sameHost = (url) => { try { return new URL(url).host === host; } catch { return false; } };
    if (origin && !sameHost(origin)) return res.status(403).send('Forbidden');
    if (!origin && referer && !sameHost(referer)) return res.status(403).send('Forbidden');
  }
  next();
});

app.use('/', authRoutes);
app.use(requireLogin);

// Serve uploads directory — requires login (mounted after requireLogin)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    if (path.extname(filePath).toLowerCase() === '.pdf') {
      res.setHeader('Content-Disposition', 'attachment');
    }
  }
}));

app.get('/', (req, res) => {
  const stats = {
    activeStaff:    db.prepare("SELECT COUNT(*) AS c FROM staff WHERE status='active'").get().c,
    safes:          db.prepare('SELECT COUNT(*) AS c FROM safes').get().c,
    keyrings:       db.prepare('SELECT COUNT(*) AS c FROM keyrings').get().c,
    systemAccounts: db.prepare('SELECT COUNT(*) AS c FROM system_accounts').get().c,
    doors:          db.prepare('SELECT COUNT(*) AS c FROM doors').get().c,
    keys:           db.prepare('SELECT COUNT(*) AS c FROM keys').get().c,
    keySystems:     db.prepare('SELECT COUNT(*) AS c FROM key_systems').get().c,
    floorPlans:     db.prepare('SELECT COUNT(*) AS c FROM floor_plans').get().c,
    fobProfiles:    db.prepare('SELECT COUNT(*) AS c FROM fob_profiles').get().c,
    physicalKeys:   db.prepare("SELECT COUNT(*) AS c FROM physical_keys WHERE status='active'").get().c,
  };
  const recentAudit = db.prepare('SELECT * FROM audit_log ORDER BY performed_at DESC LIMIT 10').all();
  res.render('dashboard', { title: 'Dashboard', stats, recentAudit });
});

app.use('/staff', staffRoutes);
app.use('/safes', safesRoutes);
app.use('/keytrak', keytrakRoutes);
app.use('/system-accounts', systemAccountsRoutes);
app.use('/audit', auditRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/roles', rolesRoutes);
app.use('/key-systems', keySystemsRoutes);
app.use('/keys', keysRoutes);
app.use('/doors', doorsRoutes);
app.use('/fob-profiles', fobProfilesRoutes);
app.use('/reports', reportsRoutes);
app.use('/import', importRoutes);
app.use('/floor-plans', floorPlansRoutes);
app.use('/email',            emailRoutes);
app.use('/export',           exportRoutes);
app.use('/physical-keys',    physicalKeysRoutes);
app.use('/ring-checkout',    ringCheckoutRoutes);
app.use('/key-transactions', keyTransactionsRoutes);
app.use('/key-agreements',   keyAgreementsRoutes);
app.use('/reports/keys',     keyReportsRoutes);

app.use((req, res) => res.status(404).render('404', { title: 'Not Found' }));

app.use((err, req, res, next) => {
  console.error('[error]', err.stack || err.message || err);
  if (res.headersSent) return next(err);
  res.status(500).render('500', { title: 'Server Error', user: req.session?.user || null, currentPath: req.path, flash: null, planSettings: {}, planLicensed: {}, userCan: () => false });
});

app.listen(PORT, () => {
  console.log(`KeyDog running at http://localhost:${PORT}`);
  setupKeyCron();
});
