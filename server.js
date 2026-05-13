require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

// Issue 6 — fail fast if session secret is not configured
if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is not set. Create a .env file or set it in your environment.');
  process.exit(1);
}

const { requireLogin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
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
  // Issue 3 — SameSite=strict prevents cross-origin requests from carrying the session cookie (CSRF mitigation)
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000, sameSite: 'strict' }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.flash = req.session.flash || null;
  if (req.session.flash) delete req.session.flash;
  next();
});

app.use('/', authRoutes);
app.use(requireLogin);

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

app.listen(PORT, () => {
  console.log(`KeyDog running at http://localhost:${PORT}`);
  console.log('Default login: admin / admin123 (change this immediately)');
  setupKeyCron();
});
